export type NaverCapabilityStatus =
    | "READY"
    | "REQUIRES_ACCOUNT_UAT"
    | "DECLARED_NOT_IMPLEMENTED";

export interface NaverApiCapability {
    method: "GET" | "POST";
    endpoint: string;
    implemented: boolean;
    status: NaverCapabilityStatus;
    maxBatchSize?: number;
}

const claimCapability = (endpoint: string): NaverApiCapability => ({
    method: "POST",
    endpoint,
    implemented: false,
    status: "DECLARED_NOT_IMPLEMENTED",
});

const accountUatCapability = (endpoint: string): NaverApiCapability => ({
    method: "POST",
    endpoint,
    implemented: true,
    status: "REQUIRES_ACCOUNT_UAT",
});

export const NAVER_COMMERCE_CAPABILITIES = {
    documentVersion: "2.82.0",
    checkedAt: "2026-07-10",
    orderCollection: {
        changedProductOrders: {
            method: "GET",
            endpoint: "/v1/pay-order/seller/product-orders/last-changed-statuses",
            implemented: true,
            status: "READY",
            maxBatchSize: 300,
        },
        productOrderDetails: {
            method: "POST",
            endpoint: "/v1/pay-order/seller/product-orders/query",
            implemented: true,
            status: "READY",
            maxBatchSize: 300,
        },
    },
    fulfillment: {
        confirm: {
            method: "POST",
            endpoint: "/v1/pay-order/seller/product-orders/confirm",
            implemented: true,
            status: "READY",
            maxBatchSize: 30,
        },
        dispatch: {
            method: "POST",
            endpoint: "/v1/pay-order/seller/product-orders/dispatch",
            implemented: true,
            status: "READY",
            maxBatchSize: 30,
        },
        deliveryMethods: {
            DELIVERY: "READY",
            DIRECT_DELIVERY: "REQUIRES_ACCOUNT_UAT",
        },
    },
    claims: {
        cancellation: {
            request: accountUatCapability(
                "/v1/pay-order/seller/product-orders/:productOrderId/claim/cancel/request",
            ),
            approve: claimCapability(
                "/v1/pay-order/seller/product-orders/:productOrderId/claim/cancel/approve",
            ),
        },
        return: {
            request: claimCapability(
                "/v1/pay-order/seller/product-orders/:productOrderId/claim/return/request",
            ),
            approve: claimCapability(
                "/v1/pay-order/seller/product-orders/:productOrderId/claim/return/approve",
            ),
            holdback: claimCapability(
                "/v1/pay-order/seller/product-orders/:productOrderId/claim/return/holdback",
            ),
            releaseHoldback: claimCapability(
                "/v1/pay-order/seller/product-orders/:productOrderId/claim/return/holdback/release",
            ),
            reject: claimCapability(
                "/v1/pay-order/seller/product-orders/:productOrderId/claim/return/reject",
            ),
        },
        exchange: {
            approveCollection: claimCapability(
                "/v1/pay-order/seller/product-orders/:productOrderId/claim/exchange/collect/approve",
            ),
            redispatch: claimCapability(
                "/v1/pay-order/seller/product-orders/:productOrderId/claim/exchange/dispatch",
            ),
            holdback: claimCapability(
                "/v1/pay-order/seller/product-orders/:productOrderId/claim/exchange/holdback",
            ),
            releaseHoldback: claimCapability(
                "/v1/pay-order/seller/product-orders/:productOrderId/claim/exchange/holdback/release",
            ),
            reject: claimCapability(
                "/v1/pay-order/seller/product-orders/:productOrderId/claim/exchange/reject",
            ),
        },
    },
} as const;
