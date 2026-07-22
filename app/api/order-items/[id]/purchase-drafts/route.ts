import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse, jsonResponse, parseJsonBody } from "@/lib/server/http/api-error";
import {
    configuredSourcingFreshnessSeconds,
    preparePurchaseDraft,
    preparePurchaseDraftBodySchema,
} from "@/lib/server/sourcing";

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
        const body = await parseJsonBody(request, preparePurchaseDraftBodySchema);
        const draft = await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(client, context, ["OWNER", "ADMIN", "OPERATOR"]);
            return preparePurchaseDraft(client, {
                ...body,
                tenantId: context.tenantId,
                orderItemId: id,
                membershipId: membership.id,
                correlationId,
                now: new Date(),
                maximumFreshnessSeconds: configuredSourcingFreshnessSeconds(),
            });
        });
        return jsonResponse({
            ...draft,
            prePaymentStopMessage: "이 초안은 실제 결제 또는 구매 제출을 수행하지 않습니다.",
        }, correlationId, draft.replayed ? 200 : 201);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
