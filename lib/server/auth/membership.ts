import type { QueryResultRow } from "pg";
import type { TransactionClient } from "@/lib/server/db";
import type { MembershipRole, RequestContext } from "@/lib/server/auth/request-context";
import { ApiError } from "@/lib/server/http/api-error";

interface MembershipRow extends QueryResultRow {
    id: string;
    role: MembershipRole;
}

export interface ActiveMembership {
    id: string;
    role: MembershipRole;
}

export async function requireActiveMembership(
    client: TransactionClient,
    context: RequestContext,
    allowedRoles: readonly MembershipRole[],
): Promise<ActiveMembership> {
    if (context.authSource === "browser") {
        if (!context.sessionId) {
            throw new ApiError(401, "INVALID_BROWSER_SESSION", "로그인 세션이 올바르지 않습니다.");
        }

        const sessionResult = await client.query(
            `SELECT 1
               FROM browser_sessions
              WHERE tenant_id = $1
                AND id = $2
                AND user_id = $3
                AND revoked_at IS NULL
                AND expires_at > CURRENT_TIMESTAMP`,
            [context.tenantId, context.sessionId, context.userId],
        );
        if (!sessionResult.rows[0]) {
            throw new ApiError(401, "BROWSER_SESSION_EXPIRED", "로그인 세션이 만료되었습니다.");
        }
    }

    const result = await client.query<MembershipRow>(
        `SELECT m.id, m.role
           FROM memberships m
           JOIN tenants t
             ON t.id = m.tenant_id
            AND t.deleted_at IS NULL
            AND t.status = 'ACTIVE'
           JOIN users u
             ON u.id = m.user_id
            AND u.deleted_at IS NULL
            AND u.status = 'ACTIVE'
          WHERE m.tenant_id = $1
            AND m.user_id = $2
            AND m.status = 'ACTIVE'
            AND m.deleted_at IS NULL`,
        [context.tenantId, context.userId],
    );

    const membership = result.rows[0];
    if (!membership) {
        throw new ApiError(403, "MEMBERSHIP_REQUIRED", "활성 워크스페이스 멤버십이 필요합니다.");
    }

    if (!allowedRoles.includes(membership.role)) {
        throw new ApiError(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
    }

    return membership;
}
