import { describe, expect, it, vi } from "vitest";
import type { TransactionClient } from "@/lib/server/db";
import {
    reconcileOutboundCommand,
} from "@/lib/server/commands/reconciliation";

const NOW = new Date("2026-07-10T03:00:00.000Z");
const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000002";
const COMMAND_ID = "00000000-0000-4000-8000-000000000003";
const ITEM_ID = "00000000-0000-4000-8000-000000000004";
const MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000005";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000006";

function result(rows: unknown[] = []) {
    return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

function commandRow(
    status: "PENDING" | "LEASED" | "RETRY" | "UNKNOWN" | "FAILED",
    lastErrorCode: string | null,
) {
    return {
        id: COMMAND_ID,
        tenant_id: TENANT_ID,
        market_account_id: ACCOUNT_ID,
        order_item_id: ITEM_ID,
        aggregate_type: "ORDER_ITEM",
        aggregate_id: ITEM_ID,
        command_type: "ORDER_CONFIRM",
        idempotency_key: "outbound:v1:test",
        expected_version: "3",
        payload: {},
        status,
        correlation_id: CORRELATION_ID,
        requested_by_membership_id: MEMBERSHIP_ID,
        attempt_count: 3,
        max_attempts: 3,
        next_attempt_at: NOW,
        lease_owner: null,
        lease_until: null,
        result: {
            applied: "UNKNOWN",
            requiresManualResolution: lastErrorCode === "RECONCILIATION_ATTEMPTS_EXHAUSTED",
        },
        last_error_code: lastErrorCode,
        last_error_message: "unresolved",
        succeeded_at: null,
        failed_at: status === "FAILED" ? NOW : null,
        version: "8",
        created_at: NOW,
        updated_at: NOW,
    };
}

function clientFor(input: {
    status?: "PENDING" | "LEASED" | "RETRY" | "UNKNOWN" | "FAILED";
    lastErrorCode?: string | null;
    leaseUntil?: Date | null;
}) {
    const before = commandRow(
        input.status ?? "UNKNOWN",
        input.lastErrorCode ?? "WORKER_LEASE_EXPIRED",
    );
    const query = vi.fn(async (statement: unknown, _values?: unknown[]) => {
        void _values;
        const sql = String(statement);
        if (sql.includes("SELECT oc.market_account_id") && !sql.includes("FOR UPDATE")) {
            return result([{ market_account_id: ACCOUNT_ID, market_code: "NAVER" }]);
        }
        if (sql.includes("SELECT id, market_account_id, status") && sql.includes("FOR UPDATE")) {
            return result([{
                id: COMMAND_ID,
                market_account_id: ACCOUNT_ID,
                status: before.status,
                version: "8",
                attempt_count: 3,
                max_attempts: 3,
                last_error_code: before.last_error_code,
                lease_until: input.leaseUntil ?? null,
                result: before.result,
            }]);
        }
        if (sql.includes("SELECT") && sql.includes("id, tenant_id, market_account_id")) {
            return result([before]);
        }
        return result();
    });
    return { client: { query } as unknown as TransactionClient, query };
}

describe("manual outbound command reconciliation", () => {
    it("requeues UNKNOWN for read-only reconciliation with a bounded extra budget", async () => {
        const fake = clientFor({});

        await reconcileOutboundCommand(fake.client, {
            tenantId: TENANT_ID,
            commandId: COMMAND_ID,
            membershipId: MEMBERSHIP_ID,
            correlationId: CORRELATION_ID,
            expectedVersion: "8",
            action: "RECHECK",
            now: NOW,
        });

        const calls = fake.query.mock.calls.map(([statement, values]) => ({
            sql: String(statement),
            values,
        }));
        const update = calls.find(({ sql }) => sql.includes("SET status = 'UNKNOWN'"));
        const audit = calls.find(({ sql }) => sql.includes("INSERT INTO audit_logs"));

        expect(update?.sql).toContain("attempt_count + 3");
        expect(update?.sql).toContain("lease_purpose = NULL");
        expect(audit?.values).toContain("OUTBOUND_COMMAND_RECONCILIATION_REQUESTED");
        expect(audit?.values?.some((value) =>
            typeof value === "string" && value.includes('"providerWriteIssued":false'))).toBe(true);
    });

    it("abandons UNKNOWN as FAILED without claiming provider success or scheduling a write", async () => {
        const fake = clientFor({});

        await reconcileOutboundCommand(fake.client, {
            tenantId: TENANT_ID,
            commandId: COMMAND_ID,
            membershipId: MEMBERSHIP_ID,
            correlationId: CORRELATION_ID,
            expectedVersion: "8",
            action: "ABANDON",
            reason: "Credentials are being retired after operator review.",
            now: NOW,
        });

        const calls = fake.query.mock.calls.map(([statement, values]) => ({
            sql: String(statement),
            values,
        }));
        const update = calls.find(({ sql }) => sql.includes("last_error_code = 'MANUALLY_ABANDONED'"));
        const audit = calls.find(({ sql }) => sql.includes("INSERT INTO audit_logs"));

        expect(update?.sql).toContain("'applied', 'UNKNOWN'");
        expect(update?.sql).toContain("succeeded_at = NULL");
        expect(update?.sql).not.toContain("status = 'RETRY'");
        expect(audit?.values).toContain("OUTBOUND_COMMAND_RECONCILIATION_ABANDONED");
        expect(audit?.values?.some((value) =>
            typeof value === "string" && value.includes('"providerWriteIssued":false'))).toBe(true);
    });

    it("cancels never-applied queued work so account deletion has an explicit resolution path", async () => {
        const fake = clientFor({ status: "PENDING", lastErrorCode: null });

        await reconcileOutboundCommand(fake.client, {
            tenantId: TENANT_ID,
            commandId: COMMAND_ID,
            membershipId: MEMBERSHIP_ID,
            correlationId: CORRELATION_ID,
            expectedVersion: "8",
            action: "ABANDON",
            reason: "Account is being retired before command execution.",
            now: NOW,
        });

        const abandon = fake.query.mock.calls.find(([statement]) =>
            String(statement).includes("last_error_code = 'MANUALLY_ABANDONED'"));
        expect(abandon?.[1]?.[3]).toBe("CANCELED");
    });

    it("lets an admin resolve an expired worker lease even while the worker is offline", async () => {
        const fake = clientFor({
            status: "LEASED",
            leaseUntil: new Date(NOW.getTime() - 1),
        });

        await reconcileOutboundCommand(fake.client, {
            tenantId: TENANT_ID,
            commandId: COMMAND_ID,
            membershipId: MEMBERSHIP_ID,
            correlationId: CORRELATION_ID,
            expectedVersion: "8",
            action: "ABANDON",
            reason: "The worker lease expired and the account must be retired.",
            now: NOW,
        });

        const calls = fake.query.mock.calls.map(([statement, values]) => ({
            sql: String(statement),
            values,
        }));
        const closeAttempt = calls.findIndex(({ sql }) => sql.includes("UPDATE outbound_attempts"));
        const abandon = calls.findIndex(({ sql }) => sql.includes("last_error_code = 'MANUALLY_ABANDONED'"));
        expect(closeAttempt).toBeGreaterThan(-1);
        expect(abandon).toBeGreaterThan(closeAttempt);
        expect(calls[abandon].values?.[3]).toBe("FAILED");
    });

    it("does not reopen a deterministic provider failure as UNKNOWN", async () => {
        const fake = clientFor({ status: "FAILED", lastErrorCode: "PROVIDER_CLAIM_CONFLICT" });

        await expect(reconcileOutboundCommand(fake.client, {
            tenantId: TENANT_ID,
            commandId: COMMAND_ID,
            membershipId: MEMBERSHIP_ID,
            correlationId: CORRELATION_ID,
            expectedVersion: "8",
            action: "RECHECK",
            now: NOW,
        })).rejects.toMatchObject({
            code: "COMMAND_RECONCILIATION_STATE_CONFLICT",
        });
    });

    it("reopens an automatically exhausted FAILED reconciliation for an admin recheck", async () => {
        const fake = clientFor({
            status: "FAILED",
            lastErrorCode: "RECONCILIATION_ATTEMPTS_EXHAUSTED",
        });

        await expect(reconcileOutboundCommand(fake.client, {
            tenantId: TENANT_ID,
            commandId: COMMAND_ID,
            membershipId: MEMBERSHIP_ID,
            correlationId: CORRELATION_ID,
            expectedVersion: "8",
            action: "RECHECK",
            now: NOW,
        })).resolves.toBeDefined();

        expect(fake.query.mock.calls.some(([statement]) =>
            String(statement).includes("SET status = 'UNKNOWN'"))).toBe(true);
    });
});
