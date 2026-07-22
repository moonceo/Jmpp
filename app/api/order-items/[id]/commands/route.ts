import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import {
    acceptOrderItemCommand,
    orderItemCommandRequestSchema,
    toPublicOutboundCommand,
} from "@/lib/server/commands";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse, jsonResponse, parseJsonBody } from "@/lib/server/http/api-error";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.uuid() });

export async function POST(
    request: Request,
    route: { params: Promise<{ id: string }> },
): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const { id } = paramsSchema.parse(await route.params);
        const body = await parseJsonBody(request, orderItemCommandRequestSchema);
        const accepted = await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(
                client,
                context,
                ["OWNER", "ADMIN", "OPERATOR"],
            );

            return acceptOrderItemCommand(client, {
                tenantId: context.tenantId,
                membershipId: membership.id,
                orderItemId: id,
                correlationId: context.correlationId,
                request: body,
            });
        });

        return jsonResponse({
            command: toPublicOutboundCommand(accepted.command),
            replayed: accepted.replayed,
        }, context.correlationId, 202);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
