import type { QueryResultRow } from "pg";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/http/api-error";

interface SessionProfileRow extends QueryResultRow {
    workspace_slug: string;
    workspace_name: string;
    email: string;
    display_name: string | null;
}

export async function GET(request: Request): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const profile = await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(
                client,
                context,
                ["OWNER", "ADMIN", "OPERATOR", "VIEWER"],
            );
            const result = await client.query<SessionProfileRow>(
                `SELECT t.slug AS workspace_slug,
                        t.name AS workspace_name,
                        u.email,
                        u.display_name
                   FROM tenants t
                   JOIN users u ON u.id = $2
                  WHERE t.id = $1`,
                [context.tenantId, context.userId],
            );
            return { membership, row: result.rows[0] };
        }, { readOnly: true });

        return jsonResponse({
            tenantId: context.tenantId,
            userId: context.userId,
            role: profile.membership.role,
            workspaceSlug: profile.row?.workspace_slug ?? null,
            workspaceName: profile.row?.workspace_name ?? null,
            email: profile.row?.email ?? null,
            displayName: profile.row?.display_name ?? null,
        }, correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
