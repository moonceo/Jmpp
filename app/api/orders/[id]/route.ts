import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { ApiError, errorResponse, jsonResponse } from "@/lib/server/http/api-error";
import { getOrderDetail } from "@/lib/server/repositories/orders";

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
        const order = await withTenantTransaction(context.tenantId, async (client) => {
            await requireActiveMembership(client, context, ["OWNER", "ADMIN", "OPERATOR", "VIEWER"]);
            return getOrderDetail(client, context.tenantId, id);
        }, { readOnly: true, isolationLevel: "REPEATABLE READ" });

        if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "주문을 찾을 수 없습니다.");
        return jsonResponse(order, context.correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
