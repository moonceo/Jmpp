import { randomUUID } from "node:crypto";
import { compare } from "bcryptjs";
import type { QueryResultRow } from "pg";
import {
    browserSessionDurationSeconds,
    createBrowserSessionToken,
    createCsrfToken,
    hashCsrfToken,
} from "@/lib/server/auth/browser-session";
import { query, withTenantTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http/api-error";

const DUMMY_PASSWORD_HASH = "$2b$12$/UwyHUNk3B4NajfmLL4P0.30gweoqLCFZgBuiXmcwbM4msOgd8TQe";

interface PasswordLoginIdentityRow extends QueryResultRow {
    tenant_id: string;
    user_id: string;
    password_hash: string;
    locked_until: Date | null;
}

export interface PasswordLoginInput {
    workspaceSlug: string;
    email: string;
    password: string;
    correlationId: string;
}

export interface CreatedBrowserSession {
    sessionToken: string;
    csrfToken: string;
    maxAgeSeconds: number;
    tenantId: string;
    userId: string;
    expiresAt: string;
}

async function loginIdentity(input: PasswordLoginInput): Promise<PasswordLoginIdentityRow | null> {
    const result = await query<PasswordLoginIdentityRow>(
        `SELECT tenant_id, user_id, password_hash, locked_until
           FROM resolve_password_login($1, $2)`,
        [input.workspaceSlug, input.email],
    );
    return result.rows[0] ?? null;
}

export async function createPasswordBrowserSession(
    input: PasswordLoginInput,
    now = new Date(),
): Promise<CreatedBrowserSession> {
    const identity = await loginIdentity(input);
    const passwordMatches = await compare(
        input.password,
        identity?.password_hash ?? DUMMY_PASSWORD_HASH,
    );

    if (identity?.locked_until && identity.locked_until.getTime() > now.getTime()) {
        throw new ApiError(
            429,
            "LOGIN_TEMPORARILY_LOCKED",
            "로그인 시도가 많아 잠시 잠겼습니다. 15분 후 다시 시도해 주세요.",
        );
    }

    if (!identity || !passwordMatches) {
        if (identity) {
            await query("SELECT record_password_login_failure($1)", [identity.user_id]);
        }
        throw new ApiError(
            401,
            "AUTHENTICATION_FAILED",
            "워크스페이스, 이메일 또는 비밀번호를 확인해 주세요.",
        );
    }

    const maxAgeSeconds = browserSessionDurationSeconds();
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAt = new Date((issuedAt + maxAgeSeconds) * 1000);
    const sessionId = randomUUID();
    const csrfToken = createCsrfToken();
    const csrfHash = hashCsrfToken(csrfToken);
    const sessionToken = createBrowserSessionToken({
        v: 1,
        typ: "browser_session",
        aud: "jumunpangpang-browser",
        sessionId,
        tenantId: identity.tenant_id,
        userId: identity.user_id,
        csrfHash,
        iat: issuedAt,
        exp: issuedAt + maxAgeSeconds,
    });

    await withTenantTransaction(identity.tenant_id, async (client) => {
        await client.query("SELECT record_password_login_success($1)", [identity.user_id]);
        const inserted = await client.query(
            `INSERT INTO browser_sessions (
                 id, tenant_id, user_id, csrf_token_hash, expires_at
             )
             SELECT $1, $2, $3, $4, $5
              WHERE EXISTS (
                    SELECT 1
                      FROM memberships m
                      JOIN users u
                        ON u.id = m.user_id
                       AND u.status = 'ACTIVE'
                       AND u.deleted_at IS NULL
                     WHERE m.tenant_id = $2
                       AND m.user_id = $3
                       AND m.status = 'ACTIVE'
                       AND m.deleted_at IS NULL
              )`,
            [sessionId, identity.tenant_id, identity.user_id, csrfHash, expiresAt],
        );
        if (inserted.rowCount !== 1) {
            throw new ApiError(403, "MEMBERSHIP_REQUIRED", "활성 워크스페이스 멤버십이 필요합니다.");
        }

        await client.query(
            `INSERT INTO audit_logs (
                 tenant_id, actor_type, actor_membership_id, action,
                 entity_type, entity_id, correlation_id, after_snapshot
             )
             SELECT $1, 'USER', m.id, 'BROWSER_SESSION_CREATED',
                    'BROWSER_SESSION', $2::text, $4::uuid,
                    jsonb_build_object('expiresAt', $5::timestamptz)
               FROM memberships m
              WHERE m.tenant_id = $1
                AND m.user_id = $3
                AND m.status = 'ACTIVE'
                AND m.deleted_at IS NULL
              LIMIT 1`,
            [
                identity.tenant_id,
                sessionId,
                identity.user_id,
                input.correlationId,
                expiresAt,
            ],
        );
    });

    return {
        sessionToken,
        csrfToken,
        maxAgeSeconds,
        tenantId: identity.tenant_id,
        userId: identity.user_id,
        expiresAt: expiresAt.toISOString(),
    };
}
