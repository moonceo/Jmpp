export type OrderStatus =
    | "NEW"
    | "PREPARING"
    | "READY_TO_SHIP"
    | "SHIPPING"
    | "DELIVERED"
    | "CANCELED"
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
    sourcingLifeOrderId?: string;
    sourcingLifeSyncedAt?: string;
    sourcingLifeActualPayment?: {
        amount: number;
        currency: "KRW";
        paidAt: string;
    };
    sourcingLifeMatch?: SourcingLifeMatch;
    domesticInvoice?: {
        carrier: string;
        trackingNumber: string;
        receivedAt: string;
        uploadedToMarketAt?: string;
        source?: "sourcing_life" | "manual";
        uploadMode?: "auto" | "manual";
        changedCarrier?: string;
        changedTrackingNumber?: string;
        changedAt?: string;
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
}
