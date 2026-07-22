import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    release: vi.fn(),
    connect: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
    getDbPool: () => ({ connect: mocks.connect }),
}));

import { GET } from "@/app/api/health/ready/route";

beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INTERNAL_AUTH_SHARED_SECRET", "i".repeat(32));
    vi.stubEnv("SESSION_SIGNING_SECRET", "s".repeat(32));
    vi.stubEnv("CURSOR_SIGNING_SECRET", "c".repeat(32));
    vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("ENABLED_MARKET_ADAPTERS", "NAVER");
    mocks.query.mockReset();
    mocks.release.mockReset();
    mocks.connect.mockReset();
    mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
});

afterEach(() => {
    vi.unstubAllEnvs();
});

function roleResult(overrides: Partial<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    member_of_table_owner: boolean;
    relrowsecurity: boolean;
}> = {}) {
    return {
        rolsuper: false,
        rolbypassrls: false,
        member_of_table_owner: false,
        relrowsecurity: true,
        ...overrides,
    };
}

describe("readiness database role boundary", () => {
    it("reports ready only for a tenant-scoped non-owner role with RLS enabled", async () => {
        mocks.query.mockImplementation(async (sql: string) => (
            sql.includes("FROM pg_roles")
                ? { rows: [roleResult()] }
                : { rows: [] }
        ));

        const response = await GET(new Request("https://orders.example/api/health/ready"));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ data: { status: "ready" } });
        expect(mocks.release).toHaveBeenCalledOnce();
    });

    it.each([
        ["superuser", { rolsuper: true }],
        ["BYPASSRLS", { rolbypassrls: true }],
        ["table owner membership", { member_of_table_owner: true }],
        ["RLS disabled", { relrowsecurity: false }],
    ])("rejects an unsafe %s application connection", async (_name, override) => {
        mocks.query.mockImplementation(async (sql: string) => (
            sql.includes("FROM pg_roles")
                ? { rows: [roleResult(override)] }
                : { rows: [] }
        ));

        const response = await GET(new Request("https://orders.example/api/health/ready"));
        const payload = await response.json() as { error?: { code?: string } };

        expect(response.status).toBe(503);
        expect(payload.error?.code).toBe("UNSAFE_APPLICATION_DATABASE_ROLE");
    });
});
