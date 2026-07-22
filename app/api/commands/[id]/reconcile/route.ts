import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import {
    MANUAL_RECONCILIATION_ACTIONS,
    OutboundCommandReconciliationError,
    reconcileOutboundCommand,
    toPublicOutboundCommand,
} from "@/lib/server/commands";
import { withTenantTransaction } from "@/lib/server/db";
import { ApiError, errorResponse, jsonResponse, parseJsonBody } from "@/lib/server/http/api-error";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.uuid() });
const versionSchema = z.union([
    z.number().int().positive().safe().transform(String),
    z.string().regex(/^[1-9]\d*$/).max(19),
]).refine((value) => BigInt(value) <= BigInt("9223372036854775807"), {
    message: "expectedVersion must fit in a signed bigint.",
});
const requestSchema = z.object({
    action: z.enum(MANUAL_RECONCILIATION_ACTIONS),
    expectedVersion: versionSchema,
    reason: z.string().trim().min(1).max(500).optional(),
}).strict().superRefine((value, context) => {
    if (value.action === "ABANDON" && !value.reason) {
        context.addIssue({
            code: "custom",
            path: ["reason"],
            message: "ABANDON requires an explicit reason.",
        });
    }
});

function reconciliationApiError(error: unknown): ApiError | null {
    if (!(error instanceof OutboundCommandReconciliationError)) return null;
    if (error.code === "COMMAND_NOT_FOUND") {
        return new ApiError(404, error.code, error.message);
    }
    if (error.code === "COMMAND_RECONCILIATION_UNSUPPORTED_MARKET") {
        return new ApiError(422, error.code, error.message);
    }
    return new ApiError(409, error.code, error.message);
}

export async function POST(
    request: Request,
    route: { params: Promise<{ id: string }> },
): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const { id } = paramsSchema.parse(await route.params);
        const body = await parseJsonBody(request, requestSchema);
        const command = await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(
                client,
                context,
                ["OWNER", "ADMIN"],
            );
            return reconcileOutboundCommand(client, {
                tenantId: context.tenantId,
                commandId: id,
                membershipId: membership.id,
                correlationId: context.correlationId,
                expectedVersion: body.expectedVersion,
                action: body.action,
                reason: body.reason,
            });
        });

        return jsonResponse(
            { command: toPublicOutboundCommand(command) },
            correlationId,
            body.action === "RECHECK" ? 202 : 200,
        );
    } catch (error) {
        return errorResponse(reconciliationApiError(error) ?? error, correlationId);
    }
}
