import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse, jsonResponse, parseJsonBody } from "@/lib/server/http/api-error";
import {
    approveCapabilityUat,
    UAT_APPROVABLE_NAVER_ACTIONS,
} from "@/lib/server/market-accounts/capability-uat";

const paramsSchema = z.object({
    id: z.uuid(),
    action: z.enum(UAT_APPROVABLE_NAVER_ACTIONS),
});
const bodySchema = z.object({
    expectedVersion: z.string().regex(/^[1-9]\d*$/).max(19)
        .refine((value) => BigInt(value) <= BigInt("9223372036854775807")),
    evidenceRef: z.string().trim().min(3).max(500).regex(/^[^\u0000-\u001f\u007f]+$/),
    note: z.string().trim().min(1).max(500).optional(),
}).strict();

export async function POST(
    request: Request,
    route: { params: Promise<{ id: string; action: string }> },
): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const { id, action } = paramsSchema.parse(await route.params);
        const body = await parseJsonBody(request, bodySchema);
        const result = await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(client, context, ["OWNER", "ADMIN"]);
            return approveCapabilityUat(client, {
                tenantId: context.tenantId,
                marketAccountId: id,
                membershipId: membership.id,
                correlationId,
                action,
                approvedAt: new Date().toISOString(),
                ...body,
            });
        });

        return jsonResponse(result, correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
