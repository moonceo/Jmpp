import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { findOutboundCommandById, toPublicOutboundCommand } from "@/lib/server/commands";
import { withTenantTransaction } from "@/lib/server/db";
import { ApiError, errorResponse, jsonResponse } from "@/lib/server/http/api-error";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.uuid() });

export async function GET(
    request: Request,
    route: { params: Promise<{ id: string }> },
): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const { id } = paramsSchema.parse(await route.params);
        const command = await withTenantTransaction(context.tenantId, async (client) => {
            await requireActiveMembership(
                client,
                context,
                ["OWNER", "ADMIN", "OPERATOR", "VIEWER"],
            );

            return findOutboundCommandById(client, context.tenantId, id);
        }, { readOnly: true });

        if (!command) {
            throw new ApiError(404, "COMMAND_NOT_FOUND", "The command was not found.");
        }

        return jsonResponse(toPublicOutboundCommand(command), context.correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
