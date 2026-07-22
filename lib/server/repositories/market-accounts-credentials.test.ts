import { createHash } from "node:crypto";
import type { TransactionClient } from "@/lib/server/db";
import { naverCredentialsSchema } from "@/lib/server/market-accounts/credentials";
import { rotateMarketAccountCredentials } from "@/lib/server/repositories/market-accounts";
import { afterEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000002";
const MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000003";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000004";
const OLD_SECRET_ID = "00000000-0000-4000-8000-000000000005";
const ROTATED_AT = new Date("2026-07-10T03:00:00.000Z");
const credentials = {
    clientId: "client-id",
    clientSecret: "new-client-secret",
    type: "SELF" as const,
};

function result(rows: unknown[] = []) {
    return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

function accountRow(overrides: Record<string, unknown> = {}) {
    return {
        id: ACCOUNT_ID,
        market_code: "NAVER",
        store_name: "스토어",
        seller_id: "seller-1",
        external_account_id: null,
        auth_status: "REAUTH_REQUIRED",
        is_active: true,
        capabilities: { ORDER_CONFIRM: { mode: "API" } },
        settings: {},
        credential_expires_at: null,
        last_auth_verified_at: null,
        last_successful_sync_at: null,
        last_error_code: "NAVER_AUTHENTICATION_FAILED",
        last_error_message: "Authentication failed.",
        version: "3",
        created_at: ROTATED_AT,
        updated_at: ROTATED_AT,
        has_active_work: false,
        ...overrides,
    };
}

function fakeClient(options: { activeWork?: boolean } = {}) {
    const query = vi.fn(async (statement: unknown, values?: unknown[]) => {
        void values;
        const sql = String(statement);
        if (sql.includes("AS has_active_work")) {
            return result([accountRow({ has_active_work: options.activeWork ?? false })]);
        }
        if (sql.includes("SELECT id, fingerprint_sha256") && sql.includes("integration_secrets")) {
            return result([{ id: OLD_SECRET_ID, fingerprint_sha256: "b".repeat(64) }]);
        }
        if (sql.includes("UPDATE market_accounts") && sql.includes("RETURNING")) {
            return result([accountRow({
                auth_status: "PENDING",
                capabilities: {},
                last_error_code: null,
                last_error_message: null,
                version: "4",
            })]);
        }
        return result();
    });

    return {
        client: { query } as unknown as TransactionClient,
        query,
    };
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("market account credential rotation", () => {
    it("atomically revokes, inserts, resets capability state, and audits fingerprints only", async () => {
        vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
        vi.stubEnv("ENABLED_MARKET_ADAPTERS", "NAVER");
        const fake = fakeClient();

        const account = await rotateMarketAccountCredentials(fake.client, {
            tenantId: TENANT_ID,
            marketAccountId: ACCOUNT_ID,
            membershipId: MEMBERSHIP_ID,
            expectedVersion: "3",
            credentials,
            correlationId: CORRELATION_ID,
            rotatedAt: ROTATED_AT,
        });

        expect(account).toMatchObject({ authStatus: "PENDING", capabilities: {}, version: "4" });
        const calls = fake.query.mock.calls.map(([statement, values]) => ({
            sql: String(statement),
            values,
        }));
        const revoke = calls.findIndex(({ sql }) => sql.includes("UPDATE integration_secrets"));
        const insert = calls.findIndex(({ sql }) => sql.includes("INSERT INTO integration_secrets"));
        const reset = calls.findIndex(({ sql }) => sql.includes("UPDATE market_accounts"));
        const audit = calls.findIndex(({ sql }) => sql.includes("MARKET_CREDENTIALS_ROTATED"));

        expect(revoke).toBeGreaterThan(-1);
        expect(insert).toBeGreaterThan(revoke);
        expect(reset).toBeGreaterThan(insert);
        expect(audit).toBeGreaterThan(reset);
        expect(calls[insert].values?.[4]).not.toContain(credentials.clientSecret);
        expect(calls[insert].values?.[6]).toBe(OLD_SECRET_ID);

        const expectedFingerprint = createHash("sha256")
            .update(JSON.stringify(credentials), "utf8")
            .digest("hex");
        expect(calls[insert].values?.[5]).toBe(expectedFingerprint);
        const auditPayload = JSON.stringify([calls[audit].values?.[4], calls[audit].values?.[5]]);
        expect(auditPayload).toContain(expectedFingerprint);
        expect(auditPayload).not.toContain(credentials.clientId);
        expect(auditPayload).not.toContain(credentials.clientSecret);
    });

    it("rejects rotation while sync or command work is active", async () => {
        vi.stubEnv("ENABLED_MARKET_ADAPTERS", "NAVER");
        const fake = fakeClient({ activeWork: true });

        await expect(rotateMarketAccountCredentials(fake.client, {
            tenantId: TENANT_ID,
            marketAccountId: ACCOUNT_ID,
            membershipId: MEMBERSHIP_ID,
            expectedVersion: "3",
            credentials,
            correlationId: CORRELATION_ID,
            rotatedAt: ROTATED_AT,
        })).rejects.toMatchObject({
            status: 409,
            code: "MARKET_ACCOUNT_HAS_ACTIVE_WORK",
        });
        expect(fake.query.mock.calls.some(([statement]) =>
            String(statement).includes("INSERT INTO integration_secrets"))).toBe(false);
    });

    it("requires accountId for seller-scoped Naver credentials", () => {
        expect(naverCredentialsSchema.safeParse({
            clientId: "client-id",
            clientSecret: "secret",
            type: "SELLER",
        }).success).toBe(false);
    });
});
