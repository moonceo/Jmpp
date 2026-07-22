import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import {
    getDbPool,
    withTenantTransaction,
    withTransaction,
    type TransactionClient,
} from "@/lib/server/db";
import {
    buildNaverAttemptIdentity,
    deriveNaverSuccessPatch,
} from "@/lib/server/commands/worker/policy";
import {
    deriveOutboundSalesOrderStatus,
    preserveTerminalSalesOrderStatus,
    type SalesOrderNormalizedStatus,
} from "@/lib/server/commands/worker/header-status";
import {
    NAVER_OUTBOUND_COMMAND_TYPES,
    type LeasedNaverOutboundCommand,
    type NaverCommandExecutionContext,
    type NaverCommandFinalization,
    type NaverCommandFinalizeResult,
    type NaverCommandOrderItem,
    type NaverOutboundCommandStore,
    type NaverOutboundCommandType,
    type PostgresNaverOutboundCommandStoreOptions,
} from "@/lib/server/commands/worker/types";

const CREDENTIAL_SECRET_TYPE = "MARKET_API_CREDENTIALS" as const;

interface LeaseRow extends QueryResultRow {
    id: string;
    tenant_id: string;
    market_account_id: string;
    order_item_id: string;
    command_type: string;
    attempt_count: number | string;
    max_attempts: number | string;
    expected_version: number | string | null;
    lease_purpose: "EXECUTE" | "RECONCILE";
    lease_owner: string;
    lease_until: Date;
}

interface ContextRow extends QueryResultRow {
    command_id: string;
    command_type: string;
    payload: Record<string, unknown>;
    previous_result: Record<string, unknown> | null;
    correlation_id: string;
    expected_version: number | string | null;
    attempt_count: number | string;
    max_attempts: number | string;
    account_active: boolean;
    account_auth_status: string;
    account_capabilities: Record<string, unknown>;
    account_settings: Record<string, unknown>;
    secret_id: string | null;
    encrypted_credentials: string | null;
    item_id: string | null;
    sales_order_id: string | null;
    item_version: number | string | null;
    external_order_item_id: string | null;
    item_quantity: number | string | null;
    internal_work_status: NaverCommandOrderItem["internalWorkStatus"] | null;
    market_status_raw: string | null;
    market_fulfillment_status: string | null;
    sourcing_status: string | null;
    market_delivery_method: "DELIVERY" | "DIRECT_DELIVERY" | null;
    domestic_carrier_code: string | null;
    domestic_tracking_number: string | null;
    confirmed_at: Date | null;
    market_invoice_submitted_at: Date | null;
    item_attributes: Record<string, unknown> | null;
}

interface FinalizeCommandRow extends QueryResultRow {
    command_type: string;
    order_item_id: string | null;
}

interface FinalizeItemRow extends QueryResultRow {
    id: string;
    sales_order_id: string;
    version: number | string;
    external_order_item_id: string | null;
    quantity: number | string;
    internal_work_status: NaverCommandOrderItem["internalWorkStatus"];
    market_status_raw: string;
    market_fulfillment_status: string | null;
    sourcing_status: string;
    market_delivery_method: "DELIVERY" | "DIRECT_DELIVERY" | null;
    domestic_carrier_code: string | null;
    domestic_tracking_number: string | null;
    confirmed_at: Date | null;
    market_invoice_submitted_at: Date | null;
    attributes: Record<string, unknown>;
}

interface AttemptRow extends QueryResultRow {
    started_at: Date;
}

interface SalesOrderStatusRow extends QueryResultRow {
    normalized_status: SalesOrderNormalizedStatus;
}

interface ItemStatusesRow extends QueryResultRow {
    item_statuses: SalesOrderNormalizedStatus[];
}

export class NaverOutboundCommandStoreError extends Error {
    constructor(
        readonly code:
            | "COMMAND_LEASE_LOST"
            | "COMMAND_CONTEXT_NOT_FOUND"
            | "COMMAND_ATTEMPT_NOT_FOUND",
        message: string,
    ) {
        super(message);
        this.name = "NaverOutboundCommandStoreError";
    }
}

function expiryDate(now: Date, durationMs: number): Date {
    return new Date(now.getTime() + durationMs);
}

function toLease(row: LeaseRow): LeasedNaverOutboundCommand {
    return {
        id: row.id,
        tenantId: row.tenant_id,
        marketAccountId: row.market_account_id,
        orderItemId: row.order_item_id,
        type: row.command_type,
        attemptCount: Number(row.attempt_count),
        maxAttempts: Number(row.max_attempts),
        expectedVersion: row.expected_version === null
            ? null
            : Number(row.expected_version),
        purpose: row.lease_purpose,
        leaseOwner: row.lease_owner,
        leaseUntil: row.lease_until.toISOString(),
    };
}

function toItem(row: ContextRow | FinalizeItemRow): NaverCommandOrderItem | null {
    const id = "item_id" in row ? row.item_id : row.id;
    const version = "item_version" in row ? row.item_version : row.version;
    const internalWorkStatus = row.internal_work_status;
    const marketStatusRaw = row.market_status_raw;
    const sourcingStatus = row.sourcing_status;
    const quantity = "item_quantity" in row ? row.item_quantity : row.quantity;

    if (
        !id
        || !row.sales_order_id
        || version === null
        || !internalWorkStatus
        || !marketStatusRaw
        || !sourcingStatus
        || quantity === null
        || !Number.isSafeInteger(Number(quantity))
        || Number(quantity) <= 0
    ) {
        return null;
    }

    return {
        id,
        salesOrderId: row.sales_order_id!,
        version: Number(version),
        externalOrderItemId: row.external_order_item_id,
        quantity: Number(quantity),
        internalWorkStatus,
        marketStatusRaw,
        marketFulfillmentStatus: row.market_fulfillment_status,
        sourcingStatus,
        marketDeliveryMethod: row.market_delivery_method,
        domesticCarrierCode: row.domestic_carrier_code,
        domesticTrackingNumber: row.domestic_tracking_number,
        confirmedAt: row.confirmed_at?.toISOString() ?? null,
        marketInvoiceSubmittedAt: row.market_invoice_submitted_at?.toISOString() ?? null,
        attributes: ("item_attributes" in row ? row.item_attributes : row.attributes) ?? {},
    };
}

async function lockMarketAccountLifecycle(
    client: TransactionClient,
    marketAccountId: string,
): Promise<void> {
    await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [marketAccountId],
    );
}

async function recomputeSalesOrderStatus(
    client: TransactionClient,
    input: {
        tenantId: string;
        marketAccountId: string;
        salesOrderId: string;
    },
): Promise<void> {
    const header = await client.query<SalesOrderStatusRow>(
        `SELECT normalized_status
           FROM sales_orders
          WHERE tenant_id = $1
            AND market_account_id = $2
            AND id = $3
            AND deleted_at IS NULL
          FOR UPDATE`,
        [input.tenantId, input.marketAccountId, input.salesOrderId],
    );
    const current = header.rows[0]?.normalized_status;
    if (!current) return;

    const aggregate = await client.query<ItemStatusesRow>(
        `SELECT COALESCE(
                    array_agg(internal_work_status ORDER BY id),
                    ARRAY[]::text[]
                ) AS item_statuses
           FROM order_items
          WHERE tenant_id = $1
            AND market_account_id = $2
            AND sales_order_id = $3
            AND deleted_at IS NULL`,
        [input.tenantId, input.marketAccountId, input.salesOrderId],
    );
    const derived = deriveOutboundSalesOrderStatus(
        aggregate.rows[0]?.item_statuses ?? [],
    );
    const next = preserveTerminalSalesOrderStatus(current, derived);
    if (next === current) return;

    await client.query(
        `UPDATE sales_orders
            SET normalized_status = $4
          WHERE tenant_id = $1
            AND market_account_id = $2
            AND id = $3`,
        [input.tenantId, input.marketAccountId, input.salesOrderId, next],
    );
}

function isNaverCommandType(value: string): value is NaverOutboundCommandType {
    return (NAVER_OUTBOUND_COMMAND_TYPES as readonly string[]).includes(value);
}

function invariantUnknown(
    resolution: NaverCommandFinalization,
    violations: readonly string[],
): NaverCommandFinalization {
    return {
        status: "UNKNOWN",
        attemptOutcome: "UNKNOWN",
        code: "LOCAL_INVARIANT_CONFLICT",
        message: "LOCAL_INVARIANT_CONFLICT",
        responseSummary: {
            ...resolution.responseSummary,
            localProjection: "DEFERRED",
            violations,
        },
    };
}

export class PostgresNaverOutboundCommandStore implements NaverOutboundCommandStore {
    private readonly pool: Pool;

    constructor(options: PostgresNaverOutboundCommandStoreOptions = {}) {
        this.pool = options.pool ?? getDbPool();
    }

    async leaseNext(input: {
        leaseOwner: string;
        now: Date;
        leaseDurationMs: number;
    }): Promise<LeasedNaverOutboundCommand | null> {
        return withTransaction(async (client) => {
            await client.query(
                `WITH expired AS MATERIALIZED (
                     SELECT oc.id, oc.tenant_id, oc.market_account_id,
                            oc.lease_purpose
                       FROM outbound_commands oc
                       JOIN market_accounts ma
                         ON ma.tenant_id = oc.tenant_id
                        AND ma.id = oc.market_account_id
                        AND ma.market_code = 'NAVER'
                        AND ma.deleted_at IS NULL
                      WHERE oc.status = 'LEASED'
                        AND oc.lease_until <= $1::timestamptz
                        AND oc.deleted_at IS NULL
                      ORDER BY oc.lease_until, oc.id
                      FOR UPDATE OF oc SKIP LOCKED
                      LIMIT 100
                 ), closed_attempts AS (
                     UPDATE outbound_attempts oa
                        SET outcome = 'UNKNOWN',
                            provider_code = 'WORKER_LEASE_EXPIRED',
                            provider_message = 'The worker lease expired before the result was recorded.',
                            response_summary = jsonb_build_object(
                                'provider', 'NAVER',
                                'applied', 'UNKNOWN',
                                'reason', 'WORKER_LEASE_EXPIRED'
                            ),
                            completed_at = $1::timestamptz,
                            duration_ms = GREATEST(
                                0,
                                FLOOR(EXTRACT(EPOCH FROM ($1::timestamptz - oa.started_at)) * 1000)::integer
                            )
                       FROM expired
                      WHERE oa.tenant_id = expired.tenant_id
                        AND oa.market_account_id = expired.market_account_id
                        AND oa.outbound_command_id = expired.id
                        AND oa.outcome = 'IN_PROGRESS'
                        AND oa.deleted_at IS NULL
                     RETURNING oa.id
                 )
                 UPDATE outbound_commands oc
                    SET status = 'UNKNOWN',
                        max_attempts = CASE
                            WHEN expired.lease_purpose = 'EXECUTE'
                                THEN GREATEST(oc.max_attempts, oc.attempt_count + 3)
                            ELSE oc.max_attempts
                        END,
                        lease_owner = NULL,
                        lease_until = NULL,
                        lease_purpose = NULL,
                        result = jsonb_build_object(
                            'provider', 'NAVER',
                            'applied', 'UNKNOWN',
                            'reason', 'WORKER_LEASE_EXPIRED'
                        ),
                        last_error_code = 'WORKER_LEASE_EXPIRED',
                        last_error_message = 'The worker lease expired before the result was recorded.'
                   FROM expired
                  WHERE oc.tenant_id = expired.tenant_id
                    AND oc.id = expired.id`,
                [input.now],
            );

            await client.query(
                `UPDATE outbound_commands oc
                    SET status = 'FAILED',
                        failed_at = $1::timestamptz,
                        result = COALESCE(oc.result, '{}'::jsonb) || jsonb_build_object(
                            'provider', 'NAVER',
                            'applied', 'UNKNOWN',
                            'reason', 'RECONCILIATION_ATTEMPTS_EXHAUSTED',
                            'requiresManualResolution', true
                        ),
                        last_error_code = 'RECONCILIATION_ATTEMPTS_EXHAUSTED',
                        last_error_message = 'Automatic provider-state reconciliation exhausted its bounded attempt budget.'
                   FROM market_accounts ma
                  WHERE ma.tenant_id = oc.tenant_id
                    AND ma.id = oc.market_account_id
                    AND ma.market_code = 'NAVER'
                    AND ma.deleted_at IS NULL
                    AND oc.status = 'UNKNOWN'
                    AND oc.attempt_count >= oc.max_attempts
                    AND oc.deleted_at IS NULL`,
                [input.now],
            );

            await client.query(
                `UPDATE outbound_commands oc
                    SET status = 'DEAD',
                        failed_at = $1::timestamptz,
                        lease_owner = NULL,
                        lease_until = NULL,
                        lease_purpose = NULL,
                        last_error_code = 'COMMAND_MAX_ATTEMPTS_EXHAUSTED',
                        last_error_message = 'The command exhausted its retry budget.'
                   FROM market_accounts ma
                  WHERE ma.tenant_id = oc.tenant_id
                    AND ma.id = oc.market_account_id
                    AND ma.market_code = 'NAVER'
                    AND ma.deleted_at IS NULL
                    AND oc.status IN ('PENDING', 'RETRY')
                    AND oc.attempt_count >= oc.max_attempts
                    AND oc.deleted_at IS NULL`,
                [input.now],
            );

            const leaseUntil = expiryDate(input.now, input.leaseDurationMs);
            const result = await client.query<LeaseRow>(
                `WITH candidate AS (
                     SELECT oc.id,
                            CASE
                                WHEN oc.status = 'UNKNOWN' THEN 'RECONCILE'
                                ELSE 'EXECUTE'
                            END AS lease_purpose
                       FROM outbound_commands oc
                       JOIN market_accounts ma
                         ON ma.tenant_id = oc.tenant_id
                        AND ma.id = oc.market_account_id
                        AND ma.market_code = 'NAVER'
                         AND ma.deleted_at IS NULL
                      WHERE oc.aggregate_type = 'ORDER_ITEM'
                        AND oc.order_item_id IS NOT NULL
                        AND oc.status IN ('PENDING', 'RETRY', 'UNKNOWN')
                        AND (
                            oc.status = 'UNKNOWN'
                            OR (ma.is_active AND ma.auth_status = 'CONNECTED')
                        )
                        AND oc.next_attempt_at <= $1::timestamptz
                        AND oc.attempt_count < oc.max_attempts
                        AND oc.deleted_at IS NULL
                      ORDER BY CASE WHEN oc.status = 'UNKNOWN' THEN 0 ELSE 1 END,
                               oc.next_attempt_at, oc.created_at, oc.id
                      FOR UPDATE OF oc SKIP LOCKED
                      LIMIT 1
                 )
                 UPDATE outbound_commands oc
                    SET status = 'LEASED',
                        attempt_count = oc.attempt_count + 1,
                        lease_owner = $2,
                        lease_until = $3::timestamptz,
                        lease_purpose = candidate.lease_purpose,
                        last_error_code = NULL,
                        last_error_message = NULL
                   FROM candidate
                  WHERE oc.id = candidate.id
                 RETURNING oc.id, oc.tenant_id, oc.market_account_id,
                           oc.order_item_id, oc.command_type, oc.attempt_count,
                           oc.max_attempts, oc.expected_version, oc.lease_owner,
                           oc.lease_until, oc.lease_purpose`,
                [input.now, input.leaseOwner, leaseUntil],
            );

            return result.rows[0] ? toLease(result.rows[0]) : null;
        }, {}, this.pool);
    }

    async beginAttempt(input: {
        lease: LeasedNaverOutboundCommand;
        leaseOwner: string;
        now: Date;
    }): Promise<NaverCommandExecutionContext> {
        return withTenantTransaction(input.lease.tenantId, async (client) => {
            const result = await client.query<ContextRow>(
                `SELECT oc.id AS command_id,
                        oc.command_type,
                        oc.payload,
                        oc.result AS previous_result,
                        oc.correlation_id,
                        oc.expected_version,
                        oc.attempt_count,
                        oc.max_attempts,
                        ma.is_active AS account_active,
                        ma.auth_status AS account_auth_status,
                        ma.capabilities AS account_capabilities,
                        ma.settings AS account_settings,
                        secret.id AS secret_id,
                        secret.encrypted_payload AS encrypted_credentials,
                        oi.id AS item_id,
                        oi.sales_order_id,
                        oi.version AS item_version,
                        oi.external_order_item_id,
                        oi.quantity AS item_quantity,
                        oi.internal_work_status,
                        oi.market_status_raw,
                        oi.market_fulfillment_status,
                        oi.sourcing_status,
                        oi.market_delivery_method,
                        oi.domestic_carrier_code,
                        oi.domestic_tracking_number,
                        oi.confirmed_at,
                        oi.market_invoice_submitted_at,
                        oi.attributes AS item_attributes
                   FROM outbound_commands oc
                   JOIN market_accounts ma
                     ON ma.tenant_id = oc.tenant_id
                    AND ma.id = oc.market_account_id
                    AND ma.market_code = 'NAVER'
                    AND ma.deleted_at IS NULL
                   LEFT JOIN order_items oi
                     ON oi.tenant_id = oc.tenant_id
                    AND oi.market_account_id = oc.market_account_id
                    AND oi.id = oc.order_item_id
                    AND oi.deleted_at IS NULL
                   LEFT JOIN LATERAL (
                     SELECT s.id, s.encrypted_payload
                       FROM integration_secrets s
                      WHERE s.tenant_id = oc.tenant_id
                        AND s.market_account_id = oc.market_account_id
                        AND s.secret_type = $6
                        AND s.revoked_at IS NULL
                        AND s.deleted_at IS NULL
                        AND (s.expires_at IS NULL OR s.expires_at > $5::timestamptz)
                      ORDER BY s.created_at DESC, s.id DESC
                      LIMIT 1
                   ) secret ON true
                  WHERE oc.tenant_id = $1
                    AND oc.market_account_id = $2
                    AND oc.id = $3
                    AND oc.status = 'LEASED'
                    AND oc.lease_owner = $4
                    AND oc.lease_until > $5::timestamptz
                    AND oc.deleted_at IS NULL
                  FOR UPDATE OF oc`,
                [
                    input.lease.tenantId,
                    input.lease.marketAccountId,
                    input.lease.id,
                    input.leaseOwner,
                    input.now,
                    CREDENTIAL_SECRET_TYPE,
                ],
            );
            const row = result.rows[0];
            if (!row) {
                throw new NaverOutboundCommandStoreError(
                    "COMMAND_CONTEXT_NOT_FOUND",
                    "The leased command context is unavailable.",
                );
            }

            const item = toItem(row);
            const identity = buildNaverAttemptIdentity({
                commandId: row.command_id,
                type: row.command_type,
                productOrderId: item?.externalOrderItemId ?? null,
                payload: row.payload,
            });
            const attemptId = randomUUID();
            await client.query(
                `INSERT INTO outbound_attempts (
                     id, tenant_id, market_account_id, outbound_command_id,
                     attempt_number, request_sha256, request_summary, outcome,
                     started_at
                 ) VALUES (
                     $1, $2, $3, $4,
                     $5, $6, $7::jsonb, 'IN_PROGRESS',
                     $8::timestamptz
                 )`,
                [
                    attemptId,
                    input.lease.tenantId,
                    input.lease.marketAccountId,
                    input.lease.id,
                    Number(row.attempt_count),
                    identity.requestSha256,
                    JSON.stringify(identity.requestSummary),
                    input.now,
                ],
            );
            if (row.secret_id) {
                await client.query(
                    `UPDATE integration_secrets
                        SET last_used_at = $3::timestamptz
                      WHERE tenant_id = $1
                        AND id = $2`,
                    [input.lease.tenantId, row.secret_id, input.now],
                );
            }

            return {
                lease: {
                    ...input.lease,
                    type: row.command_type,
                    attemptCount: Number(row.attempt_count),
                    maxAttempts: Number(row.max_attempts),
                    expectedVersion: row.expected_version === null
                        ? null
                        : Number(row.expected_version),
                },
                attemptId,
                payload: row.payload,
                previousResult: row.previous_result,
                correlationId: row.correlation_id,
                accountActive: row.account_active,
                accountAuthStatus: row.account_auth_status,
                accountCapabilities: row.account_capabilities ?? {},
                accountSettings: row.account_settings ?? {},
                encryptedCredentials: row.encrypted_credentials,
                credentialSecretType: CREDENTIAL_SECRET_TYPE,
                item,
            };
        }, {}, this.pool);
    }

    async finalize(input: {
        context: NaverCommandExecutionContext;
        leaseOwner: string;
        now: Date;
        resolution: NaverCommandFinalization;
    }): Promise<NaverCommandFinalizeResult> {
        return withTenantTransaction(input.context.lease.tenantId, async (client) => {
            const lease = input.context.lease;
            await lockMarketAccountLifecycle(client, lease.marketAccountId);

            const commandResult = await client.query<FinalizeCommandRow>(
                `SELECT command_type, order_item_id
                   FROM outbound_commands
                  WHERE tenant_id = $1
                    AND market_account_id = $2
                    AND id = $3
                    AND status = 'LEASED'
                    AND lease_owner = $4
                    AND lease_until > $5::timestamptz
                    AND deleted_at IS NULL
                  FOR UPDATE`,
                [lease.tenantId, lease.marketAccountId, lease.id, input.leaseOwner, input.now],
            );
            const command = commandResult.rows[0];
            if (!command) {
                throw new NaverOutboundCommandStoreError(
                    "COMMAND_LEASE_LOST",
                    "The command is no longer leased by this worker.",
                );
            }

            const attemptResult = await client.query<AttemptRow>(
                `SELECT started_at
                   FROM outbound_attempts
                  WHERE tenant_id = $1
                    AND market_account_id = $2
                    AND outbound_command_id = $3
                    AND id = $4
                    AND outcome = 'IN_PROGRESS'
                    AND deleted_at IS NULL
                  FOR UPDATE`,
                [lease.tenantId, lease.marketAccountId, lease.id, input.context.attemptId],
            );
            const attempt = attemptResult.rows[0];
            if (!attempt) {
                throw new NaverOutboundCommandStoreError(
                    "COMMAND_ATTEMPT_NOT_FOUND",
                    "The in-progress command attempt is unavailable.",
                );
            }

            const itemResult = command.order_item_id
                ? await client.query<FinalizeItemRow>(
                    `SELECT id, sales_order_id, version, external_order_item_id, quantity,
                            internal_work_status, market_status_raw,
                            market_fulfillment_status, sourcing_status,
                            market_delivery_method, domestic_carrier_code,
                            domestic_tracking_number, confirmed_at,
                            market_invoice_submitted_at, attributes
                       FROM order_items
                      WHERE tenant_id = $1
                        AND market_account_id = $2
                        AND id = $3
                        AND deleted_at IS NULL
                      FOR UPDATE`,
                    [lease.tenantId, lease.marketAccountId, command.order_item_id],
                )
                : null;
            const item = itemResult?.rows[0] ? toItem(itemResult.rows[0]) : null;
            let resolution = input.resolution;

            if (resolution.status === "SUCCEEDED") {
                if (!item || !isNaverCommandType(command.command_type)) {
                    resolution = invariantUnknown(resolution, ["ORDER_ITEM_OR_COMMAND_MISSING"]);
                } else {
                    const patch = deriveNaverSuccessPatch({
                        type: command.command_type,
                        item,
                        commandId: lease.id,
                        now: input.now.toISOString(),
                    });
                    if (!patch.ok) {
                        resolution = invariantUnknown(resolution, patch.violations);
                    } else {
                        await client.query(
                            `UPDATE order_items
                                SET confirmed_at = $4::timestamptz,
                                    market_invoice_submitted_at = $5::timestamptz,
                                    market_delivery_method = $6,
                                    market_fulfillment_status = $7,
                                    internal_work_status = $8
                              WHERE tenant_id = $1
                                AND market_account_id = $2
                                AND id = $3`,
                            [
                                lease.tenantId,
                                lease.marketAccountId,
                                item.id,
                                patch.confirmedAt,
                                patch.marketInvoiceSubmittedAt,
                                patch.marketDeliveryMethod,
                                patch.marketFulfillmentStatus,
                                patch.internalWorkStatus,
                            ],
                        );
                        await recomputeSalesOrderStatus(client, {
                            tenantId: lease.tenantId,
                            marketAccountId: lease.marketAccountId,
                            salesOrderId: item.salesOrderId,
                        });
                    }
                }
            }

            const completedAt = input.now;
            const durationMs = Math.max(0, completedAt.getTime() - attempt.started_at.getTime());
            await client.query(
                `UPDATE outbound_attempts
                    SET outcome = $5,
                        response_summary = $6::jsonb,
                        http_status = $7,
                        provider_code = $8,
                        provider_message = $9,
                        completed_at = $10::timestamptz,
                        duration_ms = $11
                  WHERE tenant_id = $1
                    AND market_account_id = $2
                    AND outbound_command_id = $3
                    AND id = $4`,
                [
                    lease.tenantId,
                    lease.marketAccountId,
                    lease.id,
                    input.context.attemptId,
                    resolution.attemptOutcome,
                    JSON.stringify(resolution.responseSummary),
                    resolution.httpStatus ?? null,
                    resolution.code,
                    resolution.message,
                    completedAt,
                    durationMs,
                ],
            );

            const failedAt = resolution.status === "FAILED" || resolution.status === "DEAD"
                ? completedAt
                : null;
            const succeededAt = resolution.status === "SUCCEEDED" ? completedAt : null;
            await client.query(
                `UPDATE outbound_commands
                    SET status = $5,
                        next_attempt_at = CASE
                            WHEN $5 IN ('RETRY', 'UNKNOWN') THEN $6::timestamptz
                            ELSE next_attempt_at
                        END,
                        lease_owner = NULL,
                        lease_until = NULL,
                        lease_purpose = NULL,
                        max_attempts = CASE
                            WHEN $5 = 'UNKNOWN' AND $12 = 'EXECUTE'
                                THEN GREATEST(max_attempts, attempt_count + 3)
                            ELSE max_attempts
                        END,
                        result = $7::jsonb,
                        last_error_code = $8,
                        last_error_message = $9,
                        succeeded_at = $10::timestamptz,
                        failed_at = $11::timestamptz
                  WHERE tenant_id = $1
                    AND market_account_id = $2
                    AND id = $3
                    AND lease_owner = $4`,
                [
                    lease.tenantId,
                    lease.marketAccountId,
                    lease.id,
                    input.leaseOwner,
                    resolution.status,
                    resolution.nextAttemptAt ?? input.now,
                    JSON.stringify({
                        ...resolution.responseSummary,
                        reconciled: resolution.reconciled ?? false,
                    }),
                    resolution.status === "SUCCEEDED" ? null : resolution.code,
                    resolution.status === "SUCCEEDED" ? null : resolution.message,
                    succeededAt,
                    failedAt,
                    lease.purpose,
                ],
            );

            return { status: resolution.status };
        }, {}, this.pool);
    }
}
