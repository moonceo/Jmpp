import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { TransactionClient } from "@/lib/server/db";
import {
    isClaimStatusTransitionAllowed,
    unavailableClaimActions,
} from "@/lib/server/claims/domain";
import type {
    ClaimCursorPage,
    ClaimDetail,
    ClaimEventView,
    ClaimLineView,
    ClaimListItem,
    ClaimListQuery,
    ClaimStatus,
    InboundClaimUpsertResult,
    PreparedInboundClaimSnapshot,
} from "@/lib/server/claims/types";
import { ApiError } from "@/lib/server/http/api-error";
import type { OrderMarketCode } from "@/lib/server/repositories/orders";

const cursorSchema = z.object({
    v: z.literal(1),
    sourceUpdatedAt: z.iso.datetime(),
    id: z.uuid(),
    filterHash: z.string().regex(/^[0-9a-f]{64}$/),
});

interface PersistedClaimRow extends QueryResultRow {
    id: string;
    sales_order_id: string;
    market_account_id: string;
    claim_type: PreparedInboundClaimSnapshot["claimType"];
    normalized_status: ClaimStatus;
    source_updated_at: Date;
    version: string;
}

interface PersistedClaimCaseStateRow extends PersistedClaimRow {
    source: PreparedInboundClaimSnapshot["source"];
    requester_type: PreparedInboundClaimSnapshot["requesterType"];
    fault_type: PreparedInboundClaimSnapshot["faultType"];
    market_status_raw: string;
    market_reason_code: string | null;
    deadline_at: Date | null;
    deadline_type: string | null;
    resolution_type: PreparedInboundClaimSnapshot["resolutionType"];
    resolution_status: PreparedInboundClaimSnapshot["resolutionStatus"];
    requested_at: Date;
    reviewed_at: Date | null;
    approved_at: Date | null;
    rejected_at: Date | null;
    collection_started_at: Date | null;
    received_at: Date | null;
    resolved_at: Date | null;
    completed_at: Date | null;
    source_created_at: Date | null;
}

interface DuplicateEventRow extends PersistedClaimRow {
    event_payload_sha256: string;
}

interface OrderContextRow extends QueryResultRow {
    id: string;
    normalized_status: string;
}

interface ItemContextRow extends QueryResultRow {
    id: string;
    external_order_item_id: string;
    quantity: number;
    internal_work_status: string;
    sourcing_status: string;
    market_fulfillment_status: string | null;
}

interface PersistedClaimLineStateRow extends QueryResultRow {
    order_item_id: string;
    external_claim_line_id: string | null;
    requested_quantity: number;
    normalized_status: ClaimStatus;
    market_status_raw: string;
    market_reason_code: string | null;
    resolution_type: PreparedInboundClaimSnapshot["lines"][number]["resolutionType"];
    resolution_status: PreparedInboundClaimSnapshot["lines"][number]["resolutionStatus"];
    refund_amount: string | null;
    refund_currency: string | null;
    source_updated_at: Date;
}

interface ClaimListRow extends QueryResultRow {
    id: string;
    market_account_id: string;
    market_code: OrderMarketCode;
    store_name: string;
    sales_order_id: string;
    external_order_id: string;
    external_order_number: string | null;
    external_claim_id: string;
    claim_type: ClaimListItem["claimType"];
    source: ClaimListItem["source"];
    requester_type: ClaimListItem["requesterType"];
    fault_type: ClaimListItem["faultType"];
    normalized_status: ClaimStatus;
    market_status_raw: string;
    market_reason_code: string | null;
    market_reason_masked: string | null;
    deadline_at: Date | null;
    deadline_type: string | null;
    resolution_type: ClaimListItem["resolutionType"];
    resolution_status: ClaimListItem["resolutionStatus"];
    purchase_compensation_status: ClaimListItem["purchaseCompensationStatus"];
    purchase_compensation_reference: string | null;
    purchase_compensation_next_action_at: Date | null;
    requested_at: Date;
    source_updated_at: Date;
    buyer_name_masked: string | null;
    recipient_name_masked: string | null;
    affected_line_count: number;
    total_claim_quantity: string;
    version: string;
    provider_processing_id: string | null;
    provider_error_code: string | null;
    raw_snapshot_available: boolean;
    order_status_at_request: string;
    item_status_at_request: string;
    sourcing_status_at_request: string;
    fulfillment_status_at_request: string | null;
    reviewed_at: Date | null;
    approved_at: Date | null;
    rejected_at: Date | null;
    collection_started_at: Date | null;
    received_at: Date | null;
    resolved_at: Date | null;
    completed_at: Date | null;
    purchase_compensation_completed_at: Date | null;
}

interface ClaimLineRow extends QueryResultRow {
    id: string;
    order_item_id: string;
    external_order_item_id: string | null;
    external_claim_line_id: string | null;
    product_name: string;
    option_name: string | null;
    ordered_quantity: number;
    requested_quantity: number;
    item_status_at_request: string;
    sourcing_status_at_request: string;
    fulfillment_status_at_request: string | null;
    normalized_status: ClaimLineView["normalizedStatus"];
    market_status_raw: string;
    market_reason_code: string | null;
    market_reason_masked: string | null;
    resolution_type: ClaimLineView["resolutionType"];
    resolution_status: ClaimLineView["resolutionStatus"];
    refund_amount: string | null;
    refund_currency: string | null;
    version: string;
}

interface ClaimEventRow extends QueryResultRow {
    id: string;
    external_event_id: string | null;
    event_type: string;
    event_source: string;
    from_status: ClaimStatus | null;
    to_status: ClaimStatus | null;
    market_status_raw: string | null;
    market_reason_code: string | null;
    source_occurred_at: Date | null;
    received_at: Date;
}

export class ClaimPersistenceError extends Error {
    constructor(
        readonly code:
            | "CLAIM_ORDER_NOT_FOUND"
            | "CLAIM_ORDER_ITEM_NOT_FOUND"
            | "CLAIM_IDENTITY_CONFLICT"
            | "CLAIM_EVENT_IDENTITY_CONFLICT",
        message: string,
    ) {
        super(message);
        this.name = "ClaimPersistenceError";
    }
}

function combinedSnapshot(values: readonly (string | null)[]): string | null {
    const distinct = [...new Set(values)];
    if (distinct.length === 1) return distinct[0];
    return distinct.length === 0 ? null : "MULTIPLE";
}

function initialPurchaseCompensationStatus(
    sourcingStatuses: readonly string[],
): ClaimListItem["purchaseCompensationStatus"] {
    if (sourcingStatuses.some((status) => ["PAID", "INVOICE_RECEIVED", "EXTERNAL_PURCHASE"].includes(status))) {
        return "NEEDS_ATTENTION";
    }
    if (sourcingStatuses.some((status) => status === "HOLD")) return "UNKNOWN";
    return "NOT_REQUIRED";
}

function sameInstant(left: Date | null, right: Date | null): boolean {
    return left?.getTime() === right?.getTime();
}

function hasCompatibleCaseSemantics(
    existing: PersistedClaimCaseStateRow,
    input: PreparedInboundClaimSnapshot,
): boolean {
    return existing.source === input.source
        && existing.requester_type === input.requesterType
        && existing.fault_type === input.faultType
        && existing.normalized_status === input.normalizedStatus
        && existing.market_status_raw === input.marketStatusRaw
        && existing.market_reason_code === input.marketReasonCode
        && sameInstant(existing.deadline_at, input.deadlineAt)
        && existing.deadline_type === input.deadlineType
        && existing.resolution_type === input.resolutionType
        && existing.resolution_status === input.resolutionStatus
        && sameInstant(existing.requested_at, input.requestedAt)
        && sameInstant(existing.reviewed_at, input.reviewedAt)
        && sameInstant(existing.approved_at, input.approvedAt)
        && sameInstant(existing.rejected_at, input.rejectedAt)
        && sameInstant(existing.collection_started_at, input.collectionStartedAt)
        && sameInstant(existing.received_at, input.receivedAt)
        && sameInstant(existing.resolved_at, input.resolvedAt)
        && sameInstant(existing.completed_at, input.completedAt)
        && sameInstant(existing.source_created_at, input.sourceCreatedAt);
}

function hasSameLineSemantics(
    existing: PersistedClaimLineStateRow,
    input: PreparedInboundClaimSnapshot["lines"][number],
): boolean {
    return existing.external_claim_line_id === input.externalClaimLineId
        && existing.requested_quantity === input.requestedQuantity
        && existing.normalized_status === input.normalizedStatus
        && existing.market_status_raw === input.marketStatusRaw
        && existing.market_reason_code === input.marketReasonCode
        && existing.resolution_type === input.resolutionType
        && existing.resolution_status === input.resolutionStatus
        && existing.refund_amount === input.refundAmount
        && existing.refund_currency === input.refundCurrency;
}

async function insertClaimEvent(
    client: TransactionClient,
    input: PreparedInboundClaimSnapshot,
    claimId: string,
    eventType: string,
    fromStatus: ClaimStatus | null,
    toStatus: ClaimStatus | null,
    eventContext: Readonly<Record<string, unknown>> | null = null,
): Promise<void> {
    const lineSnapshots = [...input.lines]
        .sort((left, right) => (
            left.externalOrderItemId < right.externalOrderItemId ? -1
                : left.externalOrderItemId > right.externalOrderItemId ? 1
                    : 0
        ))
        .map((line) => ({
            externalClaimLineId: line.externalClaimLineId,
            externalOrderItemId: line.externalOrderItemId,
            lineKey: line.lineKey,
            requestedQuantity: line.requestedQuantity,
            normalizedStatus: line.normalizedStatus,
            marketStatusRaw: line.marketStatusRaw,
            marketReasonCode: line.marketReasonCode,
            marketReasonEncrypted: line.marketReasonEncrypted,
            marketReasonMasked: line.marketReasonMasked,
            resolutionType: line.resolutionType,
            resolutionStatus: line.resolutionStatus,
            refundAmount: line.refundAmount,
            refundCurrency: line.refundCurrency,
        }));
    await client.query(
        `INSERT INTO claim_events (
             tenant_id, market_account_id, claim_case_id, external_event_id,
             event_key, event_type, event_source, from_status, to_status,
             market_status_raw, market_reason_code, payload_sha256, snapshot,
             correlation_id, source_occurred_at
         ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::uuid,$15
         )
         ON CONFLICT DO NOTHING`,
        [
            input.tenantId,
            input.marketAccountId,
            claimId,
            input.externalEventId,
            input.eventKey,
            eventType,
            input.source,
            fromStatus,
            toStatus,
            input.marketStatusRaw,
            input.marketReasonCode,
            input.payloadSha256,
            JSON.stringify({
                claimType: input.claimType,
                source: input.source,
                requesterType: input.requesterType,
                faultType: input.faultType,
                normalizedStatus: input.normalizedStatus,
                marketReasonEncrypted: input.marketReasonEncrypted,
                marketReasonMasked: input.marketReasonMasked,
                deadlineAt: input.deadlineAt?.toISOString() ?? null,
                deadlineType: input.deadlineType,
                resolutionType: input.resolutionType,
                resolutionStatus: input.resolutionStatus,
                lineCount: lineSnapshots.length,
                lines: lineSnapshots,
                eventContext,
            }),
            input.correlationId,
            input.sourceUpdatedAt,
        ],
    );
}

function resultFromRow(
    row: PersistedClaimRow,
    values: Pick<InboundClaimUpsertResult, "applied" | "replayed" | "ignoredReason">,
): InboundClaimUpsertResult {
    return {
        claimId: row.id,
        version: row.version,
        normalizedStatus: row.normalized_status,
        ...values,
    };
}

/**
 * Idempotently applies one provider snapshot. The caller owns the transaction;
 * all identity, quantity, line, event, and audit writes are atomic.
 */
export async function persistInboundClaimSnapshot(
    client: TransactionClient,
    input: PreparedInboundClaimSnapshot,
): Promise<InboundClaimUpsertResult> {
    await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [`claim:${input.tenantId}:${input.marketAccountId}:${input.externalClaimId}`],
    );

    const duplicate = await client.query<DuplicateEventRow>(
        `SELECT claim.id, claim.sales_order_id, claim.market_account_id,
                claim.claim_type, claim.normalized_status,
                claim.source_updated_at, claim.version::text AS version,
                event.payload_sha256 AS event_payload_sha256
           FROM claim_events event
           JOIN claim_cases claim
             ON claim.tenant_id = event.tenant_id
            AND claim.id = event.claim_case_id
          WHERE event.tenant_id = $1
            AND event.market_account_id = $2
            AND claim.external_claim_id = $4
            AND claim.deleted_at IS NULL
            AND (
                ($3::text IS NOT NULL AND event.external_event_id = $3)
                OR event.event_key = $5
            )
          LIMIT 1`,
        [
            input.tenantId,
            input.marketAccountId,
            input.externalEventId,
            input.externalClaimId,
            input.eventKey,
        ],
    );
    if (duplicate.rows[0]) {
        if (duplicate.rows[0].event_payload_sha256 !== input.payloadSha256) {
            throw new ClaimPersistenceError(
                "CLAIM_EVENT_IDENTITY_CONFLICT",
                "The external event identity was reused with a different payload.",
            );
        }
        return resultFromRow(duplicate.rows[0], {
            applied: false,
            replayed: true,
            ignoredReason: "DUPLICATE_EVENT",
        });
    }

    const orderResult = await client.query<OrderContextRow>(
        `SELECT id, normalized_status
           FROM sales_orders
          WHERE tenant_id = $1
            AND market_account_id = $2
            AND external_order_id = $3
            AND deleted_at IS NULL
          FOR UPDATE`,
        [input.tenantId, input.marketAccountId, input.externalOrderId],
    );
    const order = orderResult.rows[0];
    if (!order) {
        throw new ClaimPersistenceError("CLAIM_ORDER_NOT_FOUND", "The claim order is unavailable.");
    }

    const externalItemIds = input.lines.map((line) => line.externalOrderItemId);
    const itemResult = await client.query<ItemContextRow>(
        `SELECT id, external_order_item_id, quantity, internal_work_status,
                sourcing_status, market_fulfillment_status
           FROM order_items
          WHERE tenant_id = $1
            AND market_account_id = $2
            AND sales_order_id = $3
            AND external_order_item_id = ANY($4::text[])
            AND deleted_at IS NULL
          FOR UPDATE`,
        [input.tenantId, input.marketAccountId, order.id, externalItemIds],
    );
    const items = new Map(itemResult.rows.map((row) => [row.external_order_item_id, row]));
    if (items.size !== externalItemIds.length) {
        throw new ClaimPersistenceError("CLAIM_ORDER_ITEM_NOT_FOUND", "One or more claim order items are unavailable.");
    }

    const existingResult = await client.query<PersistedClaimCaseStateRow>(
        `SELECT id, sales_order_id, market_account_id, claim_type,
                source, requester_type, fault_type, normalized_status,
                market_status_raw, market_reason_code, deadline_at,
                deadline_type, resolution_type, resolution_status,
                requested_at, reviewed_at, approved_at, rejected_at,
                collection_started_at, received_at, resolved_at, completed_at,
                source_created_at, source_updated_at, version::text AS version
           FROM claim_cases
          WHERE tenant_id = $1
            AND market_account_id = $2
            AND external_claim_id = $3
            AND deleted_at IS NULL
          FOR UPDATE`,
        [input.tenantId, input.marketAccountId, input.externalClaimId],
    );
    const existing = existingResult.rows[0];
    if (existing && (
        existing.sales_order_id !== order.id
        || existing.market_account_id !== input.marketAccountId
        || existing.claim_type !== input.claimType
    )) {
        throw new ClaimPersistenceError(
            "CLAIM_IDENTITY_CONFLICT",
            "The external claim identity is already bound to another immutable claim.",
        );
    }

    if (existing && input.sourceUpdatedAt.getTime() < existing.source_updated_at.getTime()) {
        await insertClaimEvent(
            client,
            input,
            existing.id,
            "SNAPSHOT_IGNORED_STALE",
            existing.normalized_status,
            input.normalizedStatus,
        );
        return resultFromRow(existing, {
            applied: false,
            replayed: false,
            ignoredReason: "STALE_SNAPSHOT",
        });
    }

    const sameSourceTimestamp = existing !== undefined
        && input.sourceUpdatedAt.getTime() === existing.source_updated_at.getTime();
    if (existing && sameSourceTimestamp && !hasCompatibleCaseSemantics(existing, input)) {
        await insertClaimEvent(
            client,
            input,
            existing.id,
            "SNAPSHOT_CONFLICT",
            existing.normalized_status,
            input.normalizedStatus,
            { rejectionScope: "SAME_SOURCE_TIMESTAMP_CASE" },
        );
        return resultFromRow(existing, {
            applied: false,
            replayed: false,
            ignoredReason: "SAME_TIMESTAMP_CONFLICT",
        });
    }

    if (existing && !sameSourceTimestamp && !isClaimStatusTransitionAllowed(
        input.claimType,
        existing.normalized_status,
        input.normalizedStatus,
    )) {
        await insertClaimEvent(
            client,
            input,
            existing.id,
            "TRANSITION_REJECTED",
            existing.normalized_status,
            input.normalizedStatus,
            { rejectionScope: "CASE" },
        );
        return resultFromRow(existing, {
            applied: false,
            replayed: false,
            ignoredReason: "INVALID_TRANSITION",
        });
    }

    let hasLineChange = false;
    let linesToWrite = input.lines;
    if (existing) {
        const incomingItemIds = input.lines.map((line) => items.get(line.externalOrderItemId)!.id);
        const existingLineResult = await client.query<PersistedClaimLineStateRow>(
            `SELECT order_item_id, external_claim_line_id, requested_quantity,
                    normalized_status, market_status_raw, market_reason_code,
                    resolution_type, resolution_status,
                    refund_amount::text AS refund_amount, refund_currency,
                    source_updated_at
               FROM claim_lines
              WHERE tenant_id = $1
                AND claim_case_id = $2
                AND order_item_id = ANY($3::uuid[])
                AND deleted_at IS NULL
              FOR UPDATE`,
            [input.tenantId, existing.id, incomingItemIds],
        );
        const existingLines = new Map(
            existingLineResult.rows.map((line) => [line.order_item_id, line]),
        );
        const staleLine = input.lines.find((line) => {
            const itemId = items.get(line.externalOrderItemId)!.id;
            const storedLine = existingLines.get(itemId);
            return storedLine !== undefined
                && input.sourceUpdatedAt.getTime() < storedLine.source_updated_at.getTime();
        });
        if (staleLine) {
            const storedLine = existingLines.get(items.get(staleLine.externalOrderItemId)!.id)!;
            await insertClaimEvent(
                client,
                input,
                existing.id,
                "SNAPSHOT_IGNORED_STALE",
                existing.normalized_status,
                input.normalizedStatus,
                {
                    ignoredScope: "LINE",
                    externalOrderItemId: staleLine.externalOrderItemId,
                    storedLineSourceUpdatedAt: storedLine.source_updated_at.toISOString(),
                },
            );
            return resultFromRow(existing, {
                applied: false,
                replayed: false,
                ignoredReason: "STALE_SNAPSHOT",
            });
        }

        if (sameSourceTimestamp) {
            const conflictingLine = input.lines.find((line) => {
                const itemId = items.get(line.externalOrderItemId)!.id;
                const storedLine = existingLines.get(itemId);
                return storedLine !== undefined && !hasSameLineSemantics(storedLine, line);
            });
            if (conflictingLine) {
                await insertClaimEvent(
                    client,
                    input,
                    existing.id,
                    "SNAPSHOT_CONFLICT",
                    existing.normalized_status,
                    input.normalizedStatus,
                    {
                        rejectionScope: "SAME_SOURCE_TIMESTAMP_LINE",
                        externalOrderItemId: conflictingLine.externalOrderItemId,
                    },
                );
                return resultFromRow(existing, {
                    applied: false,
                    replayed: false,
                    ignoredReason: "SAME_TIMESTAMP_CONFLICT",
                });
            }
        }

        const invalidLine = sameSourceTimestamp ? undefined : input.lines.find((line) => {
            const itemId = items.get(line.externalOrderItemId)!.id;
            const storedLine = existingLines.get(itemId);
            return storedLine !== undefined && !isClaimStatusTransitionAllowed(
                input.claimType,
                storedLine.normalized_status,
                line.normalizedStatus,
            );
        });
        if (invalidLine) {
            const storedLine = existingLines.get(items.get(invalidLine.externalOrderItemId)!.id)!;
            await insertClaimEvent(
                client,
                input,
                existing.id,
                "TRANSITION_REJECTED",
                existing.normalized_status,
                input.normalizedStatus,
                {
                    rejectionScope: "LINE",
                    externalOrderItemId: invalidLine.externalOrderItemId,
                    fromLineStatus: storedLine.normalized_status,
                    toLineStatus: invalidLine.normalizedStatus,
                },
            );
            return resultFromRow(existing, {
                applied: false,
                replayed: false,
                ignoredReason: "INVALID_TRANSITION",
            });
        }
        hasLineChange = input.lines.some((line) => {
            const storedLine = existingLines.get(items.get(line.externalOrderItemId)!.id);
            return storedLine === undefined
                || (line.externalClaimLineId !== null
                    && line.externalClaimLineId !== storedLine.external_claim_line_id)
                || line.requestedQuantity !== storedLine.requested_quantity
                || line.normalizedStatus !== storedLine.normalized_status
                || line.marketStatusRaw !== storedLine.market_status_raw
                || line.marketReasonCode !== storedLine.market_reason_code
                || line.resolutionType !== storedLine.resolution_type
                || line.resolutionStatus !== storedLine.resolution_status
                || line.refundAmount !== storedLine.refund_amount
                || line.refundCurrency !== storedLine.refund_currency;
        });
        if (sameSourceTimestamp) {
            linesToWrite = input.lines.filter((line) => (
                !existingLines.has(items.get(line.externalOrderItemId)!.id)
            ));
        }
    }

    const itemRows = [...items.values()];
    const orderStatusAtRequest = order.normalized_status;
    const itemStatusAtRequest = combinedSnapshot(itemRows.map((item) => item.internal_work_status)) ?? "UNKNOWN";
    const sourcingStatusAtRequest = combinedSnapshot(itemRows.map((item) => item.sourcing_status)) ?? "UNKNOWN";
    const fulfillmentStatusAtRequest = combinedSnapshot(itemRows.map((item) => item.market_fulfillment_status));
    const purchaseCompensationStatus = initialPurchaseCompensationStatus(
        itemRows.map((item) => item.sourcing_status),
    );
    let stored: PersistedClaimRow;

    if (!existing) {
        const claimId = randomUUID();
        const inserted = await client.query<PersistedClaimRow>(
            `INSERT INTO claim_cases (
                 id, tenant_id, market_account_id, sales_order_id,
                 external_claim_id, dedupe_key, claim_type, source,
                 requester_type, fault_type, normalized_status, market_status_raw,
                 market_reason_code, market_reason_encrypted, market_reason_masked,
                 provider_processing_id, provider_error_code, raw_snapshot_ref,
                 deadline_at, deadline_type, resolution_type, resolution_status,
                 purchase_compensation_status, purchase_compensation_reference,
                 purchase_compensation_next_action_at, purchase_compensation_completed_at,
                 order_status_at_request, item_status_at_request,
                 sourcing_status_at_request, fulfillment_status_at_request,
                 requested_at, reviewed_at, approved_at, rejected_at,
                 collection_started_at, received_at, resolved_at, completed_at,
                 source_created_at, source_updated_at
             ) VALUES (
                 $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                 $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,
                 $35,$36,$37,$38,$39,$40
             )
             RETURNING id, sales_order_id, market_account_id, claim_type,
                       normalized_status, source_updated_at, version::text AS version`,
            [
                claimId, input.tenantId, input.marketAccountId, order.id,
                input.externalClaimId, input.dedupeKey, input.claimType, input.source,
                input.requesterType, input.faultType, input.normalizedStatus, input.marketStatusRaw,
                input.marketReasonCode, input.marketReasonEncrypted, input.marketReasonMasked,
                input.providerProcessingId, input.providerErrorCode, input.rawSnapshotRef,
                input.deadlineAt, input.deadlineType, input.resolutionType, input.resolutionStatus,
                purchaseCompensationStatus, null,
                null, null,
                orderStatusAtRequest, itemStatusAtRequest, sourcingStatusAtRequest,
                fulfillmentStatusAtRequest, input.requestedAt, input.reviewedAt,
                input.approvedAt, input.rejectedAt, input.collectionStartedAt,
                input.receivedAt, input.resolvedAt, input.completedAt,
                input.sourceCreatedAt, input.sourceUpdatedAt,
            ],
        );
        stored = inserted.rows[0];
    } else if (sameSourceTimestamp) {
        stored = existing;
    } else {
        const updated = await client.query<PersistedClaimRow>(
            `UPDATE claim_cases
                SET requester_type = $4,
                    fault_type = $5,
                    normalized_status = $6,
                    market_status_raw = $7,
                    market_reason_code = COALESCE($8, market_reason_code),
                    market_reason_encrypted = COALESCE($9, market_reason_encrypted),
                    market_reason_masked = COALESCE($10, market_reason_masked),
                    provider_processing_id = COALESCE($11, provider_processing_id),
                    provider_error_code = COALESCE($12, provider_error_code),
                    raw_snapshot_ref = COALESCE($13, raw_snapshot_ref),
                    deadline_at = $14,
                    deadline_type = $15,
                    resolution_type = $16,
                    resolution_status = $17,
                    reviewed_at = COALESCE($18, reviewed_at),
                    approved_at = COALESCE($19, approved_at),
                    rejected_at = COALESCE($20, rejected_at),
                    collection_started_at = COALESCE($21, collection_started_at),
                    received_at = COALESCE($22, received_at),
                    resolved_at = COALESCE($23, resolved_at),
                    completed_at = COALESCE($24, completed_at),
                    source_created_at = COALESCE(source_created_at, $25),
                    source_updated_at = $26
              WHERE tenant_id = $1 AND market_account_id = $2 AND id = $3
             RETURNING id, sales_order_id, market_account_id, claim_type,
                       normalized_status, source_updated_at, version::text AS version`,
            [
                input.tenantId, input.marketAccountId, existing.id,
                input.requesterType, input.faultType, input.normalizedStatus,
                input.marketStatusRaw, input.marketReasonCode,
                input.marketReasonEncrypted, input.marketReasonMasked,
                input.providerProcessingId, input.providerErrorCode, input.rawSnapshotRef,
                input.deadlineAt, input.deadlineType, input.resolutionType,
                input.resolutionStatus, input.reviewedAt,
                input.approvedAt, input.rejectedAt,
                input.collectionStartedAt, input.receivedAt, input.resolvedAt,
                input.completedAt, input.sourceCreatedAt, input.sourceUpdatedAt,
            ],
        );
        stored = updated.rows[0];
    }

    for (const line of linesToWrite) {
        const item = items.get(line.externalOrderItemId)!;
        await client.query(
            `INSERT INTO claim_lines (
                 tenant_id, claim_case_id, sales_order_id, order_item_id,
                 external_claim_line_id, line_key, requested_quantity,
                 order_quantity_snapshot, item_status_at_request,
                 sourcing_status_at_request, fulfillment_status_at_request,
                 normalized_status, market_status_raw, market_reason_code,
                 market_reason_encrypted, market_reason_masked,
                 resolution_type, resolution_status, refund_amount,
                 refund_currency, source_updated_at
             ) VALUES (
                 $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17,$18,$19::numeric,$20,$21
             )
             ON CONFLICT (tenant_id, claim_case_id, order_item_id)
             WHERE deleted_at IS NULL
             DO UPDATE SET
                 external_claim_line_id = CASE
                     WHEN EXCLUDED.external_claim_line_id IS NULL
                         THEN claim_lines.external_claim_line_id
                     ELSE EXCLUDED.external_claim_line_id
                 END,
                 requested_quantity = EXCLUDED.requested_quantity,
                 normalized_status = EXCLUDED.normalized_status,
                 market_status_raw = EXCLUDED.market_status_raw,
                 market_reason_code = COALESCE(EXCLUDED.market_reason_code, claim_lines.market_reason_code),
                 market_reason_encrypted = COALESCE(EXCLUDED.market_reason_encrypted, claim_lines.market_reason_encrypted),
                 market_reason_masked = COALESCE(EXCLUDED.market_reason_masked, claim_lines.market_reason_masked),
                 resolution_type = EXCLUDED.resolution_type,
                 resolution_status = EXCLUDED.resolution_status,
                 refund_amount = EXCLUDED.refund_amount,
                 refund_currency = EXCLUDED.refund_currency,
                 source_updated_at = EXCLUDED.source_updated_at
             WHERE claim_lines.source_updated_at < EXCLUDED.source_updated_at`,
            [
                input.tenantId, stored.id, order.id, item.id,
                line.externalClaimLineId, line.lineKey, line.requestedQuantity,
                item.quantity, item.internal_work_status, item.sourcing_status,
                item.market_fulfillment_status, line.normalizedStatus,
                line.marketStatusRaw, line.marketReasonCode,
                line.marketReasonEncrypted, line.marketReasonMasked,
                line.resolutionType, line.resolutionStatus, line.refundAmount,
                line.refundCurrency, input.sourceUpdatedAt,
            ],
        );
    }

    const eventType = !existing
        ? "CLAIM_CREATED"
        : existing.normalized_status !== stored.normalized_status
            ? "STATUS_CHANGED"
            : hasLineChange
                ? "LINE_CHANGED"
                : "SNAPSHOT_APPLIED";
    await insertClaimEvent(
        client,
        input,
        stored.id,
        eventType,
        existing?.normalized_status ?? null,
        stored.normalized_status,
    );
    await client.query(
        `INSERT INTO audit_logs (
             tenant_id, market_account_id, actor_type, action,
             entity_type, entity_id, correlation_id, before_snapshot,
             after_snapshot, metadata
         ) VALUES (
             $1,$2,'WORKER','CLAIM_INBOUND_UPSERTED','CLAIM_CASE',$3,$4::uuid,
             $5::jsonb,$6::jsonb,$7::jsonb
         )`,
        [
            input.tenantId,
            input.marketAccountId,
            stored.id,
            input.correlationId,
            existing ? JSON.stringify({
                normalizedStatus: existing.normalized_status,
                sourceUpdatedAt: existing.source_updated_at.toISOString(),
            }) : null,
            JSON.stringify({
                claimType: input.claimType,
                normalizedStatus: stored.normalized_status,
                requesterType: input.requesterType,
                faultType: input.faultType,
                lineCount: input.lines.length,
                totalQuantity: input.lines.reduce((sum, line) => sum + line.requestedQuantity, 0),
                marketReasonProtected: input.marketReasonEncrypted !== null,
            }),
            JSON.stringify({
                externalEventId: input.externalEventId,
                payloadSha256: input.payloadSha256,
                providerWriteIssued: false,
            }),
        ],
    );

    return resultFromRow(stored, { applied: true, replayed: false, ignoredReason: null });
}

function cursorSecret(): string {
    const secret = process.env.CURSOR_SIGNING_SECRET?.trim();
    if (!secret || secret.length < 32) {
        throw new ApiError(503, "CURSOR_SIGNING_NOT_CONFIGURED", "목록 커서 서명 구성이 완료되지 않았습니다.");
    }
    return secret;
}

function filterHash(tenantId: string, query: ClaimListQuery): string {
    return createHash("sha256").update(JSON.stringify({
        tenantId,
        claimType: query.claimType ?? null,
        status: query.status ?? null,
        requesterType: query.requesterType ?? null,
        marketAccountId: query.marketAccountId ?? null,
        deadlineBefore: query.deadlineBefore ?? null,
        activeOnly: query.activeOnly ?? false,
        search: query.search?.trim() || null,
    }), "utf8").digest("hex");
}

function signature(payload: string): Buffer {
    return createHmac("sha256", cursorSecret()).update(payload, "utf8").digest();
}

function decodeCursor(value: string | undefined, expectedHash: string) {
    if (!value) return null;
    try {
        const [payload, supplied] = value.split(".");
        if (!payload || !supplied) throw new Error("invalid envelope");
        const actual = Buffer.from(supplied, "base64url");
        const expected = signature(payload);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
            throw new Error("invalid signature");
        }
        const parsed = cursorSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
        if (parsed.filterHash !== expectedHash) throw new Error("filter mismatch");
        return parsed;
    } catch {
        throw new ApiError(400, "INVALID_CLAIM_CURSOR", "클레임 목록 커서가 현재 검색조건과 맞지 않습니다.");
    }
}

function encodeCursor(row: ClaimListRow, currentHash: string): string {
    const payload = Buffer.from(JSON.stringify({
        v: 1,
        sourceUpdatedAt: row.source_updated_at.toISOString(),
        id: row.id,
        filterHash: currentHash,
    })).toString("base64url");
    return `${payload}.${signature(payload).toString("base64url")}`;
}

const listColumns = `
    claim.id, claim.market_account_id, account.market_code, account.store_name,
    claim.sales_order_id, orders.external_order_id, orders.external_order_number,
    claim.external_claim_id, claim.claim_type, claim.source, claim.requester_type,
    claim.fault_type, claim.normalized_status, claim.market_status_raw,
    claim.market_reason_code, claim.market_reason_masked, claim.deadline_at,
    claim.deadline_type, claim.resolution_type, claim.resolution_status,
    claim.purchase_compensation_status, claim.purchase_compensation_reference,
    claim.purchase_compensation_next_action_at, claim.requested_at,
    claim.source_updated_at, claim.version::text AS version,
    orders.buyer_name_masked,
    recipient.recipient_name_masked,
    line_totals.affected_line_count,
    line_totals.total_claim_quantity,
    claim.provider_processing_id, claim.provider_error_code,
    (claim.raw_snapshot_ref IS NOT NULL) AS raw_snapshot_available,
    claim.order_status_at_request, claim.item_status_at_request,
    claim.sourcing_status_at_request, claim.fulfillment_status_at_request,
    claim.reviewed_at, claim.approved_at, claim.rejected_at,
    claim.collection_started_at, claim.received_at, claim.resolved_at,
    claim.completed_at, claim.purchase_compensation_completed_at`;

const listJoins = `
    FROM claim_cases claim
    JOIN market_accounts account
      ON account.tenant_id = claim.tenant_id
     AND account.id = claim.market_account_id
    JOIN sales_orders orders
      ON orders.tenant_id = claim.tenant_id
     AND orders.id = claim.sales_order_id
    LEFT JOIN LATERAL (
        SELECT current_recipient.recipient_name_masked
          FROM order_recipients current_recipient
         WHERE current_recipient.tenant_id = claim.tenant_id
           AND current_recipient.sales_order_id = claim.sales_order_id
           AND current_recipient.is_current
           AND current_recipient.deleted_at IS NULL
         LIMIT 1
    ) recipient ON true
    JOIN LATERAL (
        SELECT COUNT(*)::integer AS affected_line_count,
               COALESCE(SUM(line.requested_quantity), 0)::text AS total_claim_quantity
          FROM claim_lines line
         WHERE line.tenant_id = claim.tenant_id
           AND line.claim_case_id = claim.id
           AND line.deleted_at IS NULL
    ) line_totals ON true`;

function toListItem(row: ClaimListRow, now = new Date()): ClaimListItem {
    return {
        id: row.id,
        marketAccountId: row.market_account_id,
        marketCode: row.market_code,
        storeName: row.store_name,
        salesOrderId: row.sales_order_id,
        externalOrderId: row.external_order_id,
        externalOrderNumber: row.external_order_number,
        externalClaimId: row.external_claim_id,
        claimType: row.claim_type,
        source: row.source,
        requesterType: row.requester_type,
        faultType: row.fault_type,
        normalizedStatus: row.normalized_status,
        marketStatusRaw: row.market_status_raw,
        marketReasonCode: row.market_reason_code,
        marketReasonMasked: row.market_reason_masked,
        deadlineAt: row.deadline_at?.toISOString() ?? null,
        deadlineType: row.deadline_type,
        deadlineOverdue: row.deadline_at !== null
            && row.deadline_at.getTime() < now.getTime()
            && !new Set<ClaimStatus>(["REJECTED", "WITHDRAWN", "COMPLETED"]).has(row.normalized_status),
        resolutionType: row.resolution_type,
        resolutionStatus: row.resolution_status,
        purchaseCompensationStatus: row.purchase_compensation_status,
        purchaseCompensationReference: row.purchase_compensation_reference,
        purchaseCompensationNextActionAt: row.purchase_compensation_next_action_at?.toISOString() ?? null,
        requestedAt: row.requested_at.toISOString(),
        sourceUpdatedAt: row.source_updated_at.toISOString(),
        buyerNameMasked: row.buyer_name_masked,
        recipientNameMasked: row.recipient_name_masked,
        affectedLineCount: Number(row.affected_line_count),
        totalClaimQuantity: Number(row.total_claim_quantity),
        version: row.version,
        actionAvailability: unavailableClaimActions(),
    };
}

export async function listClaims(
    client: TransactionClient,
    tenantId: string,
    query: ClaimListQuery,
): Promise<ClaimCursorPage> {
    const currentHash = filterHash(tenantId, query);
    const cursor = decodeCursor(query.cursor, currentHash);
    const search = query.search?.trim() || null;
    const result = await client.query<ClaimListRow>(
        `SELECT ${listColumns}
         ${listJoins}
         WHERE claim.tenant_id = $1
           AND claim.deleted_at IS NULL
           AND ($2::text IS NULL OR claim.claim_type = $2)
           AND ($3::text IS NULL OR claim.normalized_status = $3)
           AND ($4::text IS NULL OR claim.requester_type = $4)
           AND ($5::uuid IS NULL OR claim.market_account_id = $5)
           AND ($6::timestamptz IS NULL OR claim.deadline_at <= $6)
           AND (NOT $7::boolean OR claim.normalized_status NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED'))
           AND (
               $8::text IS NULL
               OR claim.external_claim_id ILIKE '%' || $8 || '%'
               OR orders.external_order_id ILIKE '%' || $8 || '%'
               OR orders.external_order_number ILIKE '%' || $8 || '%'
               OR EXISTS (
                   SELECT 1
                     FROM claim_lines search_line
                     JOIN order_items search_item
                       ON search_item.tenant_id = search_line.tenant_id
                      AND search_item.id = search_line.order_item_id
                    WHERE search_line.tenant_id = claim.tenant_id
                      AND search_line.claim_case_id = claim.id
                      AND search_line.deleted_at IS NULL
                      AND search_item.deleted_at IS NULL
                      AND (
                          search_item.external_order_item_id ILIKE '%' || $8 || '%'
                          OR search_item.product_name ILIKE '%' || $8 || '%'
                      )
               )
           )
           AND (
               $9::timestamptz IS NULL
               OR (claim.source_updated_at, claim.id) < ($9::timestamptz, $10::uuid)
           )
         ORDER BY claim.source_updated_at DESC, claim.id DESC
         LIMIT $11`,
        [
            tenantId, query.claimType ?? null, query.status ?? null,
            query.requesterType ?? null, query.marketAccountId ?? null,
            query.deadlineBefore ?? null, query.activeOnly ?? false, search,
            cursor?.sourceUpdatedAt ?? null, cursor?.id ?? null, query.limit + 1,
        ],
    );
    const hasNext = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    return {
        items: rows.map((row) => toListItem(row)),
        nextCursor: hasNext && rows.length > 0
            ? encodeCursor(rows[rows.length - 1], currentHash)
            : null,
    };
}

function toLine(row: ClaimLineRow): ClaimLineView {
    return {
        id: row.id,
        orderItemId: row.order_item_id,
        externalOrderItemId: row.external_order_item_id,
        externalClaimLineId: row.external_claim_line_id,
        productName: row.product_name,
        optionName: row.option_name,
        orderedQuantity: row.ordered_quantity,
        requestedQuantity: row.requested_quantity,
        itemStatusAtRequest: row.item_status_at_request,
        sourcingStatusAtRequest: row.sourcing_status_at_request,
        fulfillmentStatusAtRequest: row.fulfillment_status_at_request,
        normalizedStatus: row.normalized_status,
        marketStatusRaw: row.market_status_raw,
        marketReasonCode: row.market_reason_code,
        marketReasonMasked: row.market_reason_masked,
        resolutionType: row.resolution_type,
        resolutionStatus: row.resolution_status,
        refundAmount: row.refund_amount,
        refundCurrency: row.refund_currency,
        version: row.version,
    };
}

function toEvent(row: ClaimEventRow): ClaimEventView {
    return {
        id: row.id,
        externalEventId: row.external_event_id,
        eventType: row.event_type,
        eventSource: row.event_source,
        fromStatus: row.from_status,
        toStatus: row.to_status,
        marketStatusRaw: row.market_status_raw,
        marketReasonCode: row.market_reason_code,
        sourceOccurredAt: row.source_occurred_at?.toISOString() ?? null,
        receivedAt: row.received_at.toISOString(),
    };
}

export async function getClaimDetail(
    client: TransactionClient,
    tenantId: string,
    claimId: string,
): Promise<ClaimDetail | null> {
    const headerResult = await client.query<ClaimListRow>(
        `SELECT ${listColumns}
         ${listJoins}
         WHERE claim.tenant_id = $1
           AND claim.id = $2
           AND claim.deleted_at IS NULL`,
        [tenantId, claimId],
    );
    const row = headerResult.rows[0];
    if (!row) return null;

    const lineResult = await client.query<ClaimLineRow>(
            `SELECT line.id, line.order_item_id, item.external_order_item_id,
                    line.external_claim_line_id, item.product_name, item.option_name,
                    line.order_quantity_snapshot AS ordered_quantity, line.requested_quantity,
                    line.item_status_at_request, line.sourcing_status_at_request,
                    line.fulfillment_status_at_request, line.normalized_status,
                    line.market_status_raw, line.market_reason_code,
                    line.market_reason_masked, line.resolution_type,
                    line.resolution_status, line.refund_amount::text AS refund_amount,
                    line.refund_currency, line.version::text AS version
               FROM claim_lines line
               JOIN order_items item
                 ON item.tenant_id = line.tenant_id
                AND item.id = line.order_item_id
              WHERE line.tenant_id = $1
                AND line.claim_case_id = $2
                AND line.deleted_at IS NULL
              ORDER BY line.created_at, line.id`,
            [tenantId, claimId],
        );
    const eventResult = await client.query<ClaimEventRow>(
            `SELECT id, external_event_id, event_type, event_source,
                    from_status, to_status, market_status_raw,
                    market_reason_code, source_occurred_at, received_at
               FROM claim_events
              WHERE tenant_id = $1 AND claim_case_id = $2
              ORDER BY COALESCE(source_occurred_at, received_at) DESC,
                       created_at DESC, id DESC
              LIMIT 201`,
            [tenantId, claimId],
        );
    const base = toListItem(row);
    return {
        ...base,
        providerProcessingId: row.provider_processing_id,
        providerErrorCode: row.provider_error_code,
        rawSnapshotAvailable: row.raw_snapshot_available,
        orderStatusAtRequest: row.order_status_at_request,
        itemStatusAtRequest: row.item_status_at_request,
        sourcingStatusAtRequest: row.sourcing_status_at_request,
        fulfillmentStatusAtRequest: row.fulfillment_status_at_request,
        reviewedAt: row.reviewed_at?.toISOString() ?? null,
        approvedAt: row.approved_at?.toISOString() ?? null,
        rejectedAt: row.rejected_at?.toISOString() ?? null,
        collectionStartedAt: row.collection_started_at?.toISOString() ?? null,
        receivedAt: row.received_at?.toISOString() ?? null,
        resolvedAt: row.resolved_at?.toISOString() ?? null,
        completedAt: row.completed_at?.toISOString() ?? null,
        purchaseCompensationCompletedAt: row.purchase_compensation_completed_at?.toISOString() ?? null,
        lines: lineResult.rows.map(toLine),
        events: eventResult.rows.slice(0, 200).map(toEvent),
        eventsTruncated: eventResult.rows.length > 200,
    };
}
