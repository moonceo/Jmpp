import { hasCompletedSourcingPurchase, resolveSourcingProgressStage } from "@/lib/sourcing-progress";
import type {
    Order,
    SourcingRefund,
    SourcingRefundDraft,
    SourcingRefundGoodsStatus,
    SourcingRefundStatus,
    SourcingRefundType,
} from "@/types/order";

export const SOURCING_REFUND_STATUS_LABELS: Record<SourcingRefundStatus, string> = {
    REQUESTED: "소싱환불 승인대기",
    PROVIDER_REVIEW: "소싱환불 승인대기",
    RETURN_REQUIRED: "소싱반품 송장필요",
    RETURN_IN_TRANSIT: "소싱반품 배송중",
    REFUND_PENDING: "소싱환불 처리중",
    REFUNDED: "소싱환불 완료",
    REJECTED: "소싱환불 거절",
    RECONCILIATION_REQUIRED: "소싱환불 확인필요",
};

export const SOURCING_REFUND_TYPE_LABELS: Record<SourcingRefundType, string> = {
    REFUND_ONLY: "환불만",
    RETURN_AND_REFUND: "반품 후 환불",
};

export const SOURCING_REFUND_GOODS_STATUS_LABELS: Record<SourcingRefundGoodsStatus, string> = {
    NOT_SHIPPED: "미발송",
    SHIPPED: "판매자 발송",
    NOT_RECEIVED: "상품 미수령",
    RECEIVED: "상품 수령",
    SENT_BACK: "판매자에게 반송",
    SELLER_RECEIVED: "판매자 반품 수령",
};

export const TAOWORLD_REFUND_TYPE_CODES: Record<SourcingRefundType, 1 | 2> = {
    REFUND_ONLY: 1,
    RETURN_AND_REFUND: 2,
};

export const TAOWORLD_GOODS_STATUS_CODES: Record<SourcingRefundGoodsStatus, 1 | 2 | 3 | 4 | 5 | 6> = {
    NOT_SHIPPED: 1,
    SHIPPED: 2,
    NOT_RECEIVED: 3,
    RECEIVED: 4,
    SENT_BACK: 5,
    SELLER_RECEIVED: 6,
};

export interface TaoWorldRefundReasonOption {
    reasonId: string;
    reasonLabel: string;
}

export interface TaoWorldRefundRenderResult {
    purchaseOrderLineId: string;
    refundType: 1 | 2;
    goodsStatus: 1 | 2 | 3 | 4 | 5 | 6;
    reasons: TaoWorldRefundReasonOption[];
    currency: "CNY";
    maxRefundFeeCny: number;
    canEditRefundFee: boolean;
    source: "TAOWORLD_RENDER_DEMO";
}

export interface SourcingReturnLogisticsDraft {
    companyCode: string;
    companyName: string;
    trackingNumber: string;
    buyerPhone: string;
    description?: string;
}

export const TAOWORLD_RETURN_LOGISTICS_OPTIONS = [
    { code: "SF", name: "顺丰速运(SF Express)" },
    { code: "ZTO", name: "中通快递(ZTO)" },
    { code: "YTO", name: "圆通速递(YTO)" },
] as const;

export const ACTIVE_SOURCING_REFUND_STATUSES = new Set<SourcingRefundStatus>([
    "REQUESTED",
    "PROVIDER_REVIEW",
    "RETURN_REQUIRED",
    "RETURN_IN_TRANSIT",
    "REFUND_PENDING",
    "RECONCILIATION_REQUIRED",
]);

export interface SourcingRefundAvailability {
    canOpen: boolean;
    canRequest: boolean;
    reason?: string;
}

const REFUNDABLE_PURCHASE_STAGES = new Set([
    "SOURCED",
    "CHINA_SHIPPING",
    "CUSTOMS_CLEARANCE",
    "DOMESTIC_SHIPPING",
]);

type RefundOrderProjection = Partial<Pick<
    Order,
    | "sourcingLifeOrderId"
    | "sourcingLifeSyncStatus"
    | "sourcingProgressStage"
    | "sourcingRefund"
    | "taoWorldPurchase"
>>;

export function getSourcingRefundAvailability(order: RefundOrderProjection): SourcingRefundAvailability {
    if (order.sourcingRefund) return { canOpen: true, canRequest: false };
    if (resolveSourcingProgressStage(order) === "EXTERNAL_PURCHASE") {
        return {
            canOpen: false,
            canRequest: false,
            reason: "외부에서 직접 구매한 상품은 해당 구매처에서 환불해야 합니다.",
        };
    }
    const refundableStage = REFUNDABLE_PURCHASE_STAGES.has(resolveSourcingProgressStage(order));
    if (!order.sourcingLifeOrderId || !refundableStage || !hasCompletedSourcingPurchase(order)) {
        return {
            canOpen: false,
            canRequest: false,
            reason: "소싱 결제완료부터 배송완료 전까지 반품·환불을 신청할 수 있습니다.",
        };
    }
    if (!order.taoWorldPurchase?.purchaseOrderLineId) {
        return {
            canOpen: false,
            canRequest: false,
            reason: "TaoWorld 구매 주문라인이 연결된 상품만 API형 환불 프로토타입을 사용할 수 있습니다.",
        };
    }
    return { canOpen: true, canRequest: true };
}

export function isSourcingRefundActive(refund?: Pick<SourcingRefund, "status">): boolean {
    return Boolean(refund && ACTIVE_SOURCING_REFUND_STATUSES.has(refund.status));
}

export function canRestartSourcingAfterRefund(order: Pick<
    Order,
    "status" | "marketOrderStatus" | "sourcingRefund"
>): boolean {
    const marketDeliveryStarted = order.marketOrderStatus === "DELIVERING"
        || order.marketOrderStatus === "DELIVERED"
        || order.marketOrderStatus === "PURCHASE_DECIDED";

    return order.sourcingRefund?.status === "REFUNDED"
        && (order.status === "PREPARING" || order.status === "READY_TO_SHIP" || order.status === "SHIPPING")
        && !marketDeliveryStarted;
}

export function prepareOrderForResourcingAfterRefund(order: Order): Order {
    if (!canRestartSourcingAfterRefund(order) || !order.sourcingRefund) {
        throw new Error("환불 완료 후 국내배송이 시작되지 않은 주문만 다시 소싱할 수 있습니다.");
    }

    return {
        ...order,
        status: "PREPARING",
        sourcingLifeSyncStatus: "NOT_LINKED",
        sourcingProgressStage: "MATCH_REQUIRED",
        sourcingLifeOrderId: undefined,
        sourcingLifeSyncedAt: undefined,
        sourcingLifeActualPayment: undefined,
        taoWorldPurchase: undefined,
        sourcingRefund: undefined,
        sourcingRefundHistory: [
            ...(order.sourcingRefundHistory ?? []),
            order.sourcingRefund,
        ],
        sourcingLifeMatch: undefined,
        sourcingForwarder: undefined,
        sourcingPaymentRequestedAt: undefined,
        domesticInvoice: undefined,
        chinaInvoice: undefined,
    };
}

export function recommendedSourcingRefundType(order: RefundOrderProjection): SourcingRefundType {
    const stage = resolveSourcingProgressStage(order);
    return stage === "SOURCED" ? "REFUND_ONLY" : "RETURN_AND_REFUND";
}

export function recommendedSourcingRefundGoodsStatus(order: RefundOrderProjection): SourcingRefundGoodsStatus {
    const stage = resolveSourcingProgressStage(order);
    if (stage === "SOURCED") return "NOT_SHIPPED";
    if (stage === "CHINA_SHIPPING") return "SHIPPED";
    if (stage === "CUSTOMS_CLEARANCE" || stage === "DOMESTIC_SHIPPING" || stage === "DELIVERED") return "RECEIVED";
    return "NOT_RECEIVED";
}

export function renderTaoWorldRefundOrder(
    order: Pick<Order, "taoWorldPurchase">,
    type: SourcingRefundType,
    goodsStatus: SourcingRefundGoodsStatus,
): TaoWorldRefundRenderResult | undefined {
    const purchase = order.taoWorldPurchase;
    if (!purchase) return undefined;

    const reasons: TaoWorldRefundReasonOption[] = [
        { reasonId: "403769", reasonLabel: "더 이상 원하지 않음" },
    ];
    if (goodsStatus === "NOT_SHIPPED") {
        reasons.push({ reasonId: "403529", reasonLabel: "판매자 품절" });
    }
    if (type === "RETURN_AND_REFUND") {
        reasons.push(
            { reasonId: "990001", reasonLabel: "상품 파손·기능 불량 (데모 render 응답)" },
            { reasonId: "990002", reasonLabel: "오배송·옵션 불일치 (데모 render 응답)" },
        );
    }

    return {
        purchaseOrderLineId: purchase.purchaseOrderLineId,
        refundType: TAOWORLD_REFUND_TYPE_CODES[type],
        goodsStatus: TAOWORLD_GOODS_STATUS_CODES[goodsStatus],
        reasons,
        currency: "CNY",
        maxRefundFeeCny: purchase.paidAmountCny,
        canEditRefundFee: true,
        source: "TAOWORLD_RENDER_DEMO",
    };
}

export function validateSourcingRefundDraft(
    order: Pick<Order, "taoWorldPurchase">,
    draft: SourcingRefundDraft,
): string | undefined {
    const rendered = renderTaoWorldRefundOrder(order, draft.type, draft.goodsStatus);
    if (!rendered) return "TaoWorld 구매 주문라인 정보가 없습니다.";
    if (draft.purchaseOrderLineId !== rendered.purchaseOrderLineId) {
        return "환불 대상 구매 주문라인이 최신 TaoWorld 조회 결과와 일치하지 않습니다.";
    }
    if (!rendered.reasons.some((reason) => reason.reasonId === draft.reasonId)) {
        return "TaoWorld render 응답에서 제공된 환불 사유를 선택하세요.";
    }
    if (!Number.isFinite(draft.refundFeeCny) || draft.refundFeeCny <= 0) {
        return "환불 요청금액(CNY)을 입력하세요.";
    }
    if (draft.refundFeeCny > rendered.maxRefundFeeCny) {
        return `환불 요청금액은 TaoWorld 최대 가능금액 ¥${rendered.maxRefundFeeCny.toFixed(2)}를 초과할 수 없습니다.`;
    }
    if (draft.refundImageUrls && draft.refundImageUrls.length > 3) {
        return "환불 증빙 이미지는 최대 3개까지 등록할 수 있습니다.";
    }
    return undefined;
}

export function createSourcingRefundRequest(
    order: Pick<Order, "id" | "taoWorldPurchase" | "sourcingLifeActualPayment">,
    draft: SourcingRefundDraft,
    requestedAt = new Date().toISOString(),
): SourcingRefund {
    const error = validateSourcingRefundDraft(order, draft);
    if (error) throw new Error(error);
    const purchase = order.taoWorldPurchase;
    if (!purchase) throw new Error("TaoWorld 구매 주문라인 정보가 없습니다.");
    const krwPerCny = order.sourcingLifeActualPayment?.amount
        ? order.sourcingLifeActualPayment.amount / purchase.paidAmountCny
        : undefined;
    const timestampDigits = requestedAt.replace(/\D/g, "").slice(0, 14);

    return {
        ...draft,
        refundDescription: draft.refundDescription?.trim() || undefined,
        refundImageUrls: draft.refundImageUrls?.filter(Boolean),
        marketClaimId: draft.marketClaimId?.trim() || undefined,
        id: `SR-${order.id}-${timestampDigits}`,
        providerRefundId: `1100${timestampDigits.slice(-8)}`,
        providerPurchaseOrderId: purchase.purchaseOrderId,
        providerPayOrderId: purchase.payOrderId,
        providerStatusCode: 10,
        status: "REQUESTED",
        requestedAt,
        updatedAt: requestedAt,
        approvedRefundFeeCny: draft.refundFeeCny,
        estimatedRefundKrw: krwPerCny ? Math.round(draft.refundFeeCny * krwPerCny) : undefined,
        estimatedDeductionKrw: 0,
        providerMessage: "TaoWorld submit 데모 응답을 저장했습니다. 다음 상태는 message_type=9 수신 후 query 결과로 갱신합니다.",
    };
}

export function advanceDemoSourcingRefund(refund: SourcingRefund, updatedAt = new Date().toISOString()): SourcingRefund {
    if (refund.status === "REQUESTED") {
        return { ...refund, status: "PROVIDER_REVIEW", providerStatusCode: 10, updatedAt, providerMessage: "중국 판매자의 환불 동의를 기다리고 있습니다." };
    }
    if (refund.status === "PROVIDER_REVIEW") {
        return refund.type === "RETURN_AND_REFUND"
            ? { ...refund, status: "RETURN_REQUIRED", providerStatusCode: 20, updatedAt, providerMessage: "판매자가 반품에 동의했습니다. TaoWorld 반품 택배사와 송장을 등록하세요." }
            : { ...refund, status: "REFUND_PENDING", providerStatusCode: 90, updatedAt, providerMessage: "판매자가 환불에 동의했습니다. TaoWorld 환불 완료를 대기합니다." };
    }
    if (refund.status === "RETURN_IN_TRANSIT") {
        return { ...refund, status: "REFUND_PENDING", providerStatusCode: 90, updatedAt, providerMessage: "판매자가 반품 상품을 확인했습니다. 환불 완료를 대기합니다." };
    }
    if (refund.status === "REFUND_PENDING") {
        return { ...refund, status: "REFUNDED", providerStatusCode: 100, updatedAt, providerMessage: "TaoWorld query에서 환불 완료를 확인했습니다." };
    }
    return refund;
}

export function submitDemoReturnLogistics(
    refund: SourcingRefund,
    draft: SourcingReturnLogisticsDraft,
    submittedAt = new Date().toISOString(),
): SourcingRefund {
    if (refund.status !== "RETURN_REQUIRED") throw new Error("현재 상태에서는 반품 송장을 등록할 수 없습니다.");
    if (!draft.companyCode || !draft.companyName || !draft.trackingNumber.trim() || !draft.buyerPhone.trim()) {
        throw new Error("반품 택배사, 송장번호, 반품자 전화번호를 모두 입력하세요.");
    }
    return {
        ...refund,
        goodsStatus: "SENT_BACK",
        status: "RETURN_IN_TRANSIT",
        providerStatusCode: 30,
        updatedAt: submittedAt,
        returnLogistics: {
            ...draft,
            trackingNumber: draft.trackingNumber.trim(),
            buyerPhone: draft.buyerPhone.trim(),
            description: draft.description?.trim() || undefined,
            submittedAt,
        },
        providerMessage: "TaoWorld submit/logistics 데모 응답을 저장했습니다. 판매자 수령 상태를 기다립니다.",
    };
}
