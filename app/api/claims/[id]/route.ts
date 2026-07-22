import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { getClaimDetail } from "@/lib/server/claims";
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
        const claim = await withTenantTransaction(context.tenantId, async (client) => {
            await requireActiveMembership(client, context, ["OWNER", "ADMIN", "OPERATOR", "VIEWER"]);
            const found = await getClaimDetail(client, context.tenantId, id);
            if (!found) throw new ApiError(404, "CLAIM_NOT_FOUND", "클레임을 찾을 수 없습니다.");
            return found;
        }, { readOnly: true });
        return jsonResponse(claim, correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
