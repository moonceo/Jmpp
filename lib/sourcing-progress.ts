import type { Order, SourcingProgressStage } from "@/types/order";

export type SourcingProgressProjection = Partial<Pick<
    Order,
    "sourcingProgressStage" | "sourcingLifeSyncStatus" | "sourcingLifeOrderId"
>>;

export interface SourcingProgressViewMeta {
    stage: SourcingProgressStage;
    label: string;
    actionLabel: string;
    title: string;
    description: string;
}

export type DeliveryProgressStage = Extract<
    SourcingProgressStage,
    "CHINA_SHIPPING" | "CUSTOMS_CLEARANCE" | "DOMESTIC_SHIPPING"
>;

export interface DeliveryProgressStep {
    stage: DeliveryProgressStage;
    label: string;
}

export interface DeliveryProgressViewMeta {
    stage: DeliveryProgressStage;
    label: string;
    title: string;
    description: string;
    currentStepIndex: number;
}

export const DELIVERY_PROGRESS_STEPS: readonly DeliveryProgressStep[] = [
    { stage: "CHINA_SHIPPING", label: "중국배송" },
    { stage: "CUSTOMS_CLEARANCE", label: "통관" },
    { stage: "DOMESTIC_SHIPPING", label: "국내배송" },
];

const DELIVERY_PROGRESS_VIEW_META: Record<DeliveryProgressStage, Omit<DeliveryProgressViewMeta, "stage" | "currentStepIndex">> = {
    CHINA_SHIPPING: {
        label: "중국배송중",
        title: "상품이 중국에서 배송 중입니다",
        description: "중국 현지 배송이 진행 중입니다. 통관이 시작되면 다음 단계로 자동 갱신됩니다.",
    },
    CUSTOMS_CLEARANCE: {
        label: "통관 중",
        title: "상품이 통관 절차를 진행 중입니다",
        description: "수입 통관이 진행 중입니다. 통관을 마치고 국내 택배사에 인계되면 다음 단계로 이동합니다.",
    },
    DOMESTIC_SHIPPING: {
        label: "국내 배송중",
        title: "상품이 국내에서 배송 중입니다",
        description: "통관을 마친 상품이 국내 택배사를 통해 수령인에게 배송되고 있습니다.",
    },
};

const PROGRESS_VIEW_META: Partial<Record<SourcingProgressStage, Omit<SourcingProgressViewMeta, "stage">>> = {
    PAYMENT_WAITING: {
        label: "결제대기",
        actionLabel: "결제하기",
        title: "구매대행 신청이 접수되었습니다",
        description: "상품 가격, 재고와 중국 내 배송 조건을 중국 판매자에게 확인한 뒤 결제를 진행하세요.",
    },
    SOURCED: {
        label: "결제완료",
        actionLabel: "소싱상품관리",
        title: "소싱라이프 결제가 완료되었습니다",
        description: "결제 정보를 확인하고 상품 준비와 중국 내 발송에 관한 판매자 채팅을 이어갈 수 있습니다.",
    },
    CHINA_SHIPPING: {
        label: "중국배송중",
        actionLabel: "소싱상품관리",
        title: "결제한 상품이 중국에서 배송 중입니다",
        description: "결제 상품과 주문 정보를 확인하고 중국 판매자와 배송·반품·환불 관련 대화를 이어갈 수 있습니다.",
    },
    CUSTOMS_CLEARANCE: {
        label: "통관 중",
        actionLabel: "소싱상품관리",
        title: "결제한 상품이 통관 중입니다",
        description: "결제 상품과 주문 정보를 확인하고 중국 판매자 채팅 내역을 계속 관리할 수 있습니다.",
    },
    DOMESTIC_SHIPPING: {
        label: "국내 배송중",
        actionLabel: "소싱상품관리",
        title: "결제한 상품이 국내 배송 중입니다",
        description: "결제 상품과 주문 정보를 확인하고 중국 판매자 채팅 내역을 계속 관리할 수 있습니다.",
    },
    DELIVERED: {
        label: "배송완료",
        actionLabel: "소싱상품관리",
        title: "배송이 완료되었습니다",
        description: "완료된 주문의 상품·결제·배송 정보와 중국 판매자 채팅 내역을 확인합니다.",
    },
};

export function resolveSourcingProgressStage(order: SourcingProgressProjection): SourcingProgressStage {
    if (order.sourcingProgressStage) return order.sourcingProgressStage;
    if (order.sourcingLifeSyncStatus === "INVOICE_RECEIVED") return "SOURCED";
    if (order.sourcingLifeOrderId || order.sourcingLifeSyncStatus === "PAID") return "SOURCED";
    if (order.sourcingLifeSyncStatus === "PAYMENT_READY") return "PAYMENT_WAITING";
    if (order.sourcingLifeSyncStatus === "MATCH_SAVED") return "MATCHED";
    return "MATCH_REQUIRED";
}

export function getSourcingProgressViewMeta(order: SourcingProgressProjection): SourcingProgressViewMeta | undefined {
    const stage = resolveSourcingProgressStage(order);
    const meta = PROGRESS_VIEW_META[stage];
    return meta ? { stage, ...meta } : undefined;
}

export function getDeliveryProgressViewMeta(order: SourcingProgressProjection): DeliveryProgressViewMeta | undefined {
    const stage = resolveSourcingProgressStage(order);
    if (!(stage in DELIVERY_PROGRESS_VIEW_META)) return undefined;

    const deliveryStage = stage as DeliveryProgressStage;
    return {
        stage: deliveryStage,
        ...DELIVERY_PROGRESS_VIEW_META[deliveryStage],
        currentStepIndex: DELIVERY_PROGRESS_STEPS.findIndex((step) => step.stage === deliveryStage),
    };
}

export function canViewSourcingProgress(order: SourcingProgressProjection): boolean {
    return Boolean(getSourcingProgressViewMeta(order));
}

const COMPLETED_PURCHASE_STAGES = new Set<SourcingProgressStage>([
    "EXTERNAL_PURCHASE",
    "SOURCED",
    "CHINA_SHIPPING",
    "CUSTOMS_CLEARANCE",
    "DOMESTIC_SHIPPING",
    "DELIVERED",
]);

export function hasCompletedSourcingPurchase(order: SourcingProgressProjection): boolean {
    const stage = resolveSourcingProgressStage(order);
    return COMPLETED_PURCHASE_STAGES.has(stage)
        || order.sourcingLifeSyncStatus === "PAID"
        || order.sourcingLifeSyncStatus === "INVOICE_RECEIVED"
        || Boolean(order.sourcingLifeOrderId);
}
