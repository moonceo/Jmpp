import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBrowserSessionToken, hashCsrfToken } from "@/lib/server/auth/browser-session";
import { config, proxy } from "@/proxy";

const SECRET = "s".repeat(32);

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

describe("page authentication proxy", () => {
    it("does not intercept Next.js runtime and HMR paths", () => {
        const matcher = new RegExp(`^${config.matcher[0]}$`);

        expect(matcher.test("/_next/webpack-hmr")).toBe(false);
        expect(matcher.test("/_next/static/chunks/app.js")).toBe(false);
        expect(matcher.test("/orders")).toBe(true);
    });

    it("redirects unauthenticated protected pages to login with a return path", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("SESSION_SIGNING_SECRET", SECRET);

        const response = proxy(new NextRequest("https://orders.example/orders?view=claims"));

        expect(response.headers.get("location")).toBe(
            "https://orders.example/login?next=%2Forders%3Fview%3Dclaims",
        );
    });

    it("always allows login so a DB-revoked but still signed cookie cannot cause a loop", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("SESSION_SIGNING_SECRET", SECRET);
        const response = proxy(new NextRequest("https://orders.example/login", {
            headers: { cookie: "__Host-jpp_session=stale.invalid" },
        }));

        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("x-middleware-next")).toBe("1");
    });

    it("allows a cryptographically valid unexpired session to reach a page", () => {
        const now = 1_800_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(now * 1000);
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("SESSION_SIGNING_SECRET", SECRET);
        const token = createBrowserSessionToken({
            v: 1,
            typ: "browser_session",
            aud: "jumunpangpang-browser",
            sessionId: "00000000-0000-4000-8000-000000000001",
            tenantId: "00000000-0000-4000-8000-000000000002",
            userId: "00000000-0000-4000-8000-000000000003",
            csrfHash: hashCsrfToken("csrf"),
            iat: now,
            exp: now + 60,
        });
        const response = proxy(new NextRequest("https://orders.example/orders", {
            headers: { cookie: `__Host-jpp_session=${token}` },
        }));

        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("x-middleware-next")).toBe("1");
    });
});
