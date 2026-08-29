export type NaverOAuthResourceType = "SELF" | "SELLER";

export interface NaverCommerceCredentials {
    clientId: string;
    clientSecret: string;
    type?: NaverOAuthResourceType;
    accountId?: string;
}

export interface NaverClientSecretSignInput {
    clientId: string;
    clientSecret: string;
    timestamp: number;
}

export type NaverClientSecretSigner = (
    input: NaverClientSecretSignInput,
) => string | Promise<string>;

export interface NaverOAuthTokenResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
}

export interface NaverAccessToken {
    accessToken: string;
    tokenType: string;
    expiresInSeconds: number;
    issuedAtMs: number;
    expiresAtMs: number;
}

export type NaverLastChangedType =
    | "PAY_WAITING"
    | "PAYED"
    | "EXCHANGE_OPTION"
    | "DELIVERY_ADDRESS_CHANGED"
    | "GIFT_RECEIVED"
    | "CLAIM_REJECTED"
    | "DISPATCHED"
    | "CLAIM_REQUESTED"
    | "COLLECT_DONE"
    | "CLAIM_COMPLETED"
    | "PURCHASE_DECIDED"
    | "HOPE_DELIVERY_INFO_CHANGED"
    | "CLAIM_REDELIVERING";

export interface NaverChangedProductOrder {
    productOrderStatus: string;
    productOrderId: string;
    orderId: string;
    lastChangedDate: string;
    lastChangedType: string;
    receiverAddressChanged?: boolean;
    claimType?: string;
    claimStatus?: string;
    [key: string]: unknown;
}

export interface NaverChangedProductOrdersCursor {
    lastChangedFrom: string;
    moreSequence: string;
}

export interface NaverChangedProductOrdersQuery {
    lastChangedFrom: string;
    lastChangedTo?: string;
    lastChangedType?: NaverLastChangedType;
    cursor?: NaverChangedProductOrdersCursor;
    limitCount?: number;
}

export interface NaverChangedProductOrdersPage {
    items: readonly NaverChangedProductOrder[];
    count: number;
    cursor: NaverChangedProductOrdersCursor | null;
    hasMore: boolean;
}

export interface NaverOrderData {
    orderId?: string;
    orderDate?: string;
    paymentDate?: string;
    ordererName?: string;
    ordererTel?: string;
    [key: string]: unknown;
}

export interface NaverProductOrderData {
    productOrderId?: string;
    orderId?: string;
    productId?: string;
    productName?: string;
    productOption?: string;
    quantity?: number;
    unitPrice?: number;
    totalPaymentAmount?: number;
    deliveryFeeAmount?: number;
    productOrderStatus?: string;
    claimType?: string;
    claimStatus?: string;
    deliveryMethod?: string;
    deliveryCompany?: string;
    trackingNumber?: string;
    [key: string]: unknown;
}

export interface NaverProductOrderDetail {
    order: NaverOrderData;
    productOrder: NaverProductOrderData;
    [key: string]: unknown;
}

export interface NaverProductOrderDetails {
    items: readonly NaverProductOrderDetail[];
}

export interface NaverProductOrderDetailOptions {
    quantityClaimCompatibility?: boolean;
}

export interface NaverBatchFailure {
    productOrderId: string;
    code?: string;
    message?: string;
    retryable: boolean;
}

export interface NaverBatchOperationResult {
    succeededProductOrderIds: readonly string[];
    failedProductOrders: readonly NaverBatchFailure[];
}

export const NAVER_SELLER_CANCEL_REASONS = [
    "INTENT_CHANGED",
    "COLOR_AND_SIZE",
    "WRONG_ORDER",
    "PRODUCT_UNSATISFIED",
    "DELAYED_DELIVERY",
    "SOLD_OUT",
    "INCORRECT_INFO",
] as const;

export type NaverSellerCancelReason =
    (typeof NAVER_SELLER_CANCEL_REASONS)[number];

export interface NaverSellerCancelRequest {
    cancelReason: NaverSellerCancelReason;
    cancelDetailedReason?: string;
    cancelQuantity?: number;
}

interface NaverDispatchBase {
    productOrderId: string;
    dispatchDate: string;
}

export interface NaverParcelDispatch extends NaverDispatchBase {
    deliveryMethod: "DELIVERY";
    deliveryCompanyCode: string;
    trackingNumber: string;
}

export interface NaverDirectDeliveryDispatch extends NaverDispatchBase {
    deliveryMethod: "DIRECT_DELIVERY";
    deliveryCompanyCode?: never;
    trackingNumber?: never;
}

export type NaverDispatchProductOrder =
    | NaverParcelDispatch
    | NaverDirectDeliveryDispatch;
