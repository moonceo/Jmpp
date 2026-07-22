import { afterEach, describe, expect, it, vi } from "vitest";
import {
    browserSessionCookieNames,
    browserSessionDurationSeconds,
    browserSessionSetCookieHeaders,
    createBrowserSessionToken,
    hashCsrfToken,
    verifyBrowserSessionToken,
} from "@/lib/server/auth/browser-session";

const TENANT_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const SESSION_ID = "00000000-0000-4000-8000-000000000004";
const SECRET = "s".repeat(32);

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("browser session tokens", () => {
    it("uses bounded TTL configuration", () => {
        expect(browserSessionDurationSeconds({ NODE_ENV: "test" })).toBe(28_800);
        expect(() => browserSessionDurationSeconds({ NODE_ENV: "test", SESSION_TTL_SECONDS: "60" })).toThrow();
        expect(() => browserSessionDurationSeconds({ NODE_ENV: "test", SESSION_TTL_SECONDS: "90000" })).toThrow();
    });

    it("signs, verifies, and rejects tampering", () => {
        const environment: NodeJS.ProcessEnv = {
            NODE_ENV: "test",
            SESSION_SIGNING_SECRET: SECRET,
        };
        const token = createBrowserSessionToken({
            v: 1,
            typ: "browser_session",
            aud: "jumunpangpang-browser",
            sessionId: SESSION_ID,
            tenantId: TENANT_ID,
            userId: USER_ID,
            csrfHash: hashCsrfToken("csrf"),
            iat: 100,
            exp: 200,
        }, environment);

        expect(verifyBrowserSessionToken(token, environment, 150)).toMatchObject({
            sessionId: SESSION_ID,
            tenantId: TENANT_ID,
        });
        expect(() => verifyBrowserSessionToken(`${token}x`, environment, 150)).toThrow();
    });

    it("emits host-only secure production cookies", () => {
        const environment: NodeJS.ProcessEnv = { NODE_ENV: "production" };
        expect(browserSessionCookieNames(environment)).toEqual({
            session: "__Host-jpp_session",
            csrf: "__Host-jpp_csrf",
        });
        const headers = browserSessionSetCookieHeaders("session", "csrf", 300, environment);
        expect(headers[0]).toContain("HttpOnly");
        expect(headers.every((header) => header.includes("Secure"))).toBe(true);
        expect(headers.every((header) => header.includes("SameSite=Strict"))).toBe(true);
    });
});
