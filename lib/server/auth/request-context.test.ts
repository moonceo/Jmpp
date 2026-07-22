import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/server/http/api-error";
import {
    createBrowserSessionToken,
    hashCsrfToken,
} from "@/lib/server/auth/browser-session";
import {
    createInternalAuthContextToken,
    requireRequestContext,
} from "@/lib/server/auth/request-context";

const TENANT_ID = "00000000-0000-4000-8000-000000000002";
const USER_ID = "00000000-0000-4000-8000-000000000003";
const SECRET = "a".repeat(32);
const SESSION_ID = "00000000-0000-4000-8000-000000000004";

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

describe("requireRequestContext", () => {
    it("명시적으로 허용한 개발 환경에서만 개발 테넌트를 사용한다", () => {
        vi.stubEnv("NODE_ENV", "test");
        vi.stubEnv("ALLOW_INSECURE_DEV_AUTH", "true");
        vi.stubEnv("DEV_TENANT_ID", TENANT_ID);
        vi.stubEnv("DEV_USER_ID", USER_ID);

        const context = requireRequestContext(new Request("http://localhost/api/orders"));

        expect(context.tenantId).toBe(TENANT_ID);
        expect(context.userId).toBe(USER_ID);
    });

    it("개발 우회가 명시되지 않으면 서명 없는 요청을 거부한다", () => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("INTERNAL_AUTH_SHARED_SECRET", SECRET);

        expect(() => requireRequestContext(new Request("http://localhost/api/orders"))).toThrow(ApiError);
    });

    it("DB 감사로그에 사용할 수 없는 correlation ID는 UUID로 교체한다", () => {
        vi.stubEnv("NODE_ENV", "test");
        vi.stubEnv("ALLOW_INSECURE_DEV_AUTH", "true");
        const context = requireRequestContext(new Request("http://localhost/api/orders", {
            headers: { "x-correlation-id": "not-a-uuid" },
        }));

        expect(context.correlationId).toMatch(/^[0-9a-f-]{36}$/);
        expect(context.correlationId).not.toBe("not-a-uuid");
    });

    it("운영 환경에서는 서명 컨텍스트가 없으면 거부한다", () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("INTERNAL_AUTH_SHARED_SECRET", SECRET);

        expect(() => requireRequestContext(new Request("http://localhost/api/orders"))).toThrow(ApiError);
    });

    it("운영 환경의 테넌트와 사용자가 결합된 서명을 검증한다", () => {
        const now = 1_800_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(now * 1000);
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("INTERNAL_AUTH_SHARED_SECRET", SECRET);
        const token = createInternalAuthContextToken({
            tenantId: TENANT_ID,
            userId: USER_ID,
            issuedAt: now,
            expiresAt: now + 60,
        }, SECRET);
        const request = new Request("http://localhost/api/orders", {
            headers: { "x-internal-auth-context": token },
        });

        expect(requireRequestContext(request)).toMatchObject({
            tenantId: TENANT_ID,
            userId: USER_ID,
        });
    });

    it("서명 payload를 변조하면 거부한다", () => {
        const now = 1_800_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(now * 1000);
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("INTERNAL_AUTH_SHARED_SECRET", SECRET);
        const token = createInternalAuthContextToken({
            tenantId: TENANT_ID,
            userId: USER_ID,
            issuedAt: now,
            expiresAt: now + 60,
        }, SECRET);
        const [payload, signature] = token.split(".");
        const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;

        expect(() => requireRequestContext(new Request("http://localhost/api/orders", {
            headers: { "x-internal-auth-context": `${tamperedPayload}.${signature}` },
        }))).toThrowError("인증 컨텍스트가 올바르지 않습니다.");
    });

    it("운영 브라우저 세션 쿠키를 읽고 GET 요청 컨텍스트를 만든다", () => {
        const now = 1_800_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(now * 1000);
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("SESSION_SIGNING_SECRET", SECRET);
        const csrfToken = "csrf-token";
        const token = createBrowserSessionToken({
            v: 1,
            typ: "browser_session",
            aud: "jumunpangpang-browser",
            sessionId: SESSION_ID,
            tenantId: TENANT_ID,
            userId: USER_ID,
            csrfHash: hashCsrfToken(csrfToken),
            iat: now,
            exp: now + 60,
        });

        expect(requireRequestContext(new Request("https://orders.example/api/orders", {
            headers: { cookie: `__Host-jpp_session=${token}` },
        }))).toMatchObject({
            tenantId: TENANT_ID,
            userId: USER_ID,
            sessionId: SESSION_ID,
            authSource: "browser",
        });
    });

    it("브라우저 변경 요청에는 쿠키와 헤더의 동일한 CSRF 토큰이 필요하다", () => {
        const now = 1_800_000_000;
        vi.useFakeTimers();
        vi.setSystemTime(now * 1000);
        vi.stubEnv("NODE_ENV", "production");
        vi.stubEnv("SESSION_SIGNING_SECRET", SECRET);
        const csrfToken = "csrf-token";
        const token = createBrowserSessionToken({
            v: 1,
            typ: "browser_session",
            aud: "jumunpangpang-browser",
            sessionId: SESSION_ID,
            tenantId: TENANT_ID,
            userId: USER_ID,
            csrfHash: hashCsrfToken(csrfToken),
            iat: now,
            exp: now + 60,
        });
        const cookie = `__Host-jpp_session=${token}; __Host-jpp_csrf=${csrfToken}`;

        expect(() => requireRequestContext(new Request("https://orders.example/api/orders", {
            method: "POST",
            headers: { cookie },
        }))).toThrowError("요청 보안 토큰을 확인할 수 없습니다.");

        expect(requireRequestContext(new Request("https://orders.example/api/orders", {
            method: "POST",
            headers: { cookie, "x-csrf-token": csrfToken },
        }))).toMatchObject({ sessionId: SESSION_ID, authSource: "browser" });
    });
});
