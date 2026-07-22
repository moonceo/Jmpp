import { browserSessionClearCookieHeaders } from "@/lib/server/auth/browser-session";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http/api-error";

export async function POST(request: Request): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        if (context.authSource === "browser" && context.sessionId) {
            await withTenantTransaction(context.tenantId, async (client) => {
                await client.query(
                    `UPDATE browser_sessions
                        SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
                            revocation_reason = COALESCE(revocation_reason, 'USER_LOGOUT')
                      WHERE tenant_id = $1
                        AND id = $2
                        AND user_id = $3`,
                    [context.tenantId, context.sessionId, context.userId],
                );
            });
        }

        const response = new Response(null, {
            status: 204,
            headers: {
                "cache-control": "no-store",
                "x-correlation-id": correlationId,
            },
        });
        for (const cookie of browserSessionClearCookieHeaders()) {
            response.headers.append("set-cookie", cookie);
        }
        return response;
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
