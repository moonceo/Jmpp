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

const PROGRESS_VIEW_META: Partial<Record<SourcingProgressStage, Omit<SourcingProgressViewMeta, "stage">>> = {
    PAYMENT_WAITING: {
        label: "결제대기",
        actionLabel: "결제하기",
        title: "구매대행 신청이 접수되었습니다",
        description: "견적과 배송 조건을 채팅으로 확인한 뒤 결제를 진행하세요.",
    },
    SOURCED: {
        label: "결제완료",
        actionLabel: "결제완료 보기",
        title: "소싱라이프 결제가 완료되었습니다",
        description: "결제 정보와 이후 배송 진행상황을 확인하고 상담을 이어갈 수 있습니다.",
    },
    DELIVERED: {
        label: "배송완료",
        actionLabel: "배송완료 보기",
        title: "배송이 완료되었습니다",
        description: "완료된 주문의 상품·결제·배송 정보와 상담 내역을 확인합니다.",
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
