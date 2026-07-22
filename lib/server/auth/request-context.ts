import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
    browserSessionCookieNames,
    hashCsrfToken,
    parseCookieHeader,
    verifyBrowserSessionToken,
} from "@/lib/server/auth/browser-session";
import { ApiError } from "@/lib/server/http/api-error";

const DEFAULT_DEV_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_DEV_USER_ID = "00000000-0000-4000-8000-000000000001";
const AUTH_AUDIENCE = "jumunpangpang";
const MAX_AUTH_CONTEXT_TTL_SECONDS = 300;

export const MEMBERSHIP_ROLES = ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

const contextSchema = z.object({
    tenantId: z.uuid(),
    userId: z.uuid(),
});

const signedClaimsSchema = contextSchema.extend({
    aud: z.literal(AUTH_AUDIENCE),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
});

export interface RequestContext extends z.infer<typeof contextSchema> {
    correlationId: string;
    authSource: "browser" | "internal" | "development";
    sessionId?: string;
}

export interface InternalAuthContextInput extends z.infer<typeof contextSchema> {
    issuedAt: number;
    expiresAt: number;
}

function constantTimeEquals(actual: Buffer, expected: Buffer): boolean {
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function correlationIdFrom(headers: Headers): string {
    const supplied = headers.get("x-correlation-id")?.trim();
    const parsed = z.uuid().safeParse(supplied);

    return parsed.success ? parsed.data : randomUUID();
}

function requireAuthSecret(environment: NodeJS.ProcessEnv): string {
    const secret = environment.INTERNAL_AUTH_SHARED_SECRET?.trim();

    if (!secret || secret.length < 32) {
        throw new ApiError(503, "AUTH_NOT_CONFIGURED", "인증 구성이 완료되지 않았습니다.");
    }

    return secret;
}

function signatureFor(encodedPayload: string, secret: string): Buffer {
    return createHmac("sha256", secret).update(encodedPayload, "utf8").digest();
}

export function createInternalAuthContextToken(
    input: InternalAuthContextInput,
    secret: string,
): string {
    if (secret.trim().length < 32) {
        throw new RangeError("Internal auth secret must contain at least 32 characters.");
    }

    const claims = signedClaimsSchema.parse({
        tenantId: input.tenantId,
        userId: input.userId,
        aud: AUTH_AUDIENCE,
        iat: input.issuedAt,
        exp: input.expiresAt,
    });

    if (claims.exp <= claims.iat || claims.exp - claims.iat > MAX_AUTH_CONTEXT_TTL_SECONDS) {
        throw new RangeError("Internal auth context TTL must be between 1 and 300 seconds.");
    }

    const encodedPayload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const signature = signatureFor(encodedPayload, secret).toString("base64url");

    return `${encodedPayload}.${signature}`;
}

function verifySignedContext(
    token: string | null,
    environment: NodeJS.ProcessEnv,
    nowSeconds = Math.floor(Date.now() / 1000),
): z.infer<typeof contextSchema> {
    const secret = requireAuthSecret(environment);
    const parts = token?.split(".") ?? [];

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new ApiError(401, "UNAUTHENTICATED", "인증이 필요합니다.");
    }

    try {
        const suppliedSignature = Buffer.from(parts[1], "base64url");
        const expectedSignature = signatureFor(parts[0], secret);
        if (!constantTimeEquals(suppliedSignature, expectedSignature)) {
            throw new Error("signature mismatch");
        }

        const decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as unknown;
        const claims = signedClaimsSchema.parse(decoded);

        if (
            claims.iat > nowSeconds + 30
            || claims.exp <= nowSeconds
            || claims.exp - claims.iat > MAX_AUTH_CONTEXT_TTL_SECONDS
        ) {
            throw new Error("expired or invalid lifetime");
        }

        return { tenantId: claims.tenantId, userId: claims.userId };
    } catch {
        throw new ApiError(401, "INVALID_AUTH_CONTEXT", "인증 컨텍스트가 올바르지 않습니다.");
    }
}

export function getCorrelationId(request: Pick<Request, "headers">): string {
    return correlationIdFrom(request.headers);
}

export function requireRequestContext(
    request: Pick<Request, "headers" | "method">,
    correlationId = correlationIdFrom(request.headers),
): RequestContext {
    const allowInsecureDevAuth = process.env.NODE_ENV !== "production"
        && process.env.ALLOW_INSECURE_DEV_AUTH === "true";

    if (allowInsecureDevAuth) {
        const parsed = contextSchema.safeParse({
            tenantId: request.headers.get("x-tenant-id")
                ?? process.env.DEV_TENANT_ID
                ?? DEFAULT_DEV_TENANT_ID,
            userId: request.headers.get("x-user-id")
                ?? process.env.DEV_USER_ID
                ?? DEFAULT_DEV_USER_ID,
        });

        if (!parsed.success) {
            throw new ApiError(401, "INVALID_AUTH_CONTEXT", "개발 인증 컨텍스트가 올바르지 않습니다.");
        }

        return { ...parsed.data, correlationId, authSource: "development" };
    }

    const internalToken = request.headers.get("x-internal-auth-context");
    if (internalToken) {
        const verified = verifySignedContext(internalToken, process.env);
        return { ...verified, correlationId, authSource: "internal" };
    }

    const cookies = parseCookieHeader(request.headers.get("cookie"));
    const cookieNames = browserSessionCookieNames(process.env);
    const claims = verifyBrowserSessionToken(
        cookies.get(cookieNames.session) ?? null,
        process.env,
    );

    if (!new Set(["GET", "HEAD", "OPTIONS"]).has(request.method.toUpperCase())) {
        const csrfCookie = cookies.get(cookieNames.csrf);
        const csrfHeader = request.headers.get("x-csrf-token")?.trim();
        if (
            !csrfCookie
            || !csrfHeader
            || hashCsrfToken(csrfCookie) !== claims.csrfHash
            || hashCsrfToken(csrfHeader) !== claims.csrfHash
        ) {
            throw new ApiError(403, "CSRF_VALIDATION_FAILED", "요청 보안 토큰을 확인할 수 없습니다.");
        }
    }

    return {
        tenantId: claims.tenantId,
        userId: claims.userId,
        sessionId: claims.sessionId,
        correlationId,
        authSource: "browser",
    };
}
