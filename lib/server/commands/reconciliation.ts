import type { QueryResultRow } from "pg";
import type { TransactionClient } from "@/lib/server/db";
import type { OutboundCommandStatus } from "@/lib/server/domain/outbound-command";
import {
    findOutboundCommandById,
    type StoredOutboundCommand,
} from "@/lib/server/commands/repository";

export const MANUAL_RECONCILIATION_ACTIONS = ["RECHECK", "ABANDON"] as const;

export type ManualReconciliationAction =
    (typeof MANUAL_RECONCILIATION_ACTIONS)[number];

interface ReconciliationCommandRow extends QueryResultRow {
    id: string;
    market_account_id: string;
    status: OutboundCommandStatus;
    version: string;
    attempt_count: number;
    max_attempts: number;
    last_error_code: string | null;
    lease_until: Date | null;
    result: Record<string, unknown> | null;
}

interface CommandIdentityRow extends QueryResultRow {
    market_account_id: string;
    market_code: string;
}

export class OutboundCommandReconciliationError extends Error {
    constructor(
        readonly code:
            | "COMMAND_NOT_FOUND"
            | "COMMAND_VERSION_CONFLICT"
            | "COMMAND_RECONCILIATION_STATE_CONFLICT"
            | "COMMAND_RECONCILIATION_UNSUPPORTED_MARKET",
        message: string,
    ) {
        super(message);
        this.name = "OutboundCommandReconciliationError";
    }
}

export interface ReconcileOutboundCommandInput {
    tenantId: string;
    commandId: string;
    membershipId: string;
    correlationId: string;
    expectedVersion: string;
    action: ManualReconciliationAction;
    reason?: string;
    now?: Date;
}

function isExpiredLease(command: ReconciliationCommandRow, now: Date): boolean {
    return command.status === "LEASED"
        && command.lease_until !== null
        && command.lease_until.getTime() <= now.getTime();
}

function canRecheck(command: ReconciliationCommandRow, now: Date): boolean {
    const manualResolutionRequired = command.result?.requiresManualResolution === true
        && command.result.applied === "UNKNOWN";
    return command.status === "UNKNOWN"
        || isExpiredLease(command, now)
        || command.status === "FAILED"
            && manualResolutionRequired;
}

async function lockAccountLifecycle(
    client: TransactionClient,
    marketAccountId: string,
): Promise<void> {
    await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [marketAccountId],
    );
}

/**
 * Schedules a provider-state read or explicitly abandons an unresolved command.
 * Neither action writes to the marketplace, and ABANDON never projects success.
 */
export async function reconcileOutboundCommand(
    client: TransactionClient,
    input: ReconcileOutboundCommandInput,
): Promise<StoredOutboundCommand> {
    const identity = await client.query<CommandIdentityRow>(
        `SELECT oc.market_account_id, ma.market_code
           FROM outbound_commands oc
           JOIN market_accounts ma
             ON ma.tenant_id = oc.tenant_id
            AND ma.id = oc.market_account_id
          WHERE oc.tenant_id = $1
            AND oc.id = $2
            AND oc.deleted_at IS NULL`,
        [input.tenantId, input.commandId],
    );
    const identityRow = identity.rows[0];
    const marketAccountId = identityRow?.market_account_id;
    if (!marketAccountId) {
        throw new OutboundCommandReconciliationError(
            "COMMAND_NOT_FOUND",
            "The command was not found.",
        );
    }
    const marketCode = identityRow.market_code;
    if (input.action === "RECHECK" && marketCode !== "NAVER") {
        throw new OutboundCommandReconciliationError(
            "COMMAND_RECONCILIATION_UNSUPPORTED_MARKET",
            "Provider-state recheck is not implemented for this marketplace.",
        );
    }

    // Match the account-deletion/worker lock order so an unresolved command
    // cannot be reopened while its credentials are being revoked.
    await lockAccountLifecycle(client, marketAccountId);
    const locked = await client.query<ReconciliationCommandRow>(
        `SELECT id, market_account_id, status, version, attempt_count,
                max_attempts, last_error_code, lease_until, result
           FROM outbound_commands
          WHERE tenant_id = $1
            AND market_account_id = $2
            AND id = $3
            AND deleted_at IS NULL
          FOR UPDATE`,
        [input.tenantId, marketAccountId, input.commandId],
    );
    const command = locked.rows[0];
    if (!command) {
        throw new OutboundCommandReconciliationError(
            "COMMAND_NOT_FOUND",
            "The command was not found.",
        );
    }
    if (command.version !== input.expectedVersion) {
        throw new OutboundCommandReconciliationError(
            "COMMAND_VERSION_CONFLICT",
            "The command changed after it was loaded. Refresh and retry.",
        );
    }

    const now = input.now ?? new Date();
    const expiredLease = isExpiredLease(command, now);
    if (expiredLease) {
        await client.query(
            `UPDATE outbound_attempts
                SET outcome = 'UNKNOWN',
                    provider_code = 'MANUAL_EXPIRED_LEASE_RESOLUTION',
                    provider_message = 'An administrator resolved an expired worker lease without claiming provider success.',
                    response_summary = jsonb_build_object(
                        'provider', $5,
                        'applied', 'UNKNOWN',
                        'reason', 'MANUAL_EXPIRED_LEASE_RESOLUTION'
                    ),
                    completed_at = $4::timestamptz,
                    duration_ms = GREATEST(
                        0,
                        FLOOR(EXTRACT(EPOCH FROM ($4::timestamptz - started_at)) * 1000)::integer
                    )
              WHERE tenant_id = $1
                AND market_account_id = $2
                AND outbound_command_id = $3
                AND outcome = 'IN_PROGRESS'
                AND deleted_at IS NULL`,
            [input.tenantId, marketAccountId, input.commandId, now, marketCode],
        );
    }

    if (input.action === "RECHECK") {
        if (!canRecheck(command, now)) {
            throw new OutboundCommandReconciliationError(
                "COMMAND_RECONCILIATION_STATE_CONFLICT",
                "Only unresolved commands can be scheduled for a provider-state recheck.",
            );
        }

        await client.query(
            `UPDATE outbound_commands
                SET status = 'UNKNOWN',
                    max_attempts = GREATEST(max_attempts, attempt_count + 3),
                    next_attempt_at = $4::timestamptz,
                    lease_owner = NULL,
                    lease_until = NULL,
                    lease_purpose = NULL,
                    result = jsonb_build_object(
                        'provider', $5,
                        'applied', 'UNKNOWN',
                        'reason', 'MANUAL_RECONCILIATION_REQUESTED',
                        'requiresManualResolution', false
                    ),
                    last_error_code = 'MANUAL_RECONCILIATION_REQUESTED',
                    last_error_message = 'An administrator requested another provider-state reconciliation.',
                    failed_at = NULL
              WHERE tenant_id = $1
                AND market_account_id = $2
                AND id = $3`,
            [input.tenantId, marketAccountId, input.commandId, now, marketCode],
        );
    } else {
        const canAbandon = command.status === "UNKNOWN"
            || command.status === "PENDING"
            || command.status === "RETRY"
            || expiredLease;
        if (!canAbandon) {
            throw new OutboundCommandReconciliationError(
                "COMMAND_RECONCILIATION_STATE_CONFLICT",
                "Only queued, retryable, or unresolved commands can be explicitly abandoned.",
            );
        }

        const abandonedStatus = command.status === "PENDING" || command.status === "RETRY"
            ? "CANCELED"
            : "FAILED";

        await client.query(
            `UPDATE outbound_commands
                SET status = $4,
                    lease_owner = NULL,
                    lease_until = NULL,
                    lease_purpose = NULL,
                    result = jsonb_build_object(
                        'provider', $6,
                        'applied', 'UNKNOWN',
                        'reason', 'MANUALLY_ABANDONED',
                        'requiresManualResolution', false
                    ),
                    last_error_code = 'MANUALLY_ABANDONED',
                    last_error_message = 'An administrator explicitly abandoned the unresolved command without claiming provider success.',
                    succeeded_at = NULL,
                    failed_at = CASE WHEN $4 = 'FAILED' THEN $5::timestamptz ELSE NULL END
              WHERE tenant_id = $1
                AND market_account_id = $2
                AND id = $3`,
            [
                input.tenantId,
                marketAccountId,
                input.commandId,
                abandonedStatus,
                now,
                marketCode,
            ],
        );
    }

    await client.query(
        `INSERT INTO audit_logs (
             tenant_id, market_account_id, actor_type, actor_membership_id,
             action, entity_type, entity_id, correlation_id,
             before_snapshot, after_snapshot, metadata, occurred_at
         ) VALUES (
             $1, $2, 'USER', $3, $4,
             'OUTBOUND_COMMAND', $5, $6::uuid,
             $7::jsonb, $8::jsonb, $9::jsonb, $10::timestamptz
         )`,
        [
            input.tenantId,
            marketAccountId,
            input.membershipId,
            input.action === "RECHECK"
                ? "OUTBOUND_COMMAND_RECONCILIATION_REQUESTED"
                : "OUTBOUND_COMMAND_RECONCILIATION_ABANDONED",
            input.commandId,
            input.correlationId,
            JSON.stringify({
                status: command.status,
                attemptCount: command.attempt_count,
                maxAttempts: command.max_attempts,
                lastErrorCode: command.last_error_code,
            }),
            JSON.stringify({
                status: input.action === "RECHECK"
                    ? "UNKNOWN"
                    : command.status === "PENDING" || command.status === "RETRY"
                        ? "CANCELED"
                        : "FAILED",
                providerApplied: command.status === "PENDING" || command.status === "RETRY"
                    ? false
                    : "UNKNOWN",
            }),
            JSON.stringify({
                resolutionAction: input.action,
                reason: input.reason ?? null,
                providerWriteIssued: false,
            }),
            now,
        ],
    );

    const updated = await findOutboundCommandById(client, input.tenantId, input.commandId);
    if (!updated) {
        throw new OutboundCommandReconciliationError(
            "COMMAND_NOT_FOUND",
            "The command disappeared while applying the reconciliation action.",
        );
    }
    return updated;
}
