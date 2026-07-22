import type { TransactionClient } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http/api-error";
import {
    acceptOrderItemCommand,
    requireConfiguredApiCapability,
    toPublicOutboundCommand,
} from "@/lib/server/commands/service";
import type { StoredOutboundCommand } from "@/lib/server/commands/repository";
import type { OrderItemCommandRequest } from "@/lib/server/commands/schemas";
import { describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-000000000002";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000003";
const MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000004";
const COMMAND_ID = "00000000-0000-4000-8000-000000000005";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000006";
const NOW = new Date("2026-07-10T03:00:00.000Z");

const request: OrderItemCommandRequest = {
    type: "INVOICE_SUBMIT",
    effectKey: "invoice-revision-1",
    expectedVersion: 3,
    payload: {
        carrierCode: "CJ",
        trackingNumber: "1234567890",
        dispatchAt: NOW.toISOString(),
    },
};

function orderItemRow(options: {
    version?: number;
    capabilities?: unknown;
} = {}) {
    return {
        id: ITEM_ID,
        version: String(options.version ?? 3),
        market_account_id: ACCOUNT_ID,
        market_code: "NAVER",
        account_auth_status: "CONNECTED",
        account_is_active: true,
        capabilities: options.capabilities ?? {
            INVOICE_SUBMIT: { mode: "API" },
        },
    };
}

function commandRow(overrides: Record<string, unknown> = {}) {
    return {
        id: COMMAND_ID,
        tenant_id: TENANT_ID,
        market_account_id: ACCOUNT_ID,
        order_item_id: ITEM_ID,
        aggregate_type: "ORDER_ITEM",
        aggregate_id: ITEM_ID,
        command_type: "INVOICE_SUBMIT",
        idempotency_key: "outbound:v1:test",
        expected_version: "3",
        payload: request.payload,
        status: "PENDING",
        correlation_id: CORRELATION_ID,
        requested_by_membership_id: MEMBERSHIP_ID,
        attempt_count: 0,
        max_attempts: 8,
        next_attempt_at: NOW,
        lease_owner: null,
        lease_until: null,
        result: null,
        last_error_code: null,
        last_error_message: null,
        succeeded_at: null,
        failed_at: null,
        version: "1",
        created_at: NOW,
        updated_at: NOW,
        ...overrides,
    };
}

function scriptedClient(...rowSets: unknown[][]) {
    const query = vi.fn(async (statement: unknown, values?: unknown[]) => {
        void statement;
        void values;

        return {
            rows: rowSets.shift() ?? [],
            command: "SELECT",
            rowCount: 0,
            oid: 0,
            fields: [],
        };
    });

    return {
        client: { query } as unknown as TransactionClient,
        query,
    };
}

function acceptanceInput() {
    return {
        tenantId: TENANT_ID,
        membershipId: MEMBERSHIP_ID,
        orderItemId: ITEM_ID,
        correlationId: CORRELATION_ID,
        request,
        commandId: COMMAND_ID,
        createdAt: NOW.toISOString(),
    };
}

describe("order item command acceptance", () => {
    it("returns an exact idempotent replay before re-validating changed state", async () => {
        const { client, query } = scriptedClient(
            [orderItemRow({ version: 9, capabilities: {} })],
            [commandRow()],
        );

        const accepted = await acceptOrderItemCommand(client, acceptanceInput());

        expect(accepted.replayed).toBe(true);
        expect(accepted.command.id).toBe(COMMAND_ID);
        expect(query).toHaveBeenCalledTimes(2);
    });

    it("rejects reuse of an effect key when the payload is different", async () => {
        const { client, query } = scriptedClient(
            [orderItemRow()],
            [commandRow({
                payload: { ...request.payload, trackingNumber: "DIFFERENT" },
            })],
        );

        await expect(acceptOrderItemCommand(client, acceptanceInput()))
            .rejects.toMatchObject({
                status: 409,
                code: "IDEMPOTENCY_KEY_CONFLICT",
            });
        expect(query).toHaveBeenCalledTimes(2);
    });

    it("rejects a stale expectedVersion and does not insert a command", async () => {
        const { client, query } = scriptedClient(
            [orderItemRow({ version: 4 })],
            [],
        );

        await expect(acceptOrderItemCommand(client, acceptanceInput()))
            .rejects.toMatchObject({
                status: 409,
                code: "ORDER_ITEM_VERSION_CONFLICT",
            });
        expect(query).toHaveBeenCalledTimes(2);
    });

    it("fails closed when API capability is missing", async () => {
        const { client, query } = scriptedClient(
            [orderItemRow({ capabilities: {} })],
            [],
        );

        await expect(acceptOrderItemCommand(client, acceptanceInput()))
            .rejects.toMatchObject({
                status: 422,
                code: "MARKET_CAPABILITY_NOT_API",
            });
        expect(query).toHaveBeenCalledTimes(2);
    });

    it("inserts only the pending command and never updates order status", async () => {
        const { client, query } = scriptedClient(
            [orderItemRow()],
            [],
            [commandRow()],
        );

        const accepted = await acceptOrderItemCommand(client, acceptanceInput());
        const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");

        expect(accepted.replayed).toBe(false);
        expect(sql).toContain("INSERT INTO outbound_commands");
        expect(sql).not.toMatch(/UPDATE\s+order_items/i);
    });
});

describe("command capability and public projection", () => {
    it("permits only an explicit API mode", () => {
        expect(() => requireConfiguredApiCapability({
            ORDER_CONFIRM: { mode: "API" },
        }, "ORDER_CONFIRM")).not.toThrow();

        expect(() => requireConfiguredApiCapability({
            ORDER_CONFIRM: { mode: "MANUAL_FALLBACK" },
        }, "ORDER_CONFIRM")).toThrow(ApiError);
    });

    it("requires passed account UAT before accepting seller cancellation", () => {
        expect(() => requireConfiguredApiCapability({
            SELLER_CANCEL: { mode: "API", uatStatus: "NOT_RUN" },
        }, "SELLER_CANCEL")).toThrow(ApiError);

        expect(() => requireConfiguredApiCapability({
            SELLER_CANCEL: { mode: "API", uatStatus: "PASSED" },
        }, "SELLER_CANCEL")).not.toThrow();
    });

    it("redacts raw payload, result, error text, and requester identity", () => {
        const stored: StoredOutboundCommand = {
            id: COMMAND_ID,
            tenantId: TENANT_ID,
            marketAccountId: ACCOUNT_ID,
            orderItemId: ITEM_ID,
            aggregateType: "ORDER_ITEM",
            aggregateId: ITEM_ID,
            type: "INVOICE_SUBMIT",
            idempotencyKey: "outbound:v1:test",
            expectedVersion: 3,
            payload: request.payload,
            status: "FAILED",
            correlationId: CORRELATION_ID,
            requestedByMembershipId: MEMBERSHIP_ID,
            attemptCount: 1,
            maxAttempts: 8,
            nextAttemptAt: null,
            leaseOwner: null,
            leaseUntil: null,
            result: { providerRawResponse: "contains private data" },
            lastErrorCode: "INVALID_TRACKING",
            lastErrorMessage: "raw provider message with private data",
            succeededAt: null,
            failedAt: NOW.toISOString(),
            version: 2,
            createdAt: NOW.toISOString(),
            updatedAt: NOW.toISOString(),
        };

        const projection = toPublicOutboundCommand(stored);
        const serialized = JSON.stringify(projection);

        expect(projection.payloadSummary).toMatchObject({
            carrierCode: "CJ",
            trackingNumberMasked: "******7890",
        });
        expect(projection.resultAvailable).toBe(true);
        expect(serialized).not.toContain("1234567890");
        expect(serialized).not.toContain("providerRawResponse");
        expect(serialized).not.toContain("raw provider message");
        expect(serialized).not.toContain(MEMBERSHIP_ID);
    });
});
