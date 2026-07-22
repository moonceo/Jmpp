import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/http/api-error";
import { enqueueSyncRun } from "@/lib/server/repositories/sync-runs";

const paramsSchema = z.object({ id: z.uuid() });

export async function POST(
    request: Request,
    route: { params: Promise<{ id: string }> },
): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const { id } = paramsSchema.parse(await route.params);
        const result = await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(client, context, ["OWNER", "ADMIN"]);
            return enqueueSyncRun(client, {
                tenantId: context.tenantId,
                marketAccountId: id,
                membershipId: membership.id,
                stream: "ACCOUNT_VERIFY",
                correlationId,
            });
        });

        return jsonResponse(result, correlationId, 202);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
