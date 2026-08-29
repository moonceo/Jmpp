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

export type SourcingRefundType = "REFUND_ONLY" | "RETURN_AND_REFUND";

export type SourcingRefundGoodsStatus =
    | "NOT_SHIPPED"
    | "SHIPPED"
    | "NOT_RECEIVED"
    | "RECEIVED"
    | "SENT_BACK"
    | "SELLER_RECEIVED";

export type SourcingRefundStatus =
    | "REQUESTED"
    | "PROVIDER_REVIEW"
    | "RETURN_REQUIRED"
    | "RETURN_IN_TRANSIT"
    | "REFUND_PENDING"
    | "REFUNDED"
    | "REJECTED"
    | "RECONCILIATION_REQUIRED";

export interface SourcingRefundDraft {
    purchaseOrderLineId: string;
    type: SourcingRefundType;
    goodsStatus: SourcingRefundGoodsStatus;
    reasonId: string;
    reasonLabel: string;
    refundFeeCny: number;
    currency: "CNY";
    refundDescription?: string;
    refundImageUrls?: string[];
    marketClaimId?: string;
}

export interface SourcingRefund extends SourcingRefundDraft {
    id: string;
    providerRefundId: string;
    providerPurchaseOrderId: string;
    providerPayOrderId?: string;
    providerStatusCode: number;
    status: SourcingRefundStatus;
    requestedAt: string;
    updatedAt: string;
    approvedRefundFeeCny?: number;
    estimatedRefundKrw?: number;
    estimatedDeductionKrw?: number;
    providerMessage?: string;
    returnLogistics?: {
        companyCode: string;
        companyName: string;
        trackingNumber: string;
        buyerPhone: string;
        description?: string;
        submittedAt: string;
    };
}

export type DeliveryMethod = "DELIVERY" | "DIRECT_DELIVERY" | "OVERSEAS_OTHER_DELIVERY";
export type MarketOrderStatus = "PAYED" | "CANCEL_REQUESTED" | "DELIVERING" | "DELIVERED" | "PURCHASE_DECIDED";

export type DeliveryHistoryFlow = "OUTBOUND" | "RETURN" | "EXCHANGE";

export interface DeliveryHistoryEvent {
    id: string;
    flow: DeliveryHistoryFlow;
    label: string;
    description?: string;
    occurredAt?: string;
    location?: string;
    carrier?: string;
    trackingNumber?: string;
}

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

export interface TaoWorldPurchaseReference {
    distributorId: string;
    purchaseOrderId: string;
    purchaseOrderLineId: string;
    payOrderId?: string;
    currency: "CNY";
    paidAmountCny: number;
    paidAt: string;
}

export interface Order {
    id: string;
    marketOrderId: string;
    marketType: MarketType;
    storeName: string;
    orderDate: string;
    marketPaidAt?: string;
    orderAcceptedAt?: string;
    status: OrderStatus;

    buyerName: string;
    buyerId?: string;
    buyerPhone: string;
    recipient: Recipient;
    product: OrderProduct;

    paymentPrice: number;
    paymentShippingFee?: number;
    platformFee: number;
    expectedSettlement: number;
    expectedCost?: number;

    sourcingLifeSyncStatus: SourcingLifeSyncStatus;
    marketOrderStatus?: MarketOrderStatus;
    marketPurchaseConfirmedAt?: string;
    marketDeliveryMethod?: DeliveryMethod;
    marketShippingReference?: {
        carrier: string;
        trackingNumber: string;
        registeredAt: string;
    };
    shippingProcessStarted?: boolean;
    sourcingProgressStage?: SourcingProgressStage;
    sourcingLifeOrderId?: string;
    sourcingLifeSyncedAt?: string;
    sourcingMatchedAt?: string;
    sourcingLifeActualPayment?: {
        amount: number;
        currency: "KRW";
        paidAt: string;
    };
    taoWorldPurchase?: TaoWorldPurchaseReference;
    sourcingRefund?: SourcingRefund;
    sourcingRefundHistory?: SourcingRefund[];
    sourcingLifeMatch?: SourcingLifeMatch;
    sourcingForwarder?: SourcingForwarderSelection;
    sourcingPaymentRequestedAt?: string;
    domesticInvoice?: {
        carrier: string;
        trackingNumber: string;
        receivedAt: string;
        uploadedToMarketAt?: string;
        source?: "sourcing_life" | "manual";
        uploadMode?: "auto" | "manual" | "crawler";
    };
    chinaInvoice?: {
        carrier: string;
        trackingNumber: string;
        receivedAt: string;
        source?: "sourcing_life" | "manual";
    };
    deliveryHistory?: DeliveryHistoryEvent[];
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
