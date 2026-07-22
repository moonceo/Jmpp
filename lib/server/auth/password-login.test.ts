import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    compare: vi.fn(),
    query: vi.fn(),
    withTenantTransaction: vi.fn(),
    clientQuery: vi.fn(),
}));

vi.mock("bcryptjs", () => ({ compare: mocks.compare }));
vi.mock("@/lib/server/db", () => ({
    query: mocks.query,
    withTenantTransaction: mocks.withTenantTransaction,
}));

import { createPasswordBrowserSession } from "@/lib/server/auth/password-login";

const TENANT_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000004";

beforeEach(() => {
    vi.stubEnv("SESSION_SIGNING_SECRET", "s".repeat(32));
    vi.stubEnv("NODE_ENV", "test");
    mocks.compare.mockReset();
    mocks.query.mockReset();
    mocks.clientQuery.mockReset();
    mocks.withTenantTransaction.mockReset();
    mocks.withTenantTransaction.mockImplementation(async (_tenantId, work) => work({
        query: mocks.clientQuery,
    }));
    mocks.clientQuery.mockResolvedValue({ rowCount: 1, rows: [{}] });
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("password browser login", () => {
    it("verifies the password and atomically creates a revocable tenant session", async () => {
        mocks.query.mockResolvedValueOnce({
            rows: [{
                tenant_id: TENANT_ID,
                user_id: USER_ID,
                password_hash: "stored-hash",
                locked_until: null,
            }],
        });
        mocks.compare.mockResolvedValue(true);

        const result = await createPasswordBrowserSession({
            workspaceSlug: "sourcinglife",
            email: "owner@example.com",
            password: "correct-password",
            correlationId: CORRELATION_ID,
        }, new Date("2026-07-10T12:00:00.000Z"));

        expect(result).toMatchObject({ tenantId: TENANT_ID, userId: USER_ID });
        expect(result.sessionToken).toContain(".");
        expect(mocks.withTenantTransaction).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
        expect(mocks.clientQuery.mock.calls[0][0]).toContain("record_password_login_success");
        expect(mocks.clientQuery.mock.calls[1][0]).toContain("INSERT INTO browser_sessions");
    });

    it("records a failed attempt without revealing which credential was wrong", async () => {
        mocks.query
            .mockResolvedValueOnce({
                rows: [{
                    tenant_id: TENANT_ID,
                    user_id: USER_ID,
                    password_hash: "stored-hash",
                    locked_until: null,
                }],
            })
            .mockResolvedValueOnce({ rows: [{}] });
        mocks.compare.mockResolvedValue(false);

        await expect(createPasswordBrowserSession({
            workspaceSlug: "sourcinglife",
            email: "owner@example.com",
            password: "wrong-password",
            correlationId: CORRELATION_ID,
        })).rejects.toMatchObject({
            status: 401,
            code: "AUTHENTICATION_FAILED",
        });
        expect(mocks.query.mock.calls[1][0]).toContain("record_password_login_failure");
        expect(mocks.withTenantTransaction).not.toHaveBeenCalled();
    });

    it("performs a dummy bcrypt comparison for unknown identities", async () => {
        mocks.query.mockResolvedValueOnce({ rows: [] });
        mocks.compare.mockResolvedValue(false);

        await expect(createPasswordBrowserSession({
            workspaceSlug: "missing",
            email: "unknown@example.com",
            password: "wrong-password",
            correlationId: CORRELATION_ID,
        })).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
        expect(mocks.compare).toHaveBeenCalledTimes(1);
        expect(mocks.query).toHaveBeenCalledTimes(1);
    });
});
