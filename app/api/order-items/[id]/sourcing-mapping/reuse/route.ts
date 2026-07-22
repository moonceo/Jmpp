import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { ApiError, errorResponse, jsonResponse } from "@/lib/server/http/api-error";
import { findLatestApprovedReusableRule } from "@/lib/server/sourcing";

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
        const rule = await withTenantTransaction(context.tenantId, async (client) => {
            await requireActiveMembership(client, context, ["OWNER", "ADMIN", "OPERATOR", "VIEWER"]);
            const reusable = await findLatestApprovedReusableRule(client, context.tenantId, id);
            if (!reusable) {
                throw new ApiError(
                    404,
                    "APPROVED_SOURCING_RULE_NOT_FOUND",
                    "이 주문상품에 재사용할 수 있는 검증·승인 매칭 규칙이 없습니다.",
                );
            }
            return reusable;
        }, { readOnly: true });
        return jsonResponse(rule, correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
