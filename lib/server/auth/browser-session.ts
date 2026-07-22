import {
    createHash,
    createHmac,
    randomBytes,
    timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/server/http/api-error";

const BROWSER_SESSION_AUDIENCE = "jumunpangpang-browser";
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const MIN_SESSION_TTL_SECONDS = 5 * 60;
const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60;

const browserSessionClaimsSchema = z.object({
    v: z.literal(1),
    typ: z.literal("browser_session"),
    aud: z.literal(BROWSER_SESSION_AUDIENCE),
    sessionId: z.uuid(),
    tenantId: z.uuid(),
    userId: z.uuid(),
    csrfHash: z.string().regex(/^[0-9a-f]{64}$/),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
});

export type BrowserSessionClaims = z.infer<typeof browserSessionClaimsSchema>;

function sessionSecret(environment: NodeJS.ProcessEnv): string {
    const secret = environment.SESSION_SIGNING_SECRET?.trim();
    if (!secret || secret.length < 32) {
        throw new ApiError(
            503,
            "SESSION_AUTH_NOT_CONFIGURED",
            "브라우저 세션 구성이 완료되지 않았습니다.",
        );
    }
    return secret;
}

function signature(encodedPayload: string, secret: string): Buffer {
    return createHmac("sha256", secret).update(encodedPayload, "utf8").digest();
}

function constantTimeEqual(actual: Buffer, expected: Buffer): boolean {
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function browserSessionDurationSeconds(
    environment: NodeJS.ProcessEnv = process.env,
): number {
    const raw = environment.SESSION_TTL_SECONDS?.trim();
    if (!raw) return DEFAULT_SESSION_TTL_SECONDS;
    if (!/^\d+$/.test(raw)) {
        throw new ApiError(503, "INVALID_SESSION_CONFIG", "세션 만료시간 설정이 올바르지 않습니다.");
    }

    const parsed = Number(raw);
    if (
        !Number.isSafeInteger(parsed)
        || parsed < MIN_SESSION_TTL_SECONDS
        || parsed > MAX_SESSION_TTL_SECONDS
    ) {
        throw new ApiError(503, "INVALID_SESSION_CONFIG", "세션 만료시간 설정이 올바르지 않습니다.");
    }
    return parsed;
}

export function browserSessionCookieNames(
    environment: NodeJS.ProcessEnv = process.env,
): { session: string; csrf: string } {
    return environment.NODE_ENV === "production"
        ? { session: "__Host-jpp_session", csrf: "__Host-jpp_csrf" }
        : { session: "jpp_session", csrf: "jpp_csrf" };
}

export function createCsrfToken(): string {
    return randomBytes(32).toString("base64url");
}

export function hashCsrfToken(token: string): string {
    return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createBrowserSessionToken(
    claims: BrowserSessionClaims,
    environment: NodeJS.ProcessEnv = process.env,
): string {
    const parsed = browserSessionClaimsSchema.parse(claims);
    const maximumTtl = browserSessionDurationSeconds(environment);
    if (parsed.exp <= parsed.iat || parsed.exp - parsed.iat > maximumTtl) {
        throw new RangeError("Browser session lifetime is invalid.");
    }

    const encodedPayload = Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
    return `${encodedPayload}.${signature(encodedPayload, sessionSecret(environment)).toString("base64url")}`;
}

export function verifyBrowserSessionToken(
    token: string | null,
    environment: NodeJS.ProcessEnv = process.env,
    nowSeconds = Math.floor(Date.now() / 1000),
): BrowserSessionClaims {
    const parts = token?.split(".") ?? [];
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new ApiError(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
    }

    try {
        const actual = Buffer.from(parts[1], "base64url");
        const expected = signature(parts[0], sessionSecret(environment));
        if (!constantTimeEqual(actual, expected)) throw new Error("signature mismatch");

        const decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as unknown;
        const claims = browserSessionClaimsSchema.parse(decoded);
        const configuredTtl = browserSessionDurationSeconds(environment);
        if (
            claims.iat > nowSeconds + 30
            || claims.exp <= nowSeconds
            || claims.exp - claims.iat > configuredTtl
        ) {
            throw new Error("expired or invalid lifetime");
        }
        return claims;
    } catch (error) {
        if (error instanceof ApiError && error.status === 503) throw error;
        throw new ApiError(401, "INVALID_BROWSER_SESSION", "로그인 세션이 올바르지 않거나 만료되었습니다.");
    }
}

export function parseCookieHeader(cookieHeader: string | null): Map<string, string> {
    const cookies = new Map<string, string>();
    for (const part of cookieHeader?.split(";") ?? []) {
        const separator = part.indexOf("=");
        if (separator <= 0) continue;
        const name = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        if (!name || cookies.has(name)) continue;
        try {
            cookies.set(name, decodeURIComponent(value));
        } catch {
            // Malformed unrelated cookies must not crash authentication.
        }
    }
    return cookies;
}

function serializeCookie(
    name: string,
    value: string,
    options: { httpOnly: boolean; maxAge: number; secure: boolean },
): string {
    return [
        `${name}=${encodeURIComponent(value)}`,
        "Path=/",
        `Max-Age=${options.maxAge}`,
        "SameSite=Strict",
        options.httpOnly ? "HttpOnly" : null,
        options.secure ? "Secure" : null,
    ].filter(Boolean).join("; ");
}

export function browserSessionSetCookieHeaders(
    sessionToken: string,
    csrfToken: string,
    maxAgeSeconds: number,
    environment: NodeJS.ProcessEnv = process.env,
): string[] {
    const names = browserSessionCookieNames(environment);
    const secure = environment.NODE_ENV === "production";
    return [
        serializeCookie(names.session, sessionToken, {
            httpOnly: true,
            maxAge: maxAgeSeconds,
            secure,
        }),
        serializeCookie(names.csrf, csrfToken, {
            httpOnly: false,
            maxAge: maxAgeSeconds,
            secure,
        }),
    ];
}

export function browserSessionClearCookieHeaders(
    environment: NodeJS.ProcessEnv = process.env,
): string[] {
    const names = browserSessionCookieNames(environment);
    const secure = environment.NODE_ENV === "production";
    return [
        serializeCookie(names.session, "", { httpOnly: true, maxAge: 0, secure }),
        serializeCookie(names.csrf, "", { httpOnly: false, maxAge: 0, secure }),
    ];
}
