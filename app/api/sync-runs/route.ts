import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/http/api-error";
import { listSyncRuns } from "@/lib/server/repositories/sync-runs";

const statusValues = [
    "PENDING", "RUNNING", "SUCCEEDED", "PARTIAL", "RETRY", "FAILED", "CANCELED", "DEAD",
] as const;

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().min(1).max(512).optional(),
    marketAccountId: z.uuid().optional(),
    status: z.enum(statusValues).optional(),
});

export async function GET(request: Request): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
        const page = await withTenantTransaction(context.tenantId, async (client) => {
            await requireActiveMembership(client, context, ["OWNER", "ADMIN", "OPERATOR", "VIEWER"]);
            return listSyncRuns(client, context.tenantId, query);
        }, { readOnly: true });

        return jsonResponse(page, correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
