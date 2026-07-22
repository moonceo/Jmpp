import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse, jsonResponse, parseJsonBody } from "@/lib/server/http/api-error";
import { enqueueSyncRun } from "@/lib/server/repositories/sync-runs";

const paramsSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({ stream: z.literal("ORDERS").default("ORDERS") }).strict();

export async function POST(
    request: Request,
    route: { params: Promise<{ id: string }> },
): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const { id } = paramsSchema.parse(await route.params);
        const body = request.body === null
            ? { stream: "ORDERS" as const }
            : await parseJsonBody(request, bodySchema);
        const result = await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(
                client,
                context,
                ["OWNER", "ADMIN", "OPERATOR"],
            );
            return enqueueSyncRun(client, {
                tenantId: context.tenantId,
                marketAccountId: id,
                membershipId: membership.id,
                stream: body.stream,
                correlationId,
            });
        });

        return jsonResponse(result, correlationId, 202);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
