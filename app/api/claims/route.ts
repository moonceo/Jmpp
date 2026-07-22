import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import {
    CLAIM_REQUESTERS,
    CLAIM_STATUSES,
    CLAIM_TYPES,
    listClaims,
} from "@/lib/server/claims";
import { withTenantTransaction } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/http/api-error";

export const dynamic = "force-dynamic";

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().trim().min(1).max(4_096).optional(),
    claimType: z.enum(CLAIM_TYPES).optional(),
    status: z.enum(CLAIM_STATUSES).optional(),
    requesterType: z.enum(CLAIM_REQUESTERS).optional(),
    marketAccountId: z.uuid().optional(),
    deadlineBefore: z.iso.datetime({ offset: true }).optional(),
    activeOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    search: z.string().trim().min(1).max(200).optional(),
}).strict();

export async function GET(request: Request): Promise<Response> {
    const correlationId = getCorrelationId(request);
    try {
        const context = requireRequestContext(request, correlationId);
        const url = new URL(request.url);
        const query = querySchema.parse(Object.fromEntries(url.searchParams));
        const page = await withTenantTransaction(context.tenantId, async (client) => {
            await requireActiveMembership(client, context, ["OWNER", "ADMIN", "OPERATOR", "VIEWER"]);
            return listClaims(client, context.tenantId, query);
        }, { readOnly: true });
        return jsonResponse(page, correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}
