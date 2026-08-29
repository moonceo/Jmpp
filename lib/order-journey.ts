import { hasCompletedSourcingPurchase, resolveSourcingProgressStage } from "@/lib/sourcing-progress";
import type { ClaimType, Order, OrderStatus, SourcingProgressStage, SourcingRefundStatus } from "@/types/order";

export type OrderJourneyStatus =
    | "NEW_ORDER"
    | "CUSTOMS_COLLECTING"
    | "SOURCING_ORDER_PENDING"
    | "CHINA_DISPATCH_PENDING"
    | "CHINA_SHIPPING"
    | "FORWARDER_ARRIVAL_PENDING"
    | "FORWARDER_RECEIVING"
    | "FORWARDER_PARTIAL_RECEIPT"
    | "FORWARDER_INSPECTION_PENDING"
    | "FORWARDER_RECEIVING_ERROR"
    | "FORWARDER_ESTIMATE_READY"
    | "FORWARDER_REPACKING"
    | "FORWARDER_PAYMENT_COMPLETE"
    | "FORWARDER_EXPORT_READY"
    | "FORWARDER_EXPORTED"
    | "DOMESTIC_ARRIVAL"
    | "DOMESTIC_SHIPPING"
    | "DELIVERED"
    | "PURCHASE_CONFIRMATION_PENDING"
    | "PURCHASE_CONFIRMED"
    | "SOURCING_REFUND_REQUESTED"
    | "SOURCING_REFUND_PROVIDER_REVIEW"
    | "SOURCING_RETURN_REQUIRED"
    | "SOURCING_RETURN_IN_TRANSIT"
    | "SOURCING_REFUND_PENDING"
    | "SOURCING_REFUNDED"
    | "SOURCING_REFUND_REJECTED"
    | "SOURCING_REFUND_RECONCILIATION"
    | "MARKET_RETURN"
    | "MARKET_EXCHANGE"
    | "MARKET_CANCEL"
    | "MARKET_CLAIM_COMPLETE";

export type OrderJourneyGroupId =
    | "INTAKE"
    | "CHINA"
    | "FORWARDER"
    | "DOMESTIC"
    | "SOURCING_REFUND"
    | "MARKET_CLAIM";

export interface OrderJourneyStatusDefinition {
    id: OrderJourneyStatus;
    label: string;
}

export interface OrderJourneyGroupDefinition {
    id: OrderJourneyGroupId;
    label: string;
    description: string;
    statuses: readonly OrderJourneyStatusDefinition[];
}

export const ORDER_JOURNEY_GROUPS: readonly OrderJourneyGroupDefinition[] = [
    {
        id: "INTAKE",
        label: "접수 ~ 결제",
        description: "주문 접수부터 소싱 결제까지",
        statuses: [
            { id: "NEW_ORDER", label: "신규 주문" },
            { id: "CUSTOMS_COLLECTING", label: "통관부호 수집중" },
            { id: "SOURCING_ORDER_PENDING", label: "소싱 발주 대기" },
        ],
    },
    {
        id: "CHINA",
        label: "소싱 · 중국",
        description: "중국 판매자의 발송과 배송",
        statuses: [
            { id: "CHINA_DISPATCH_PENDING", label: "현지 발송 대기" },
            { id: "CHINA_SHIPPING", label: "현지 배송중" },
            { id: "FORWARDER_ARRIVAL_PENDING", label: "도착 · 입고 전" },
        ],
    },
    {
        id: "FORWARDER",
        label: "배대지",
        description: "외부 배대지 입고부터 출고까지",
        statuses: [
            { id: "FORWARDER_RECEIVING", label: "입고 대기" },
            { id: "FORWARDER_PARTIAL_RECEIPT", label: "부분입고" },
            { id: "FORWARDER_INSPECTION_PENDING", label: "검수대기" },
            { id: "FORWARDER_RECEIVING_ERROR", label: "오류입고" },
            { id: "FORWARDER_ESTIMATE_READY", label: "견적 완료" },
            { id: "FORWARDER_REPACKING", label: "재포장 중" },
            { id: "FORWARDER_PAYMENT_COMPLETE", label: "배송비 결제 완료" },
            { id: "FORWARDER_EXPORT_READY", label: "출고 준비" },
            { id: "FORWARDER_EXPORTED", label: "출고 완료" },
        ],
    },
    {
        id: "DOMESTIC",
        label: "통관 ~ 확정",
        description: "국내 입항부터 배송·구매확정까지",
        statuses: [
            { id: "DOMESTIC_ARRIVAL", label: "국내 입항" },
            { id: "DOMESTIC_SHIPPING", label: "국내 배송중" },
            { id: "DELIVERED", label: "배송 완료" },
            { id: "PURCHASE_CONFIRMATION_PENDING", label: "구매 확정 대기" },
            { id: "PURCHASE_CONFIRMED", label: "구매 확정" },
        ],
    },
    {
        id: "SOURCING_REFUND",
        label: "소싱 환불",
        description: "소싱 구매의 환불·반품 진행",
        statuses: [
            { id: "SOURCING_REFUND_REQUESTED", label: "환불 요청" },
            { id: "SOURCING_REFUND_PROVIDER_REVIEW", label: "소싱라이프 확인 중" },
            { id: "SOURCING_RETURN_REQUIRED", label: "반품 접수 필요" },
            { id: "SOURCING_RETURN_IN_TRANSIT", label: "중국 반품 중" },
            { id: "SOURCING_REFUND_PENDING", label: "환불 정산 중" },
            { id: "SOURCING_REFUNDED", label: "환불 완료" },
            { id: "SOURCING_REFUND_REJECTED", label: "환불 거절" },
            { id: "SOURCING_REFUND_RECONCILIATION", label: "결과 확인 필요" },
        ],
    },
    {
        id: "MARKET_CLAIM",
        label: "마켓 클레임",
        description: "마켓에서 접수된 반품·교환·취소",
        statuses: [
            { id: "MARKET_RETURN", label: "반품" },
            { id: "MARKET_EXCHANGE", label: "교환" },
            { id: "MARKET_CANCEL", label: "취소" },
            { id: "MARKET_CLAIM_COMPLETE", label: "완료" },
        ],
    },
] as const;

export const ORDER_JOURNEY_STATUS_LABELS = Object.fromEntries(
    ORDER_JOURNEY_GROUPS.flatMap((group) => group.statuses.map((status) => [status.id, status.label])),
) as Record<OrderJourneyStatus, string>;

export type OrderJourneyIssueCode = "CUSTOMS" | "FAILURE" | "CLAIM" | "SOURCING_REFUND" | "MARGIN";

export interface OrderJourneyIssue {
    code: OrderJourneyIssueCode;
    label: string;
    detail: string;
}

type OrderJourneyProjection = Pick<
    Order,
    | "status"
    | "claimType"
    | "claimStatus"
    | "failureReason"
    | "recipient"
    | "expectedSettlement"
    | "expectedCost"
    | "sourcingProgressStage"
    | "sourcingLifeSyncStatus"
    | "sourcingLifeOrderId"
    | "sourcingRefund"
    | "marketOrderStatus"
>;

export function isValidPersonalCustomsCode(value?: string): boolean {
    return /^P\d{12}$/.test(value?.trim().toUpperCase() ?? "");
}

export function projectOrderJourneyStatus(order: OrderJourneyProjection): OrderJourneyStatus {
    if (order.sourcingRefund) return sourcingRefundJourneyStatus(order.sourcingRefund.status);

    if (order.status === "CLAIM") {
        if (order.claimStatus?.includes("완료")) return "MARKET_CLAIM_COMPLETE";
        return claimJourneyStatus(order.claimType);
    }

    if (order.status === "CANCELED") {
        return "MARKET_CANCEL";
    }

    if (order.status === "ON_HOLD") return "FORWARDER_RECEIVING_ERROR";

    if (order.status === "DELIVERED") {
        return order.marketOrderStatus === "PURCHASE_DECIDED"
            ? "PURCHASE_CONFIRMED"
            : "PURCHASE_CONFIRMATION_PENDING";
    }

    const sourcingStage = resolveSourcingProgressStage(order);

    if (order.status === "NEW") {
        return isValidPersonalCustomsCode(order.recipient.personalCustomsCode)
            ? "NEW_ORDER"
            : "CUSTOMS_COLLECTING";
    }

    if (order.status === "PREPARING") return "SOURCING_ORDER_PENDING";

    return progressJourneyStatus(sourcingStage, order.status);
}

export function getOrderJourneyIssue(order: OrderJourneyProjection): OrderJourneyIssue | undefined {
    if (order.failureReason || order.status === "ON_HOLD") {
        return {
            code: "FAILURE",
            label: "처리보류",
            detail: order.failureReason ?? "진행이 중단되어 운영자 확인이 필요합니다.",
        };
    }

    if (
        (order.status === "NEW" || order.status === "PREPARING")
        && !isValidPersonalCustomsCode(order.recipient.personalCustomsCode)
    ) {
        return {
            code: "CUSTOMS",
            label: "통관부호 확인 필요",
            detail: "통관부호가 없거나 형식이 올바르지 않습니다.",
        };
    }

    if (order.sourcingRefund?.status === "RETURN_REQUIRED") {
        return {
            code: "SOURCING_REFUND",
            label: "소싱 반품 접수 필요",
            detail: order.sourcingRefund.providerMessage ?? "소싱라이프가 안내한 반품 조건과 기한을 확인하세요.",
        };
    }

    if (order.sourcingRefund?.status === "REJECTED" || order.sourcingRefund?.status === "RECONCILIATION_REQUIRED") {
        return {
            code: "SOURCING_REFUND",
            label: order.sourcingRefund.status === "REJECTED" ? "소싱환불 거절 확인" : "소싱환불 결과 확인",
            detail: order.sourcingRefund.providerMessage ?? "소싱라이프 응답과 요청 내용을 대사하세요.",
        };
    }

    if (order.status === "CLAIM" && !order.claimStatus?.includes("완료")) {
        return {
            code: "CLAIM",
            label: `${claimTypeLabel(order.claimType)} 처리 필요`,
            detail: order.claimStatus ?? "마켓 처리기한 안에 응답해야 합니다.",
        };
    }

    if (order.status === "CANCELED" && hasCompletedSourcingPurchase(order) && !order.sourcingRefund) {
        return {
            code: "SOURCING_REFUND",
            label: "소싱환불 요청 필요",
            detail: "마켓 주문은 취소됐지만 소싱 구매금액 회수 요청이 접수되지 않았습니다.",
        };
    }

    if (typeof order.expectedCost === "number" && order.expectedSettlement - order.expectedCost < 0) {
        return {
            code: "MARGIN",
            label: "역마진 검토",
            detail: "예상 비용이 정산예정금보다 큽니다.",
        };
    }

    return undefined;
}

export function orderJourneyTargetHref(status: OrderJourneyStatus, issueCode?: OrderJourneyIssueCode): string {
    if (issueCode === "SOURCING_REFUND" || status.startsWith("SOURCING_REFUND") || status.startsWith("SOURCING_RETURN")) {
        return "/orders?view=all";
    }
    if (status.startsWith("MARKET_")) return "/orders?view=claims";
    if (status === "NEW_ORDER" || status === "CUSTOMS_COLLECTING") return "/orders?view=new";
    if (status === "SOURCING_ORDER_PENDING") return "/orders?view=preparing";
    if (status === "PURCHASE_CONFIRMED" || status === "PURCHASE_CONFIRMATION_PENDING" || status === "DELIVERED") {
        return "/orders?view=delivered";
    }
    if (status === "DOMESTIC_SHIPPING") return "/orders?view=shipping";
    return "/orders?view=waiting";
}

function sourcingRefundJourneyStatus(status: SourcingRefundStatus): OrderJourneyStatus {
    const statuses: Record<SourcingRefundStatus, OrderJourneyStatus> = {
        REQUESTED: "SOURCING_REFUND_REQUESTED",
        PROVIDER_REVIEW: "SOURCING_REFUND_PROVIDER_REVIEW",
        RETURN_REQUIRED: "SOURCING_RETURN_REQUIRED",
        RETURN_IN_TRANSIT: "SOURCING_RETURN_IN_TRANSIT",
        REFUND_PENDING: "SOURCING_REFUND_PENDING",
        REFUNDED: "SOURCING_REFUNDED",
        REJECTED: "SOURCING_REFUND_REJECTED",
        RECONCILIATION_REQUIRED: "SOURCING_REFUND_RECONCILIATION",
    };
    return statuses[status];
}

function claimJourneyStatus(claimType?: ClaimType): OrderJourneyStatus {
    if (claimType === "RETURN") return "MARKET_RETURN";
    if (claimType === "EXCHANGE") return "MARKET_EXCHANGE";
    return "MARKET_CANCEL";
}

function claimTypeLabel(claimType?: ClaimType): string {
    if (claimType === "RETURN") return "반품";
    if (claimType === "EXCHANGE") return "교환";
    return "취소";
}

function progressJourneyStatus(stage: SourcingProgressStage, status: OrderStatus): OrderJourneyStatus {
    if (stage === "CHINA_SHIPPING") return "CHINA_SHIPPING";
    if (stage === "CUSTOMS_CLEARANCE") return "DOMESTIC_ARRIVAL";
    if (stage === "DOMESTIC_SHIPPING") return "DOMESTIC_SHIPPING";
    if (stage === "DELIVERED") return status === "DELIVERED" ? "PURCHASE_CONFIRMATION_PENDING" : "DELIVERED";
    if (stage === "SOURCED" || stage === "EXTERNAL_PURCHASE") return "CHINA_DISPATCH_PENDING";
    return "SOURCING_ORDER_PENDING";
}
