import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { ApiError, errorResponse, jsonResponse, parseJsonBody } from "@/lib/server/http/api-error";
import { marketAccountSettingsSchema } from "@/lib/server/market-accounts/settings";
import {
    deleteMarketAccount,
    updateMarketAccount,
} from "@/lib/server/repositories/market-accounts";

const paramsSchema = z.object({ id: z.uuid() });
const versionSchema = z.string()
    .regex(/^[1-9]\d*$/)
    .max(19)
    .refine((value) => BigInt(value) <= BigInt("9223372036854775807"), {
        message: "version 값이 bigint 범위를 벗어났습니다.",
    });
const patchSchema = z.object({
    expectedVersion: versionSchema,
    storeName: z.string().trim().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
    settings: marketAccountSettingsSchema.optional(),
}).strict().refine(
    (value) => value.storeName !== undefined || value.isActive !== undefined || value.settings !== undefined,
    { message: "변경할 값을 하나 이상 입력해 주세요." },
);

function repositoryError(error: unknown): ApiError | null {
    if (typeof error === "object" && error !== null && "code" in error
        && (error as { code?: unknown }).code === "23505") {
        return new ApiError(409, "MARKET_ACCOUNT_CONFLICT", "같은 스토어명 또는 판매자 계정이 이미 활성화되어 있습니다.");
    }
    if (!(error instanceof Error)) return null;

    if (error.message === "MARKET_ACCOUNT_NOT_FOUND") {
        return new ApiError(404, error.message, "마켓 계정을 찾을 수 없습니다.");
    }
    if (error.message === "MARKET_ACCOUNT_VERSION_CONFLICT") {
        return new ApiError(409, error.message, "계정 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }
    if (error.message === "MARKET_ACCOUNT_HAS_ACTIVE_WORK") {
        return new ApiError(409, error.message, "진행 중인 수집 또는 마켓 명령이 있어 삭제할 수 없습니다.");
    }

    return null;
}

export async function PATCH(
    request: Request,
    route: { params: Promise<{ id: string }> },
): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const { id } = paramsSchema.parse(await route.params);
        const body = await parseJsonBody(request, patchSchema);
        const account = await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(client, context, ["OWNER", "ADMIN"]);
            return updateMarketAccount(client, {
                tenantId: context.tenantId,
                marketAccountId: id,
                membershipId: membership.id,
                expectedVersion: body.expectedVersion,
                storeName: body.storeName,
                isActive: body.isActive,
                settings: body.settings,
                correlationId,
            });
        });

        return jsonResponse(account, correlationId);
    } catch (error) {
        return errorResponse(repositoryError(error) ?? error, correlationId);
    }
}

export async function DELETE(
    request: Request,
    route: { params: Promise<{ id: string }> },
): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const { id } = paramsSchema.parse(await route.params);
        const expectedVersion = versionSchema.parse(new URL(request.url).searchParams.get("expectedVersion"));
        await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(client, context, ["OWNER", "ADMIN"]);
            await deleteMarketAccount(client, {
                tenantId: context.tenantId,
                marketAccountId: id,
                membershipId: membership.id,
                expectedVersion,
                correlationId,
            });
        });

        return new Response(null, { status: 204, headers: { "x-correlation-id": correlationId } });
    } catch (error) {
        return errorResponse(repositoryError(error) ?? error, correlationId);
    }
}
