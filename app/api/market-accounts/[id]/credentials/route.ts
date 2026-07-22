import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse, jsonResponse, parseJsonBody } from "@/lib/server/http/api-error";
import { naverCredentialsSchema } from "@/lib/server/market-accounts/credentials";
import { rotateMarketAccountCredentials } from "@/lib/server/repositories/market-accounts";
import { enqueueSyncRun } from "@/lib/server/repositories/sync-runs";

const paramsSchema = z.object({ id: z.uuid() });
const versionSchema = z.string()
    .regex(/^[1-9]\d*$/)
    .max(19)
    .refine((value) => BigInt(value) <= BigInt("9223372036854775807"));
const bodySchema = z.object({
    expectedVersion: versionSchema,
    credentials: naverCredentialsSchema,
}).strict();

export async function PUT(
    request: Request,
    route: { params: Promise<{ id: string }> },
): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const { id } = paramsSchema.parse(await route.params);
        const body = await parseJsonBody(request, bodySchema);
        const result = await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(client, context, ["OWNER", "ADMIN"]);
            const account = await rotateMarketAccountCredentials(client, {
                tenantId: context.tenantId,
                marketAccountId: id,
                membershipId: membership.id,
                expectedVersion: body.expectedVersion,
                credentials: body.credentials,
                correlationId,
            });
            const verification = await enqueueSyncRun(client, {
                tenantId: context.tenantId,
                marketAccountId: id,
                membershipId: membership.id,
                stream: "ACCOUNT_VERIFY",
                correlationId,
            });

            return { account, verification };
        });

        return jsonResponse(result, correlationId, 202);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
