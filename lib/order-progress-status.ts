import { SOURCING_REFUND_STATUS_LABELS } from "@/lib/sourcing-refund";
import { resolveSourcingProgressStage } from "@/lib/sourcing-progress";
import type { Order, SourcingProgressStage } from "@/types/order";

const SOURCING_PROGRESS_LABELS: Record<SourcingProgressStage, string> = {
    MATCH_REQUIRED: "소싱필요",
    MATCH_PENDING_REVIEW: "소싱필요",
    MATCHED: "매칭완료",
    PAYMENT_WAITING: "결제대기",
    EXTERNAL_PURCHASE: "결제완료",
    SOURCED: "결제완료",
    CHINA_SHIPPING: "중국배송중",
    CUSTOMS_CLEARANCE: "통관 중",
    DOMESTIC_SHIPPING: "국내 배송중",
    DELIVERED: "배송완료",
};

export type OrderProgressProjection = Pick<
    Order,
    "status" | "sourcingProgressStage" | "sourcingLifeSyncStatus" | "sourcingLifeOrderId" | "marketOrderStatus" | "sourcingRefund"
>;

export function getOrderProgressLabel(order: OrderProgressProjection): string {
    if (order.sourcingRefund) return SOURCING_REFUND_STATUS_LABELS[order.sourcingRefund.status];
    if (order.status === "DELIVERED" && order.marketOrderStatus === "PURCHASE_DECIDED") return "구매확정";
    if (order.status === "DELIVERED") return "배송완료";

    return SOURCING_PROGRESS_LABELS[resolveSourcingProgressStage(order)];
}
