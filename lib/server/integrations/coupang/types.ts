export const COUPANG_ORDER_STATUSES = [
    "ACCEPT",
    "INSTRUCT",
    "DEPARTURE",
    "DELIVERING",
    "FINAL_DELIVERY",
    "NONE_TRACKING",
] as const;

export type CoupangOrderStatus = (typeof COUPANG_ORDER_STATUSES)[number];

export interface CoupangCredentials {
    vendorId: string;
    accessKey: string;
    secretKey: string;
}

export interface CoupangSignedRequest {
    authorization: string;
    canonicalMessage: string;
    datetime: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    query: string;
    signature: string;
}

export interface CoupangOrderSheetsByMinuteQuery {
    createdAtFrom: string;
    createdAtTo: string;
    status: CoupangOrderStatus;
}

export interface CoupangOrderItem {
    vendorItemId: string;
    vendorItemName: string;
    shippingCount: number;
    sellerProductId?: string;
    sellerProductName?: string;
    sellerProductItemName?: string;
    vendorItemPackageId?: string;
    productId?: string;
    externalVendorSkuCode?: string;
    [key: string]: unknown;
}

export interface CoupangOrderSheet {
    shipmentBoxId: string;
    orderId: string;
    orderedAt: string;
    paidAt?: string;
    status: CoupangOrderStatus;
    orderItems: readonly CoupangOrderItem[];
    orderer?: Record<string, unknown>;
    receiver?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface CoupangOrderSheetsPage {
    items: readonly CoupangOrderSheet[];
}

export interface CoupangOrderSheetDetail {
    item: CoupangOrderSheet;
}

export interface CoupangOrderReadVerification {
    vendorId: string;
    checkedAt: string;
    endpoint: "ORDER_SHEETS_BY_MINUTE";
    status: "ACCESS_VERIFIED";
    sampledOrderCount: number;
}
