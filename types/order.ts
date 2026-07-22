export type OrderStatus =
    | "NEW"
    | "PREPARING"
    | "READY_TO_SHIP"
    | "SHIPPING"
    | "DELIVERED"
    | "CANCELED"
    | "ON_HOLD"
    | "CLAIM";

export type ClaimType = "CANCEL" | "RETURN" | "EXCHANGE";

export type MarketType = "naver" | "coupang" | "11st" | "gmarket" | "auction";

export type SourcingLifeSyncStatus =
    | "NOT_LINKED"
    | "MATCHING"
    | "MATCH_SAVED"
    | "PAYMENT_READY"
    | "PAID"
    | "INVOICE_RECEIVED"
    | "HOLD";

export type SourcingProgressStage =
    | "MATCH_REQUIRED"
    | "MATCH_PENDING_REVIEW"
    | "MATCHED"
    | "PAYMENT_WAITING"
    | "EXTERNAL_PURCHASE"
    | "SOURCED"
    | "CHINA_SHIPPING"
    | "CUSTOMS_CLEARANCE"
    | "DOMESTIC_SHIPPING"
    | "DELIVERED";

export type DeliveryMethod = "DELIVERY" | "DIRECT_DELIVERY";
export type MarketOrderStatus = "PAYED" | "CANCEL_REQUESTED" | "DELIVERING" | "DELIVERED" | "PURCHASE_DECIDED";

export interface Recipient {
    name: string;
    phone: string;
    address: string;
    zipCode?: string;
    detailAddress?: string;
    personalCustomsCode?: string;
    deliveryMessage?: string;
}

export interface OrderProduct {
    id: string;
    productOrderId?: string;
    name: string;
    thumbnail: string;
    optionName: string;
    quantity: number;
    unitPrice: number;
    marketLink?: string;
}

export interface SourcingLifeMatch {
    candidateId?: string;
    optionId?: string;
    productId?: string;
    productName?: string;
    thumbnail?: string;
    matchRate?: number;
    optionName?: string;
    quantity?: number;
    estimatedCost?: number;
    paymentUrl?: string;
}

export interface SourcingForwarderSelection {
    code: string;
    name: string;
    receiverName: string;
    phone: string;
    address: string;
}

export interface Order {
    id: string;
    marketOrderId: string;
    marketType: MarketType;
    storeName: string;
    orderDate: string;
    marketPaidAt?: string;
    status: OrderStatus;

    buyerName: string;
    buyerId?: string;
    buyerPhone: string;
    recipient: Recipient;
    product: OrderProduct;

    paymentPrice: number;
    platformFee: number;
    expectedSettlement: number;
    expectedCost?: number;

    sourcingLifeSyncStatus: SourcingLifeSyncStatus;
    marketOrderStatus?: MarketOrderStatus;
    marketPurchaseConfirmedAt?: string;
    marketDeliveryMethod?: DeliveryMethod;
    sourcingProgressStage?: SourcingProgressStage;
    sourcingLifeOrderId?: string;
    sourcingLifeSyncedAt?: string;
    sourcingLifeActualPayment?: {
        amount: number;
        currency: "KRW";
        paidAt: string;
    };
    sourcingLifeMatch?: SourcingLifeMatch;
    sourcingForwarder?: SourcingForwarderSelection;
    sourcingPaymentRequestedAt?: string;
    domesticInvoice?: {
        carrier: string;
        trackingNumber: string;
        receivedAt: string;
        uploadedToMarketAt?: string;
        source?: "sourcing_life" | "manual";
        uploadMode?: "auto" | "manual";
    };
    claimReason?: string;
    failureReason?: string;
    claimType?: ClaimType;
    claimRequestedAt?: string;
    claimStatus?: string;
    claimProcessedAt?: string;
    sellerCancelReason?: string;
    sellerCanceledAt?: string;
    previousStatus?: Exclude<OrderStatus, "CLAIM" | "CANCELED">;
    dataSource?: "demo" | "api";
    version?: string;
    marketAccountId?: string;
}
