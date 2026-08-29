import type { QueryResultRow } from "pg";
import type { TransactionClient } from "@/lib/server/db";
import type {
    OutboundAggregateType,
    OutboundCommand,
    OutboundCommandStatus,
    OutboundCommandType,
} from "@/lib/server/domain/outbound-command";

interface OrderItemContextRow extends QueryResultRow {
    id: string;
    version: string;
    market_account_id: string;
    market_code: string;
    account_auth_status: string;
    account_is_active: boolean;
    capabilities: unknown;
    settings: unknown;
}

interface OutboundCommandRow extends QueryResultRow {
    id: string;
    tenant_id: string;
    market_account_id: string;
    order_item_id: string | null;
    aggregate_type: OutboundAggregateType;
    aggregate_id: string;
    command_type: OutboundCommandType;
    idempotency_key: string;
    expected_version: string | null;
    payload: Record<string, unknown>;
    status: OutboundCommandStatus;
    correlation_id: string;
    requested_by_membership_id: string | null;
    attempt_count: number;
    max_attempts: number;
    next_attempt_at: Date | null;
    lease_owner: string | null;
    lease_until: Date | null;
    result: Record<string, unknown> | null;
    last_error_code: string | null;
    last_error_message: string | null;
    succeeded_at: Date | null;
    failed_at: Date | null;
    version: string;
    created_at: Date;
    updated_at: Date;
}

export interface LockedOrderItemCommandContext {
    id: string;
    version: number;
    marketAccountId: string;
    marketCode: string;
    accountAuthStatus: string;
    accountIsActive: boolean;
    capabilities: unknown;
    settings: unknown;
}

export interface StoredOutboundCommand {
    id: string;
    tenantId: string;
    marketAccountId: string;
    orderItemId: string | null;
    aggregateType: OutboundAggregateType;
    aggregateId: string;
    type: OutboundCommandType;
    idempotencyKey: string;
    expectedVersion: number | null;
    payload: Record<string, unknown>;
    status: OutboundCommandStatus;
    correlationId: string;
    requestedByMembershipId: string | null;
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt: string | null;
    leaseOwner: string | null;
    leaseUntil: string | null;
    result: Record<string, unknown> | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    succeededAt: string | null;
    failedAt: string | null;
    version: number;
    createdAt: string;
    updatedAt: string;
}

const commandColumns = `
    id, tenant_id, market_account_id, order_item_id,
    aggregate_type, aggregate_id, command_type, idempotency_key,
    expected_version, payload, status, correlation_id,
    requested_by_membership_id, attempt_count, max_attempts,
    next_attempt_at, lease_owner, lease_until, result,
    last_error_code, last_error_message, succeeded_at, failed_at,
    version, created_at, updated_at`;

function toIso(value: Date | null): string | null {
    return value?.toISOString() ?? null;
}

function toStoredCommand(row: OutboundCommandRow): StoredOutboundCommand {
    return {
        id: row.id,
        tenantId: row.tenant_id,
        marketAccountId: row.market_account_id,
        orderItemId: row.order_item_id,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        type: row.command_type,
        idempotencyKey: row.idempotency_key,
        expectedVersion: row.expected_version === null ? null : Number(row.expected_version),
        payload: row.payload,
        status: row.status,
        correlationId: row.correlation_id,
        requestedByMembershipId: row.requested_by_membership_id,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        nextAttemptAt: toIso(row.next_attempt_at),
        leaseOwner: row.lease_owner,
        leaseUntil: toIso(row.lease_until),
        result: row.result,
        lastErrorCode: row.last_error_code,
        lastErrorMessage: row.last_error_message,
        succeededAt: toIso(row.succeeded_at),
        failedAt: toIso(row.failed_at),
        version: Number(row.version),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}

export async function lockOrderItemCommandContext(
    client: TransactionClient,
    tenantId: string,
    orderItemId: string,
): Promise<LockedOrderItemCommandContext | null> {
    const result = await client.query<OrderItemContextRow>(
        `SELECT oi.id,
                oi.version,
                oi.market_account_id,
                ma.market_code,
                ma.auth_status AS account_auth_status,
                ma.is_active AS account_is_active,
                ma.capabilities,
                ma.settings
           FROM order_items oi
           JOIN market_accounts ma
             ON ma.tenant_id = oi.tenant_id
            AND ma.id = oi.market_account_id
            AND ma.deleted_at IS NULL
          WHERE oi.tenant_id = $1
            AND oi.id = $2
            AND oi.deleted_at IS NULL
          FOR UPDATE OF oi, ma`,
        [tenantId, orderItemId],
    );
    const row = result.rows[0];

    if (!row) return null;

    return {
        id: row.id,
        version: Number(row.version),
        marketAccountId: row.market_account_id,
        marketCode: row.market_code,
        accountAuthStatus: row.account_auth_status,
        accountIsActive: row.account_is_active,
        capabilities: row.capabilities,
        settings: row.settings,
    };
}

export async function findOutboundCommandByIdempotencyKey(
    client: TransactionClient,
    tenantId: string,
    idempotencyKey: string,
): Promise<StoredOutboundCommand | null> {
    const result = await client.query<OutboundCommandRow>(
        `SELECT ${commandColumns}
           FROM outbound_commands
          WHERE tenant_id = $1
            AND idempotency_key = $2
            AND deleted_at IS NULL`,
        [tenantId, idempotencyKey],
    );

    return result.rows[0] ? toStoredCommand(result.rows[0]) : null;
}

export async function findOutboundCommandById(
    client: TransactionClient,
    tenantId: string,
    commandId: string,
): Promise<StoredOutboundCommand | null> {
    const result = await client.query<OutboundCommandRow>(
        `SELECT ${commandColumns}
           FROM outbound_commands
          WHERE tenant_id = $1
            AND id = $2
            AND deleted_at IS NULL`,
        [tenantId, commandId],
    );

    return result.rows[0] ? toStoredCommand(result.rows[0]) : null;
}

export async function insertPendingOutboundCommand(
    client: TransactionClient,
    marketAccountId: string,
    orderItemId: string,
    membershipId: string,
    command: OutboundCommand<unknown>,
): Promise<StoredOutboundCommand | null> {
    const result = await client.query<OutboundCommandRow>(
        `INSERT INTO outbound_commands (
             id, tenant_id, market_account_id, order_item_id,
             aggregate_type, aggregate_id, command_type, idempotency_key,
             expected_version, payload, status, correlation_id,
             requested_by_membership_id
         ) VALUES (
             $1, $2, $3, $4,
             $5, $6, $7, $8,
             $9, $10::jsonb, 'PENDING', $11::uuid,
             $12
         )
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
         RETURNING ${commandColumns}`,
        [
            command.id,
            command.tenantId,
            marketAccountId,
            orderItemId,
            command.aggregate.type,
            command.aggregate.id,
            command.type,
            command.idempotencyKey,
            command.aggregate.expectedVersion,
            JSON.stringify(command.payload),
            command.correlationId,
            membershipId,
        ],
    );

    return result.rows[0] ? toStoredCommand(result.rows[0]) : null;
}
