import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresNaverOutboundCommandStore } from "@/lib/server/commands/worker/postgres-store";
import type { NaverCommandExecutionContext } from "@/lib/server/commands/worker/types";

const NOW = new Date("2026-07-10T03:00:00.000Z");
const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000002";
const COMMAND_ID = "00000000-0000-4000-8000-000000000003";
const ITEM_ID = "00000000-0000-4000-8000-000000000004";
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000005";
const SALES_ORDER_ID = "00000000-0000-4000-8000-000000000006";

function result(rows: unknown[] = []) {
    return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

function fakePool(handler: (sql: string, values?: unknown[]) => ReturnType<typeof result>) {
    const query = vi.fn(async (statement: unknown, values?: unknown[]) =>
        handler(String(statement), values));
    const release = vi.fn();
    const pool = {
        connect: vi.fn(async () => ({ query, release })),
    } as unknown as Pool;
    return { pool, query, release };
}

function executionContext(type = "DIRECT_DELIVERY"): NaverCommandExecutionContext {
    return {
        lease: {
            id: COMMAND_ID,
            tenantId: TENANT_ID,
            marketAccountId: ACCOUNT_ID,
            orderItemId: ITEM_ID,
            type,
            attemptCount: 1,
            maxAttempts: 3,
            expectedVersion: 3,
            purpose: "EXECUTE",
            leaseOwner: "worker-1",
            leaseUntil: new Date(NOW.getTime() + 60_000).toISOString(),
        },
        attemptId: ATTEMPT_ID,
        payload: { dispatchAt: NOW.toISOString() },
        previousResult: null,
        correlationId: "00000000-0000-4000-8000-000000000006",
        accountActive: true,
        accountAuthStatus: "CONNECTED",
        accountCapabilities: { DIRECT_DELIVERY: { mode: "API" } },
        accountSettings: {},
        encryptedCredentials: "encrypted",
        credentialSecretType: "MARKET_API_CREDENTIALS",
        item: {
            id: ITEM_ID,
            salesOrderId: SALES_ORDER_ID,
            version: 3,
            externalOrderItemId: "naver-product-order-1",
            quantity: 2,
            internalWorkStatus: "PREPARING",
            marketStatusRaw: "PAYED",
            marketFulfillmentStatus: "ACKNOWLEDGED",
            sourcingStatus: "EXTERNAL_PURCHASE",
            marketDeliveryMethod: null,
            domesticCarrierCode: null,
            domesticTrackingNumber: null,
            confirmedAt: NOW.toISOString(),
            marketInvoiceSubmittedAt: null,
            attributes: {},
        },
    };
}

describe("PostgresNaverOutboundCommandStore", () => {
    it("recovers expired leases as UNKNOWN and leases due work with SKIP LOCKED", async () => {
        const leaseUntil = new Date(NOW.getTime() + 60_000);
        const fake = fakePool((sql) => {
            if (sql.includes("RETURNING oc.id, oc.tenant_id")) {
                return result([{
                    id: COMMAND_ID,
                    tenant_id: TENANT_ID,
                    market_account_id: ACCOUNT_ID,
                    order_item_id: ITEM_ID,
                    command_type: "ORDER_CONFIRM",
                    attempt_count: 1,
                    max_attempts: 3,
                    expected_version: 3,
                    lease_purpose: "EXECUTE",
                    lease_owner: "worker-1",
                    lease_until: leaseUntil,
                }]);
            }
            return result();
        });
        const store = new PostgresNaverOutboundCommandStore({ pool: fake.pool });

        const leased = await store.leaseNext({
            leaseOwner: "worker-1",
            now: NOW,
            leaseDurationMs: 60_000,
        });
        const sql = fake.query.mock.calls.map(([statement]) => String(statement)).join("\n");

        expect(leased).toMatchObject({
            id: COMMAND_ID,
            attemptCount: 1,
            purpose: "EXECUTE",
        });
        expect(sql).toContain("SET status = 'UNKNOWN'");
        expect(sql).toContain("outcome = 'UNKNOWN'");
        expect(sql).toContain("expired.lease_purpose = 'EXECUTE'");
        expect(sql).toContain("lease_purpose = NULL");
        expect(sql).toContain("FOR UPDATE OF oc SKIP LOCKED");
        expect(sql).toContain("oc.status IN ('PENDING', 'RETRY', 'UNKNOWN')");
        expect(sql).toContain("WHEN oc.status = 'UNKNOWN' THEN 'RECONCILE'");
        expect(sql).toContain("RECONCILIATION_ATTEMPTS_EXHAUSTED");
        expect(fake.release).toHaveBeenCalledOnce();
    });

    it("leases due UNKNOWN work specifically for provider-state reconciliation", async () => {
        const leaseUntil = new Date(NOW.getTime() + 60_000);
        const fake = fakePool((sql) => {
            if (sql.includes("RETURNING oc.id, oc.tenant_id")) {
                return result([{
                    id: COMMAND_ID,
                    tenant_id: TENANT_ID,
                    market_account_id: ACCOUNT_ID,
                    order_item_id: ITEM_ID,
                    command_type: "INVOICE_SUBMIT",
                    attempt_count: 2,
                    max_attempts: 4,
                    expected_version: 3,
                    lease_purpose: "RECONCILE",
                    lease_owner: "worker-1",
                    lease_until: leaseUntil,
                }]);
            }
            return result();
        });
        const store = new PostgresNaverOutboundCommandStore({ pool: fake.pool });

        await expect(store.leaseNext({
            leaseOwner: "worker-1",
            now: NOW,
            leaseDurationMs: 60_000,
        })).resolves.toMatchObject({
            id: COMMAND_ID,
            purpose: "RECONCILE",
            attemptCount: 2,
        });

        const sql = fake.query.mock.calls.map(([statement]) => String(statement)).join("\n");
        expect(sql).toContain("oc.status = 'UNKNOWN'");
        expect(sql).toContain("OR (ma.is_active AND ma.auth_status = 'CONNECTED')");
        expect(sql).toContain("next_attempt_at <= $1::timestamptz");
    });

    it("uses one account-locked transaction for successful item and command finalization", async () => {
        const context = executionContext();
        const fake = fakePool((sql) => {
            if (sql.includes("SELECT command_type, order_item_id")) {
                return result([{ command_type: "DIRECT_DELIVERY", order_item_id: ITEM_ID }]);
            }
            if (sql.includes("FROM outbound_attempts") && sql.includes("FOR UPDATE")) {
                return result([{ started_at: new Date(NOW.getTime() - 100) }]);
            }
            if (sql.includes("FROM order_items") && sql.includes("FOR UPDATE")) {
                return result([{
                    id: ITEM_ID,
                    sales_order_id: SALES_ORDER_ID,
                    version: 3,
                    external_order_item_id: "naver-product-order-1",
                    quantity: 2,
                    internal_work_status: "PREPARING",
                    market_status_raw: "PAYED",
                    market_fulfillment_status: "ACKNOWLEDGED",
                    sourcing_status: "EXTERNAL_PURCHASE",
                    market_delivery_method: null,
                    domestic_carrier_code: null,
                    domestic_tracking_number: null,
                    confirmed_at: NOW,
                    market_invoice_submitted_at: null,
                    attributes: {},
                }]);
            }
            if (sql.includes("SELECT normalized_status") && sql.includes("FROM sales_orders")) {
                return result([{ normalized_status: "PREPARING" }]);
            }
            if (sql.includes("array_agg(internal_work_status")) {
                return result([{ item_statuses: ["SHIPPING", "DELIVERED"] }]);
            }
            return result();
        });
        const store = new PostgresNaverOutboundCommandStore({ pool: fake.pool });

        await expect(store.finalize({
            context,
            leaseOwner: "worker-1",
            now: NOW,
            resolution: {
                status: "SUCCEEDED",
                attemptOutcome: "SUCCESS",
                code: null,
                message: null,
                responseSummary: { provider: "NAVER", applied: true },
            },
        })).resolves.toEqual({ status: "SUCCEEDED" });

        const calls = fake.query.mock.calls.map(([statement, values]) => ({
            sql: String(statement),
            values,
        }));
        const advisory = calls.findIndex(({ sql }) => sql.includes("pg_advisory_xact_lock"));
        const itemUpdate = calls.findIndex(({ sql }) => sql.includes("UPDATE order_items"));
        const headerUpdate = calls.findIndex(({ sql }) => sql.includes("UPDATE sales_orders"));
        const commandUpdate = calls.findIndex(({ sql }) => sql.includes("UPDATE outbound_commands"));
        const commit = calls.findIndex(({ sql }) => sql === "COMMIT");

        expect(advisory).toBeGreaterThan(-1);
        expect(itemUpdate).toBeGreaterThan(advisory);
        expect(headerUpdate).toBeGreaterThan(itemUpdate);
        expect(commandUpdate).toBeGreaterThan(headerUpdate);
        expect(commit).toBeGreaterThan(commandUpdate);
        expect(calls[itemUpdate].values?.[5]).toBe("DIRECT_DELIVERY");
        expect(calls[itemUpdate].values?.[7]).toBe("SHIPPING");
        expect(calls[headerUpdate].values?.[3]).toBe("SHIPPING");
    });
});
