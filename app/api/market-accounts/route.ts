import { z } from "zod";
import { requireActiveMembership } from "@/lib/server/auth/membership";
import { getCorrelationId, requireRequestContext } from "@/lib/server/auth/request-context";
import { withTenantTransaction } from "@/lib/server/db";
import { ApiError, errorResponse, jsonResponse, parseJsonBody } from "@/lib/server/http/api-error";
import { requireEnabledMarketAdapter } from "@/lib/server/market-accounts/adapter-registry";
import { marketAccountSettingsSchema } from "@/lib/server/market-accounts/settings";
import {
    createMarketAccount,
    listMarketAccounts,
} from "@/lib/server/repositories/market-accounts";

export const dynamic = "force-dynamic";

const commonFields = {
    storeName: z.string().trim().min(1).max(100),
    sellerId: z.string().trim().min(1).max(200),
    externalAccountId: z.string().trim().min(1).max(200).optional(),
    settings: marketAccountSettingsSchema.optional(),
};

const naverCredentials = z.object({
    clientId: z.string().trim().min(1).max(300),
    clientSecret: z.string().min(1).max(1000),
    type: z.enum(["SELF", "SELLER"]).default("SELF"),
    accountId: z.string().trim().min(1).max(300).optional(),
}).strict().superRefine((value, context) => {
    if (value.type === "SELLER" && !value.accountId) {
        context.addIssue({
            code: "custom",
            path: ["accountId"],
            message: "SELLER 인증에는 accountId가 필요합니다.",
        });
    }
});

const createSchema = z.discriminatedUnion("marketCode", [
    z.object({
        marketCode: z.literal("NAVER"),
        ...commonFields,
        credentials: naverCredentials,
    }).strict(),
    z.object({
        marketCode: z.literal("COUPANG"),
        ...commonFields,
        credentials: z.object({
            vendorId: z.string().trim().min(1).max(100),
            accessKey: z.string().trim().min(1).max(500),
            secretKey: z.string().min(1).max(1000),
        }).strict(),
    }).strict(),
    z.object({
        marketCode: z.literal("ELEVEN_STREET"),
        ...commonFields,
        credentials: z.object({
            apiKey: z.string().trim().min(1).max(1000),
        }).strict(),
    }).strict(),
    z.object({
        marketCode: z.enum(["GMARKET", "AUCTION"]),
        ...commonFields,
        credentials: z.object({
            masterId: z.string().trim().min(1).max(200),
            secretKey: z.string().min(1).max(1000),
            siteSellerId: z.string().trim().min(1).max(200),
        }).strict(),
    }).strict(),
]).superRefine((value, context) => {
    const preference = value.settings?.shippingProcessPreference;
    const configurable = value.marketCode === "NAVER" || value.marketCode === "ELEVEN_STREET";

    if (configurable && preference === undefined) {
        context.addIssue({
            code: "custom",
            path: ["settings", "shippingProcessPreference"],
            message: "스마트스토어와 11번가는 연동할 때 기본 배송중 처리 방식을 선택해야 합니다.",
        });
    }
    if (!configurable && preference === "DIRECT_DELIVERY") {
        context.addIssue({
            code: "custom",
            path: ["settings", "shippingProcessPreference"],
            message: "이 마켓은 송장입력 방식만 사용할 수 있습니다.",
        });
    }
    if (value.marketCode !== "NAVER" && preference === "OVERSEAS_OTHER_DELIVERY") {
        context.addIssue({
            code: "custom",
            path: ["settings", "shippingProcessPreference"],
            message: "스마트스토어만 해외기타배송을 기본 방식으로 사용할 수 있습니다.",
        });
    }
});

function isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error
        && (error as { code?: unknown }).code === "23505";
}

export async function GET(request: Request): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const accounts = await withTenantTransaction(context.tenantId, async (client) => {
            await requireActiveMembership(client, context, ["OWNER", "ADMIN", "OPERATOR", "VIEWER"]);
            return listMarketAccounts(client, context.tenantId);
        }, { readOnly: true });

        return jsonResponse(accounts, correlationId);
    } catch (error) {
        return errorResponse(error, correlationId);
    }
}

export async function POST(request: Request): Promise<Response> {
    const correlationId = getCorrelationId(request);

    try {
        const context = requireRequestContext(request, correlationId);
        const body = await parseJsonBody(request, createSchema);
        requireEnabledMarketAdapter(body.marketCode);
        const account = await withTenantTransaction(context.tenantId, async (client) => {
            const membership = await requireActiveMembership(client, context, ["OWNER", "ADMIN"]);
            return createMarketAccount(client, {
                tenantId: context.tenantId,
                membershipId: membership.id,
                marketCode: body.marketCode,
                storeName: body.storeName,
                sellerId: body.sellerId,
                externalAccountId: body.externalAccountId,
                credentials: body.credentials,
                settings: body.settings,
                correlationId,
            });
        });

        return jsonResponse(account, correlationId, 201);
    } catch (error) {
        if (isUniqueViolation(error)) {
            return errorResponse(new ApiError(
                409,
                "MARKET_ACCOUNT_CONFLICT",
                "같은 판매자 계정 또는 스토어명이 이미 등록되어 있습니다.",
            ), correlationId);
        }

        return errorResponse(error, correlationId);
    }
}
