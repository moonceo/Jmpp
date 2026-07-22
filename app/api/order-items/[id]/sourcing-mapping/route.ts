import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { ApiError, errorResponse, jsonResponse, parseJsonBody } from "@/lib/server/http/api-error";
import {
    getActiveMapping,
    saveSourcingMapping,
    saveSourcingMappingBodySchema,
} from "@/lib/server/sourcing";

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
        const mapping = await withTenantTransaction(context.tenantId, async (client) => {
            await requireActiveMembership(client, context, ["OWNER", "ADMIN", "OPERATOR", "VIEWER"]);
            const active = await getActiveMapping(client, context.tenantId, id);
            if (!active) {
                throw new ApiError(404, "SOURCING_MAPPING_NOT_FOUND", "활성 소싱 매핑을 찾을 수 없습니다.");
            }
            return active;
        }, { readOnly: true });
        return jsonResponse(mapping, correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}

export async function PUT(
    request: Request,
    route: { params: Promise<{ id: string }> },
): Promise<Response> {
    const correlationId = getCorrelationId(request);
    try {
        const context = requireRequestContext(request, correlationId);
        const { id } = paramsSchema.parse(await route.params);
        const body = await parseJsonBody(request, saveSourcingMappingBodySchema);
        const mapping = await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(client, context, ["OWNER", "ADMIN", "OPERATOR"]);
            return saveSourcingMapping(client, {
                ...body,
                tenantId: context.tenantId,
                orderItemId: id,
                membershipId: membership.id,
                correlationId,
            });
        });
        return jsonResponse(mapping, correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
