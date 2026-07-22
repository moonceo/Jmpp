import { z } from "zod";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/http/api-error";
import {
    listOrders,
    NORMALIZED_ORDER_STATUSES,
    ORDER_MARKET_CODES,
} from "@/lib/server/repositories/orders";

export const dynamic = "force-dynamic";

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
    marketCode: z.enum(ORDER_MARKET_CODES).optional(),
    normalizedStatus: z.enum(NORMALIZED_ORDER_STATUSES).optional(),
    search: z.string().trim().min(1).max(100).optional(),
});

export async function GET(request: Request): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const url = new URL(request.url);
        const parsed = querySchema.parse(Object.fromEntries(url.searchParams));
        const page = await withTenantTransaction(context.tenantId, async (client) => {
            await requireActiveMembership(client, context, ["OWNER", "ADMIN", "OPERATOR", "VIEWER"]);
            return listOrders(client, context.tenantId, parsed);
        }, { readOnly: true, isolationLevel: "REPEATABLE READ" });

        return jsonResponse(page, context.correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
