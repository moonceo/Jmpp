import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse, jsonResponse, parseJsonBody } from "@/lib/server/http/api-error";
import {
    domesticInvoiceBodySchema,
    saveDomesticInvoice,
} from "@/lib/server/order-items/domestic-invoice";

const paramsSchema = z.object({ id: z.uuid() });

export async function PUT(
    request: Request,
    route: { params: Promise<{ id: string }> },
): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const { id } = paramsSchema.parse(await route.params);
        const body = await parseJsonBody(request, domesticInvoiceBodySchema);
        const invoice = await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(client, context, ["OWNER", "ADMIN", "OPERATOR"]);
            return saveDomesticInvoice(client, {
                tenantId: context.tenantId,
                orderItemId: id,
                membershipId: membership.id,
                correlationId,
                ...body,
            });
        });

        return jsonResponse(invoice, correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
