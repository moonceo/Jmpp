import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse, jsonResponse, parseJsonBody } from "@/lib/server/http/api-error";
import { validateSourcingMapping, validateSourcingMappingBodySchema } from "@/lib/server/sourcing";

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
        const body = await parseJsonBody(request, validateSourcingMappingBodySchema);
        const report = await withTenantTransaction(context.tenantId, async (client) => {
            await requireActiveMembership(client, context, ["OWNER", "ADMIN", "OPERATOR"]);
            return validateSourcingMapping(client, {
                ...body,
                tenantId: context.tenantId,
                orderItemId: id,
                now: new Date(),
            });
        }, { readOnly: true });
        return jsonResponse(report, correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
