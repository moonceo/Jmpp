import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionClient } from "@/lib/server/db";
import {
    getClaimDetail,
    listClaims,
    persistInboundClaimSnapshot,
} from "@/lib/server/claims/repository";
import { prepareInboundClaimSnapshot } from "@/lib/server/claims/service";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000002";
const CLAIM_ID = "00000000-0000-4000-8000-000000000003";
const ORDER_ID = "00000000-0000-4000-8000-000000000004";
const ITEM_ID = "00000000-0000-4000-8000-000000000005";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000006";
const ITEM_ID_2 = "00000000-0000-4000-8000-000000000010";

function prepared(status: "REQUESTED" | "APPROVED" = "REQUESTED", sourceUpdatedAt = "2026-07-10T00:01:00.000Z") {
    return prepareInboundClaimSnapshot({
        tenantId: TENANT_ID,
        marketAccountId: ACCOUNT_ID,
        correlationId: CORRELATION_ID,
    }, {
        externalOrderId: "ORDER-1",
        externalClaimId: "CLAIM-1",
        externalEventId: "EVENT-1",
        claimType: "RETURN",
        source: "MARKET",
        requesterType: "CUSTOMER",
        normalizedStatus: status,
        marketStatusRaw: status,
        rawMarketReason: "private reason",
        resolutionType: null,
        resolutionStatus: "UNDECIDED",
        requestedAt: "2026-07-10T00:00:00.000Z",
        sourceUpdatedAt,
        lines: [{
            externalOrderItemId: "ITEM-1",
            requestedQuantity: 1,
            rawMarketReason: "line sensitive reason",
            resolutionType: null,
            resolutionStatus: "UNDECIDED",
        }],
    }, (_plaintext, context) => `cipher:${context.secretType}`);
}

function writeClient(options: {
    duplicate?: boolean;
    duplicatePayloadSha256?: string;
    existingStatus?: "REQUESTED" | "COMPLETED";
    existingSourceUpdatedAt?: Date;
    existingLineStatus?: "REQUESTED" | "REFUNDED";
    existingLineSourceUpdatedAt?: Date;
    existingLineRequestedQuantity?: number;
    itemId?: string;
    externalOrderItemId?: string;
    sourcingStatus?: string;
} = {}) {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
        calls.push({ sql, values });
        if (sql.includes("FROM claim_events event")) {
            return { rows: options.duplicate ? [{
                id: CLAIM_ID,
                sales_order_id: ORDER_ID,
                market_account_id: ACCOUNT_ID,
                claim_type: "RETURN",
                normalized_status: "REQUESTED",
                source_updated_at: new Date("2026-07-10T00:01:00.000Z"),
                version: "2",
                event_payload_sha256: options.duplicatePayloadSha256 ?? prepared().payloadSha256,
            }] : [] };
        }
        if (sql.includes("FROM sales_orders")) {
            return { rows: [{ id: ORDER_ID, normalized_status: "PREPARING" }] };
        }
        if (sql.includes("FROM order_items") && sql.includes("FOR UPDATE")) {
            return { rows: [{
                id: options.itemId ?? ITEM_ID,
                external_order_item_id: options.externalOrderItemId ?? "ITEM-1",
                quantity: 3,
                internal_work_status: "PREPARING",
                sourcing_status: options.sourcingStatus ?? "MATCHED",
                market_fulfillment_status: "PAYED",
            }] };
        }
        if (sql.includes("FROM claim_cases") && sql.includes("FOR UPDATE")) {
            return { rows: options.existingStatus ? [{
                id: CLAIM_ID,
                sales_order_id: ORDER_ID,
                market_account_id: ACCOUNT_ID,
                claim_type: "RETURN",
                normalized_status: options.existingStatus,
                source: "MARKET",
                requester_type: "CUSTOMER",
                fault_type: "UNKNOWN",
                market_status_raw: "REQUESTED",
                market_reason_code: null,
                deadline_at: null,
                deadline_type: null,
                resolution_type: null,
                resolution_status: "UNDECIDED",
                requested_at: new Date("2026-07-10T00:00:00.000Z"),
                reviewed_at: null,
                approved_at: null,
                rejected_at: null,
                collection_started_at: null,
                received_at: null,
                resolved_at: null,
                completed_at: null,
                source_created_at: null,
                source_updated_at: options.existingSourceUpdatedAt
                    ?? new Date("2026-07-10T00:00:00.000Z"),
                version: "4",
            }] : [] };
        }
        if (sql.includes("FROM claim_lines") && sql.includes("FOR UPDATE")) {
            return { rows: options.existingLineStatus ? [{
                order_item_id: options.itemId ?? ITEM_ID,
                external_claim_line_id: null,
                requested_quantity: options.existingLineRequestedQuantity ?? 1,
                normalized_status: options.existingLineStatus,
                market_status_raw: "REQUESTED",
                market_reason_code: null,
                resolution_type: null,
                resolution_status: "UNDECIDED",
                refund_amount: null,
                refund_currency: null,
                source_updated_at: options.existingLineSourceUpdatedAt
                    ?? new Date("2026-07-10T00:00:00.000Z"),
            }] : [] };
        }
        if (sql.includes("INSERT INTO claim_cases")) {
            return { rows: [{
                id: CLAIM_ID,
                sales_order_id: ORDER_ID,
                market_account_id: ACCOUNT_ID,
                claim_type: "RETURN",
                normalized_status: "REQUESTED",
                source_updated_at: new Date("2026-07-10T00:01:00.000Z"),
                version: "1",
            }] };
        }
        if (sql.includes("UPDATE claim_cases")) {
            return { rows: [{
                id: CLAIM_ID,
                sales_order_id: ORDER_ID,
                market_account_id: ACCOUNT_ID,
                claim_type: "RETURN",
                normalized_status: values?.[5] ?? "APPROVED",
                source_updated_at: values?.[29] ?? new Date("2026-07-10T00:01:00.000Z"),
                version: "5",
            }] };
        }
        return { rows: [] };
    });
    return { client: { query } as unknown as TransactionClient, calls };
}

afterEach(() => vi.unstubAllEnvs());

describe("claim inbound persistence", () => {
    it("atomically creates case, partial line, event, and masked audit without changing order axes", async () => {
        const { client, calls } = writeClient();
        const result = await persistInboundClaimSnapshot(client, prepared());

        expect(result).toMatchObject({ claimId: CLAIM_ID, applied: true, replayed: false });
        expect(calls.some(({ sql }) => sql.includes("INSERT INTO claim_lines"))).toBe(true);
        expect(calls.some(({ sql }) => sql.includes("INSERT INTO claim_events"))).toBe(true);
        expect(calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(true);
        const eventCall = calls.find(({ sql }) => sql.includes("INSERT INTO claim_events"));
        const eventSnapshot = JSON.parse(String(eventCall?.values?.[12]));
        expect(eventCall?.values?.[6]).toBe("MARKET");
        expect(eventSnapshot.lines[0]).toMatchObject({
            externalOrderItemId: "ITEM-1",
            requestedQuantity: 1,
            normalizedStatus: "REQUESTED",
            resolutionType: null,
        });
        expect(eventSnapshot.lines[0].marketReasonEncrypted).toContain("cipher:CLAIM_LINE_REASON:");
        expect(calls.some(({ sql }) => /UPDATE\s+(sales_orders|order_items)/.test(sql))).toBe(false);
        const serializedValues = JSON.stringify(calls.flatMap((call) => call.values ?? []));
        expect(serializedValues).not.toContain("private reason");
        expect(serializedValues).not.toContain("line sensitive reason");
    });

    it("derives purchase compensation from the trusted order ledger instead of provider input", async () => {
        const { client, calls } = writeClient({ sourcingStatus: "PAID" });
        await persistInboundClaimSnapshot(client, prepared());

        const insert = calls.find(({ sql }) => sql.includes("INSERT INTO claim_cases"));
        expect(insert?.values?.[22]).toBe("NEEDS_ATTENTION");
    });

    it("quarantines different snapshots that share a provider timestamp", async () => {
        const { client, calls } = writeClient({
            existingStatus: "REQUESTED",
            existingSourceUpdatedAt: new Date("2026-07-10T00:01:00.000Z"),
        });
        const result = await persistInboundClaimSnapshot(client, prepared("APPROVED"));

        expect(result).toMatchObject({
            applied: false,
            replayed: false,
            ignoredReason: "SAME_TIMESTAMP_CONFLICT",
        });
        expect(calls.find(({ sql }) => sql.includes("INSERT INTO claim_events"))?.values)
            .toContain("SNAPSHOT_CONFLICT");
        expect(calls.some(({ sql }) => sql.includes("UPDATE claim_cases"))).toBe(false);
    });

    it("merges a new order-item line at the same source timestamp when case semantics match", async () => {
        const input = prepared();
        input.externalEventId = "EVENT-2";
        input.lines[0].externalOrderItemId = "ITEM-2";
        const { client, calls } = writeClient({
            existingStatus: "REQUESTED",
            existingSourceUpdatedAt: new Date("2026-07-10T00:01:00.000Z"),
            itemId: ITEM_ID_2,
            externalOrderItemId: "ITEM-2",
        });

        const result = await persistInboundClaimSnapshot(client, input);

        expect(result).toMatchObject({ applied: true, replayed: false, ignoredReason: null });
        expect(calls.some(({ sql }) => sql.includes("UPDATE claim_cases"))).toBe(false);
        const lineInsert = calls.find(({ sql }) => sql.includes("INSERT INTO claim_lines"));
        expect(lineInsert?.values?.[3]).toBe(ITEM_ID_2);
        expect(lineInsert?.sql).toContain("claim_lines.source_updated_at < EXCLUDED.source_updated_at");
        expect(calls.find(({ sql }) => sql.includes("INSERT INTO claim_events"))?.values)
            .toContain("LINE_CHANGED");
    });

    it("quarantines a changed existing line at the same source timestamp", async () => {
        const input = prepared();
        input.externalEventId = "EVENT-2";
        input.lines[0].requestedQuantity = 2;
        const { client, calls } = writeClient({
            existingStatus: "REQUESTED",
            existingSourceUpdatedAt: new Date("2026-07-10T00:01:00.000Z"),
            existingLineStatus: "REQUESTED",
            existingLineSourceUpdatedAt: new Date("2026-07-10T00:01:00.000Z"),
        });

        const result = await persistInboundClaimSnapshot(client, input);

        expect(result).toMatchObject({
            applied: false,
            replayed: false,
            ignoredReason: "SAME_TIMESTAMP_CONFLICT",
        });
        const event = calls.find(({ sql }) => sql.includes("INSERT INTO claim_events"));
        const eventSnapshot = JSON.parse(String(event?.values?.[12]));
        expect(eventSnapshot.eventContext).toMatchObject({
            rejectionScope: "SAME_SOURCE_TIMESTAMP_LINE",
            externalOrderItemId: "ITEM-1",
        });
        expect(calls.some(({ sql }) => sql.includes("UPDATE claim_cases"))).toBe(false);
        expect(calls.some(({ sql }) => sql.includes("INSERT INTO claim_lines"))).toBe(false);
    });

    it("replays a duplicate provider event without touching the order or claim", async () => {
        const { client, calls } = writeClient({ duplicate: true });
        const result = await persistInboundClaimSnapshot(client, prepared());
        expect(result).toMatchObject({ applied: false, replayed: true, ignoredReason: "DUPLICATE_EVENT" });
        expect(calls.some(({ sql }) => sql.includes("FROM sales_orders"))).toBe(false);
        expect(calls.some(({ sql }) => sql.includes("UPDATE claim_cases"))).toBe(false);
    });

    it("rejects reuse of an external event identity with a different payload", async () => {
        const { client, calls } = writeClient({
            duplicate: true,
            duplicatePayloadSha256: "f".repeat(64),
        });
        await expect(persistInboundClaimSnapshot(client, prepared())).rejects.toMatchObject({
            code: "CLAIM_EVENT_IDENTITY_CONFLICT",
        });
        expect(calls.some(({ sql }) => sql.includes("UPDATE claim_cases"))).toBe(false);
    });

    it("records but does not apply a stale provider snapshot", async () => {
        const { client, calls } = writeClient({
            existingStatus: "REQUESTED",
            existingSourceUpdatedAt: new Date("2026-07-10T01:00:00.000Z"),
        });
        const result = await persistInboundClaimSnapshot(client, prepared());
        expect(result).toMatchObject({ applied: false, ignoredReason: "STALE_SNAPSHOT" });
        const event = calls.find(({ sql }) => sql.includes("INSERT INTO claim_events"));
        expect(event?.values).toContain("SNAPSHOT_IGNORED_STALE");
        expect(calls.some(({ sql }) => sql.includes("UPDATE claim_cases"))).toBe(false);
    });

    it("records and rejects a terminal-state regression", async () => {
        const { client, calls } = writeClient({ existingStatus: "COMPLETED" });
        const result = await persistInboundClaimSnapshot(client, prepared());
        expect(result).toMatchObject({ applied: false, ignoredReason: "INVALID_TRANSITION" });
        const event = calls.find(({ sql }) => sql.includes("INSERT INTO claim_events"));
        expect(event?.values).toContain("TRANSITION_REJECTED");
    });

    it("records and ignores an independent line-state regression before mutation", async () => {
        const input = prepared();
        input.lines[0].normalizedStatus = "RECEIVED";
        const { client, calls } = writeClient({
            existingStatus: "REQUESTED",
            existingLineStatus: "REFUNDED",
        });
        const result = await persistInboundClaimSnapshot(client, input);
        expect(result).toMatchObject({ applied: false, ignoredReason: "INVALID_TRANSITION" });
        const event = calls.find(({ sql }) => sql.includes("INSERT INTO claim_events"));
        const snapshot = JSON.parse(String(event?.values?.[12]));
        expect(snapshot.eventContext).toMatchObject({
            rejectionScope: "LINE",
            externalOrderItemId: "ITEM-1",
            fromLineStatus: "REFUNDED",
            toLineStatus: "RECEIVED",
        });
        expect(calls.some(({ sql }) => sql.includes("UPDATE claim_cases"))).toBe(false);
        expect(calls.some(({ sql }) => sql.includes("INSERT INTO claim_lines"))).toBe(false);
    });

    it("records and ignores a snapshot older than an independently newer line", async () => {
        const { client, calls } = writeClient({
            existingStatus: "REQUESTED",
            existingLineStatus: "REQUESTED",
            existingLineSourceUpdatedAt: new Date("2026-07-10T01:00:00.000Z"),
        });
        const result = await persistInboundClaimSnapshot(client, prepared());
        expect(result).toMatchObject({ applied: false, ignoredReason: "STALE_SNAPSHOT" });
        const event = calls.find(({ sql }) => sql.includes("INSERT INTO claim_events"));
        const snapshot = JSON.parse(String(event?.values?.[12]));
        expect(snapshot.eventContext).toMatchObject({
            ignoredScope: "LINE",
            externalOrderItemId: "ITEM-1",
        });
        expect(calls.some(({ sql }) => sql.includes("UPDATE claim_cases"))).toBe(false);
    });

    it("classifies an independent line lifecycle change in the append-only event", async () => {
        const input = prepared();
        input.lines[0].normalizedStatus = "APPROVED";
        input.lines[0].marketStatusRaw = "APPROVED";
        const { client, calls } = writeClient({
            existingStatus: "REQUESTED",
            existingLineStatus: "REQUESTED",
        });
        const result = await persistInboundClaimSnapshot(client, input);
        expect(result).toMatchObject({ applied: true, normalizedStatus: "REQUESTED" });
        const event = calls.find(({ sql }) => sql.includes("INSERT INTO claim_events"));
        expect(event?.values).toContain("LINE_CHANGED");
    });
});

function listRow() {
    return {
        id: CLAIM_ID,
        market_account_id: ACCOUNT_ID,
        market_code: "NAVER",
        store_name: "스토어",
        sales_order_id: ORDER_ID,
        external_order_id: "ORDER-1",
        external_order_number: "ORDER-NO-1",
        external_claim_id: "CLAIM-1",
        claim_type: "RETURN",
        source: "MARKET",
        requester_type: "CUSTOMER",
        fault_type: "CUSTOMER",
        normalized_status: "REQUESTED",
        market_status_raw: "RETURN_REQUESTED",
        market_reason_code: "CHANGE_MIND",
        market_reason_masked: "[PROTECTED]",
        deadline_at: new Date("2026-07-11T00:00:00.000Z"),
        deadline_type: "PROVIDER_RESPONSE_DUE",
        resolution_type: null,
        resolution_status: "UNDECIDED",
        purchase_compensation_status: "NOT_REQUIRED",
        purchase_compensation_reference: null,
        purchase_compensation_next_action_at: null,
        requested_at: new Date("2026-07-10T00:00:00.000Z"),
        source_updated_at: new Date("2026-07-10T00:01:00.000Z"),
        version: "1",
        buyer_name_masked: "김*",
        recipient_name_masked: "이*",
        affected_line_count: 1,
        total_claim_quantity: 1,
        provider_processing_id: "PROCESS-1",
        provider_error_code: null,
        raw_snapshot_available: true,
        order_status_at_request: "PREPARING",
        item_status_at_request: "PREPARING",
        sourcing_status_at_request: "MATCHED",
        fulfillment_status_at_request: "PAYED",
        reviewed_at: null,
        approved_at: null,
        rejected_at: null,
        collection_started_at: null,
        received_at: null,
        resolved_at: null,
        completed_at: null,
        purchase_compensation_completed_at: null,
    };
}

describe("claim inbox reads", () => {
    it("returns signed pagination and explicitly unavailable provider actions", async () => {
        vi.stubEnv("CURSOR_SIGNING_SECRET", "c".repeat(32));
        const client = {
            query: vi.fn(async () => ({ rows: [listRow(), { ...listRow(), id: "00000000-0000-4000-8000-000000000007" }] })),
        } as unknown as TransactionClient;
        const page = await listClaims(client, TENANT_ID, { limit: 1, claimType: "RETURN" });
        expect(page.items).toHaveLength(1);
        expect(page.nextCursor).toBeTruthy();
        expect(page.items[0].marketReasonMasked).toBe("[PROTECTED]");
        expect(Object.values(page.items[0].actionAvailability).every((action) => !action.available)).toBe(true);
        await expect(listClaims(client, TENANT_ID, {
            limit: 1,
            claimType: "CANCEL",
            cursor: page.nextCursor!,
        })).rejects.toMatchObject({ code: "INVALID_CLAIM_CURSOR" });
    });

    it("returns masked detail, bounded event history, and request-time line snapshots", async () => {
        const query = vi.fn(async (sql: string) => {
            if (sql.includes("FROM claim_cases claim")) return { rows: [listRow()] };
            if (sql.includes("FROM claim_lines line")) return { rows: [{
                id: "00000000-0000-4000-8000-000000000008",
                order_item_id: ITEM_ID,
                external_order_item_id: "ITEM-1",
                external_claim_line_id: "LINE-1",
                product_name: "상품",
                option_name: "옵션",
                ordered_quantity: 3,
                requested_quantity: 1,
                item_status_at_request: "PREPARING",
                sourcing_status_at_request: "MATCHED",
                fulfillment_status_at_request: "PAYED",
                normalized_status: "REQUESTED",
                market_status_raw: "RETURN_REQUESTED",
                market_reason_code: "CHANGE_MIND",
                market_reason_masked: "[PROTECTED]",
                resolution_type: null,
                resolution_status: "UNDECIDED",
                refund_amount: null,
                refund_currency: null,
                version: "1",
            }] };
            return { rows: [{
                id: "00000000-0000-4000-8000-000000000009",
                external_event_id: "EVENT-1",
                event_type: "CLAIM_CREATED",
                event_source: "WORKER",
                from_status: null,
                to_status: "REQUESTED",
                market_status_raw: "RETURN_REQUESTED",
                market_reason_code: "CHANGE_MIND",
                source_occurred_at: new Date("2026-07-10T00:01:00.000Z"),
                received_at: new Date("2026-07-10T00:01:01.000Z"),
            }] };
        });
        const detail = await getClaimDetail({ query } as unknown as TransactionClient, TENANT_ID, CLAIM_ID);
        expect(detail?.lines[0]).toMatchObject({
            requestedQuantity: 1,
            orderedQuantity: 3,
            itemStatusAtRequest: "PREPARING",
        });
        expect(query.mock.calls[1]?.[0]).toContain("line.order_quantity_snapshot AS ordered_quantity");
        expect(JSON.stringify(detail)).not.toContain("marketReasonEncrypted");
        expect(detail?.eventsTruncated).toBe(false);
    });
});
