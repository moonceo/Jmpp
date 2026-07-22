import { Buffer } from "node:buffer";

import { compare } from "bcryptjs";
import { describe, expect, it } from "vitest";

import type { FetchLike } from "../core";
import { createNaverClientSecretSign } from "./auth";
import { NAVER_COMMERCE_CAPABILITIES } from "./capabilities";
import {
    NAVER_CONFIRM_MAX_BATCH_SIZE,
    NaverCommerceClient,
} from "./client";

interface CapturedRequest {
    url: string;
    init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function queuedFetch(responses: readonly Response[]): {
    fetch: FetchLike;
    requests: CapturedRequest[];
} {
    const queue = [...responses];
    const requests: CapturedRequest[] = [];
    const fetch: FetchLike = async (input, init) => {
        requests.push({ url: String(input), init });
        const response = queue.shift();
        if (!response) throw new Error("준비된 mock 응답이 없습니다.");
        return response;
    };
    return { fetch, requests };
}

function tokenResponse(accessToken = "token-1"): Response {
    return jsonResponse({
        access_token: accessToken,
        expires_in: 10_800,
        token_type: "Bearer",
    });
}

function changedItem(productOrderId: string, lastChangedDate: string) {
    return {
        productOrderStatus: "PAYED",
        productOrderId,
        orderId: `order-${productOrderId}`,
        lastChangedDate,
        lastChangedType: "PAYED",
        receiverAddressChanged: false,
    };
}

const credentials = {
    clientId: "client-id",
    clientSecret: "client-secret",
    type: "SELF" as const,
};

const fixedNow = 1_720_000_000_000;
const signer = async () => "signed-value";

describe("NaverCommerceClient", () => {
    it("공식 bcrypt 전자서명을 base64로 인코딩한다", async () => {
        const clientSecret = "$2a$04$abcdefghijklmnopqrstuu";
        const encoded = await createNaverClientSecretSign({
            clientId: "client-id",
            clientSecret,
            timestamp: 123,
        });
        const digest = Buffer.from(encoded, "base64").toString("utf8");

        expect(await compare("client-id_123", digest)).toBe(true);
    });

    it("토큰을 expires_in 기준으로 캐시하고 변경 주문 cursor를 이어서 조회한다", async () => {
        const firstBody = {
            timestamp: "2026-07-10T10:00:00+09:00",
            traceId: "trace-1",
            data: {
                lastChangeStatuses: [
                    changedItem("po-1", "2026-07-10T09:00:00+09:00"),
                ],
                more: {
                    moreFrom: "2026-07-10T09:00:01+09:00",
                    moreSequence: "po-2",
                },
                count: 1,
            },
        };
        const secondBody = {
            timestamp: "2026-07-10T10:00:01+09:00",
            traceId: "trace-2",
            data: {
                lastChangeStatuses: [
                    changedItem("po-2", "2026-07-10T09:00:01+09:00"),
                ],
                count: 1,
            },
        };
        const mock = queuedFetch([
            tokenResponse(),
            jsonResponse(firstBody),
            jsonResponse(secondBody),
            tokenResponse("token-2"),
            jsonResponse(secondBody),
        ]);
        let nowMs = fixedNow;
        const client = new NaverCommerceClient({
            credentials,
            signer,
            fetch: mock.fetch,
            now: () => nowMs,
        });

        const first = await client.getChangedProductOrders({
            lastChangedFrom: "2026-07-10T08:00:00+09:00",
            limitCount: 1,
        });
        expect(first.outcome).toBe("success");
        if (first.outcome !== "success") return;
        expect(first.data).toMatchObject({ hasMore: true, count: 1 });
        expect(first.raw.bodyText).toBe(JSON.stringify(firstBody));

        const second = await client.getChangedProductOrders({
            lastChangedFrom: "2026-07-10T08:00:00+09:00",
            cursor: first.data.cursor!,
        });
        expect(second.outcome).toBe("success");
        if (second.outcome !== "success") return;
        expect(second.data).toMatchObject({ hasMore: false, cursor: null });
        expect(mock.requests).toHaveLength(3);

        const tokenRequest = mock.requests[0];
        const tokenForm = new URLSearchParams(String(tokenRequest.init?.body));
        expect(tokenRequest.url).toBe(
            "https://api.commerce.naver.com/external/v1/oauth2/token",
        );
        expect(tokenForm.get("client_id")).toBe("client-id");
        expect(tokenForm.get("timestamp")).toBe(String(fixedNow));
        expect(tokenForm.get("grant_type")).toBe("client_credentials");
        expect(tokenForm.get("client_secret_sign")).toBe("signed-value");
        expect(tokenForm.get("type")).toBe("SELF");

        const nextUrl = new URL(mock.requests[2].url);
        expect(nextUrl.searchParams.get("lastChangedFrom")).toBe(
            "2026-07-10T09:00:01+09:00",
        );
        expect(nextUrl.searchParams.get("moreSequence")).toBe("po-2");
        expect(new Headers(mock.requests[2].init?.headers).get("authorization"))
            .toBe("Bearer token-1");

        nowMs += 10_800 * 1_000;
        const afterExpiry = await client.getChangedProductOrders({
            lastChangedFrom: "2026-07-10T08:00:00+09:00",
        });
        expect(afterExpiry.outcome).toBe("success");
        expect(mock.requests).toHaveLength(5);
        expect(new Headers(mock.requests[4].init?.headers).get("authorization"))
            .toBe("Bearer token-2");
    });

    it("SELLER 토큰에는 판매자 account_id를 포함한다", async () => {
        const mock = queuedFetch([
            tokenResponse(),
            jsonResponse({ data: { lastChangeStatuses: [], count: 0 } }),
        ]);
        const client = new NaverCommerceClient({
            credentials: {
                ...credentials,
                type: "SELLER",
                accountId: "seller-account-id",
            },
            signer,
            fetch: mock.fetch,
            now: () => fixedNow,
        });

        await client.getChangedProductOrders({
            lastChangedFrom: "2026-07-10T08:00:00+09:00",
        });

        const form = new URLSearchParams(String(mock.requests[0].init?.body));
        expect(form.get("type")).toBe("SELLER");
        expect(form.get("account_id")).toBe("seller-account-id");
    });

    it("GW.AUTHN 401이면 토큰을 폐기하고 한 번만 재발급한다", async () => {
        const mock = queuedFetch([
            tokenResponse("expired-token"),
            jsonResponse(
                { code: "GW.AUTHN", message: "권한이 없습니다." },
                401,
            ),
            tokenResponse("fresh-token"),
            jsonResponse({
                data: {
                    lastChangeStatuses: [],
                    count: 0,
                },
            }),
        ]);
        const client = new NaverCommerceClient({
            credentials,
            signer,
            fetch: mock.fetch,
            now: () => fixedNow,
        });

        const result = await client.getChangedProductOrders({
            lastChangedFrom: "2026-07-10T08:00:00+09:00",
        });

        expect(result.outcome).toBe("success");
        expect(mock.requests).toHaveLength(4);
        expect(new Headers(mock.requests[1].init?.headers).get("authorization"))
            .toBe("Bearer expired-token");
        expect(new Headers(mock.requests[3].init?.headers).get("authorization"))
            .toBe("Bearer fresh-token");
    });

    it("상세 조회, 발주 부분성공, 택배/직접전달 발송 계약을 보존한다", async () => {
        const mock = queuedFetch([
            tokenResponse(),
            jsonResponse({
                traceId: "detail-trace",
                data: [
                    {
                        order: { orderId: "order-1" },
                        productOrder: { productOrderId: "po-1" },
                    },
                ],
            }),
            jsonResponse({
                traceId: "confirm-trace",
                data: {
                    successProductOrderInfos: [{ productOrderId: "po-1" }],
                    failProductOrderInfos: [
                        {
                            productOrderId: "po-2",
                            code: "104133",
                            message: "잘못된 요청",
                        },
                    ],
                },
            }),
            jsonResponse({
                traceId: "dispatch-trace",
                data: {
                    successProductOrderIds: ["po-1", "po-2"],
                    failProductOrderInfos: [],
                },
            }),
        ]);
        const client = new NaverCommerceClient({
            credentials,
            signer,
            fetch: mock.fetch,
            now: () => fixedNow,
        });

        const details = await client.getProductOrderDetails(["po-1"], {
            quantityClaimCompatibility: true,
        });
        expect(details.outcome).toBe("success");
        expect(JSON.parse(String(mock.requests[1].init?.body))).toEqual({
            productOrderIds: ["po-1"],
            quantityClaimCompatibility: true,
        });

        const confirmation = await client.confirmProductOrders(["po-1", "po-2"]);
        expect(confirmation.outcome).toBe("partial");
        if (confirmation.outcome !== "partial") return;
        expect(confirmation.data).toEqual({
            succeededProductOrderIds: ["po-1"],
            failedProductOrders: [
                {
                    productOrderId: "po-2",
                    code: "104133",
                    message: "잘못된 요청",
                    retryable: false,
                },
            ],
        });
        expect(confirmation.issues[0]).toMatchObject({
            kind: "remote_item_failure",
            externalId: "po-2",
            code: "104133",
        });

        const dispatch = await client.dispatchProductOrders([
            {
                productOrderId: "po-1",
                deliveryMethod: "DELIVERY",
                deliveryCompanyCode: "CJGLS",
                trackingNumber: "1234567890",
                dispatchDate: "2026-07-10T12:00:00+09:00",
            },
            {
                productOrderId: "po-2",
                deliveryMethod: "DIRECT_DELIVERY",
                dispatchDate: "2026-07-10T12:01:00+09:00",
            },
        ]);
        expect(dispatch.outcome).toBe("success");
        expect(JSON.parse(String(mock.requests[3].init?.body))).toEqual({
            dispatchProductOrders: [
                {
                    productOrderId: "po-1",
                    deliveryMethod: "DELIVERY",
                    deliveryCompanyCode: "CJGLS",
                    trackingNumber: "1234567890",
                    dispatchDate: "2026-07-10T12:00:00+09:00",
                },
                {
                    productOrderId: "po-2",
                    deliveryMethod: "DIRECT_DELIVERY",
                    dispatchDate: "2026-07-10T12:01:00+09:00",
                },
            ],
        });
    });

    it("30건 초과 발주 요청은 네트워크 호출 전에 거부한다", async () => {
        const mock = queuedFetch([]);
        const client = new NaverCommerceClient({
            credentials,
            signer,
            fetch: mock.fetch,
        });
        const ids = Array.from(
            { length: NAVER_CONFIRM_MAX_BATCH_SIZE + 1 },
            (_, index) => `po-${index}`,
        );

        const result = await client.confirmProductOrders(ids);

        expect(result.outcome).toBe("failure");
        if (result.outcome !== "failure") return;
        expect(result.error.kind).toBe("validation");
        expect(mock.requests).toHaveLength(0);
    });

    it("submits the official single-item seller-cancel contract and parses common results", async () => {
        const mock = queuedFetch([
            tokenResponse(),
            jsonResponse({
                traceId: "cancel-trace",
                data: {
                    successProductOrderIds: ["po-1"],
                    failProductOrderInfos: [],
                },
            }),
        ]);
        const client = new NaverCommerceClient({
            credentials,
            signer,
            fetch: mock.fetch,
            now: () => fixedNow,
        });

        const result = await client.requestCancelProductOrder("po-1", {
            cancelReason: "SOLD_OUT",
            cancelDetailedReason: "Supplier stock is unavailable.",
            cancelQuantity: 2,
        });

        expect(result.outcome).toBe("success");
        if (result.outcome !== "success") return;
        expect(result.data).toEqual({
            succeededProductOrderIds: ["po-1"],
            failedProductOrders: [],
        });
        expect(mock.requests[1].url).toBe(
            "https://api.commerce.naver.com/external/v1/pay-order/seller/product-orders/po-1/claim/cancel/request",
        );
        expect(JSON.parse(String(mock.requests[1].init?.body))).toEqual({
            cancelReason: "SOLD_OUT",
            cancelDetailedReason: "Supplier stock is unavailable.",
            cancelQuantity: 2,
        });
    });

    it("fails seller cancellation before auth when the request is invalid", async () => {
        const mock = queuedFetch([]);
        const client = new NaverCommerceClient({
            credentials,
            signer,
            fetch: mock.fetch,
        });

        const result = await client.requestCancelProductOrder("po-1", {
            cancelReason: "NOT_A_NAVER_REASON" as never,
            cancelQuantity: 0,
        });

        expect(result.outcome).toBe("failure");
        expect(mock.requests).toHaveLength(0);
    });

    it("클레임 API는 구현 전 capability로만 안전하게 선언한다", () => {
        expect(NAVER_COMMERCE_CAPABILITIES.claims.cancellation.request)
            .toMatchObject({ implemented: true, status: "REQUIRES_ACCOUNT_UAT" });
        expect(NAVER_COMMERCE_CAPABILITIES.claims.return.approve.endpoint)
            .toContain("/claim/return/approve");
        expect(NAVER_COMMERCE_CAPABILITIES.claims.exchange.redispatch.endpoint)
            .toContain("/claim/exchange/dispatch");
        expect(
            NAVER_COMMERCE_CAPABILITIES.fulfillment.deliveryMethods.DIRECT_DELIVERY,
        ).toBe("REQUIRES_ACCOUNT_UAT");
    });
});
