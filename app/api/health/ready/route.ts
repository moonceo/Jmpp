import type { QueryResultRow } from "pg";
import { getCorrelationId } from "@/lib/server/auth/request-context";
import { browserSessionDurationSeconds } from "@/lib/server/auth/browser-session";
import { getDbPool } from "@/lib/server/db";
import {
    databaseRoleSafetySql,
    isSafeApplicationDatabaseRole,
    type DatabaseRoleSafety,
} from "@/lib/server/db/role-safety";
import { ApiError, errorResponse, jsonResponse } from "@/lib/server/http/api-error";
import { isMarketAdapterEnabled } from "@/lib/server/market-accounts/adapter-registry";
import { createCredentialCipher } from "@/lib/server/security";

export const dynamic = "force-dynamic";

type AppDatabaseRoleRow = QueryResultRow & DatabaseRoleSafety;

function assertRequiredConfiguration(): void {
    const allowInsecureDevAuth = process.env.NODE_ENV !== "production"
        && process.env.ALLOW_INSECURE_DEV_AUTH === "true";
    const authSecret = process.env.INTERNAL_AUTH_SHARED_SECRET?.trim();
    const sessionSecret = process.env.SESSION_SIGNING_SECRET?.trim();
    const cursorSecret = process.env.CURSOR_SIGNING_SECRET?.trim();
    const encryptionKey = process.env.DATA_ENCRYPTION_KEY?.trim();

    if (!allowInsecureDevAuth && (!authSecret || authSecret.length < 32)) {
        throw new ApiError(503, "AUTH_NOT_CONFIGURED", "필수 인증 설정이 누락되었습니다.");
    }
    if (!allowInsecureDevAuth && (!sessionSecret || sessionSecret.length < 32)) {
        throw new ApiError(503, "SESSION_AUTH_NOT_CONFIGURED", "브라우저 세션 설정이 누락되었습니다.");
    }
    if (!allowInsecureDevAuth) browserSessionDurationSeconds();
    if (!cursorSecret || cursorSecret.length < 32) {
        throw new ApiError(503, "CURSOR_SIGNING_NOT_CONFIGURED", "필수 커서 서명 설정이 누락되었습니다.");
    }
    if (!encryptionKey) {
        throw new ApiError(503, "ENCRYPTION_NOT_CONFIGURED", "필수 암호화 설정이 누락되었습니다.");
    }

    try {
        createCredentialCipher(encryptionKey);
    } catch {
        throw new ApiError(503, "ENCRYPTION_NOT_CONFIGURED", "암호화 키 구성이 올바르지 않습니다.");
    }

    // Parsing this setting fails readiness when an unimplemented adapter is
    // accidentally enabled, before the service accepts any credentials.
    isMarketAdapterEnabled("NAVER");
}

export async function GET(request: Request): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        assertRequiredConfiguration();
        const client = await getDbPool().connect();

        try {
            await client.query("BEGIN");
            try {
                await client.query("SET LOCAL statement_timeout = '2s'");
                await client.query("SELECT 1");
                const roleResult = await client.query<AppDatabaseRoleRow>(databaseRoleSafetySql);
                const databaseRole = roleResult.rows[0];
                if (!isSafeApplicationDatabaseRole(databaseRole)) {
                    throw new ApiError(
                        503,
                        "UNSAFE_APPLICATION_DATABASE_ROLE",
                        "애플리케이션 DB 역할이 테넌트 RLS를 우회할 수 있습니다.",
                    );
                }
            } finally {
                await client.query("ROLLBACK");
            }
        } finally {
            client.release();
        }

        return jsonResponse({
            status: "ready",
            probe: "readiness",
            database: "available",
            timestamp: new Date().toISOString(),
        }, correlationId);
    } catch (error) {
        const response = errorResponse(error, correlationId);
        const body = await response.json() as { error?: unknown; meta?: unknown };

        return Response.json({
            ...body,
            status: "not_ready",
            database: "unavailable",
        }, {
            status: 503,
            headers: { "x-correlation-id": correlationId },
        });
    }
}
