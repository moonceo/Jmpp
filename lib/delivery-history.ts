import { resolveSourcingProgressStage } from "@/lib/sourcing-progress";
import type { ClaimType, DeliveryHistoryEvent, Order, OrderStatus, SourcingProgressStage } from "@/types/order";

export type DeliveryHistoryMilestoneState = "COMPLETED" | "CURRENT" | "UPCOMING";

export interface DeliveryHistoryMilestone {
    id: string;
    label: string;
    state: DeliveryHistoryMilestoneState;
}

export interface DeliveryHistoryView {
    label: string;
    title: string;
    description: string;
    currentStepIndex: number;
    milestones: DeliveryHistoryMilestone[];
    events: DeliveryHistoryEvent[];
}

type DeliveryHistoryOrder = Pick<Order, "status">
    & Partial<Pick<Order,
        | "sourcingProgressStage"
        | "sourcingLifeSyncStatus"
        | "sourcingLifeOrderId"
        | "previousStatus"
        | "claimType"
        | "claimStatus"
        | "claimRequestedAt"
        | "claimProcessedAt"
        | "domesticInvoice"
        | "sourcingLifeActualPayment"
        | "sourcingLifeSyncedAt"
        | "deliveryHistory"
    >>;

const OUTBOUND_MILESTONES = [
    { id: "SOURCED", label: "결제완료" },
    { id: "CHINA_SHIPPING", label: "중국배송" },
    { id: "CUSTOMS_CLEARANCE", label: "통관" },
    { id: "DOMESTIC_SHIPPING", label: "국내배송" },
    { id: "DELIVERED", label: "배송완료" },
] as const;

const OUTBOUND_STAGE_INDEX: Partial<Record<SourcingProgressStage, number>> = {
    SOURCED: 0,
    CHINA_SHIPPING: 1,
    CUSTOMS_CLEARANCE: 2,
    DOMESTIC_SHIPPING: 3,
    DELIVERED: 4,
};

function isCompletedClaim(order: DeliveryHistoryOrder) {
    return Boolean(order.claimProcessedAt || order.claimStatus?.includes("완료"));
}

function isDeliveredStatus(status?: OrderStatus) {
    return status === "DELIVERED";
}

function outboundStepIndex(order: DeliveryHistoryOrder) {
    const stage = resolveSourcingProgressStage(order);
    const stageIndex = OUTBOUND_STAGE_INDEX[stage];
    if (stageIndex !== undefined) return stageIndex;
    if (isDeliveredStatus(order.status) || isDeliveredStatus(order.previousStatus)) return 4;
    if ((order.status === "SHIPPING" || order.previousStatus === "SHIPPING") && stage === "EXTERNAL_PURCHASE") return 3;
    return -1;
}

function milestoneState(index: number, currentIndex: number, terminal: boolean): DeliveryHistoryMilestoneState {
    if (terminal || index < currentIndex) return "COMPLETED";
    if (index === currentIndex) return "CURRENT";
    return "UPCOMING";
}

function claimMilestones(claimType: ClaimType | undefined, completed: boolean): DeliveryHistoryMilestone[] {
    if (claimType === "RETURN") {
        return [
            { id: "RETURN_PICKUP", label: "반품회수", state: completed ? "COMPLETED" : "CURRENT" },
            { id: "RETURN_COMPLETED", label: "반품완료", state: completed ? "COMPLETED" : "UPCOMING" },
        ];
    }
    if (claimType === "EXCHANGE") {
        return [
            { id: "EXCHANGE_PICKUP", label: "교환회수", state: completed ? "COMPLETED" : "CURRENT" },
            { id: "EXCHANGE_RESEND", label: "교환재배송", state: completed ? "COMPLETED" : "UPCOMING" },
            { id: "EXCHANGE_COMPLETED", label: "교환완료", state: completed ? "COMPLETED" : "UPCOMING" },
        ];
    }
    return [];
}

function fallbackEvents(order: DeliveryHistoryOrder, currentIndex: number): DeliveryHistoryEvent[] {
    const events: DeliveryHistoryEvent[] = [];
    const invoice = order.domesticInvoice;

    if (order.sourcingLifeActualPayment) {
        events.push({
            id: "sourcing-payment-completed",
            flow: "OUTBOUND",
            label: "소싱 결제완료",
            description: "소싱상품 결제가 완료되어 배송중 관리가 시작되었습니다.",
            occurredAt: order.sourcingLifeActualPayment.paidAt,
        });
    }

    if (invoice) {
        events.push({
            id: "domestic-invoice-received",
            flow: "OUTBOUND",
            label: "국내송장 발급",
            description: "국내 택배사와 송장번호가 주문에 반영되었습니다.",
            occurredAt: invoice.receivedAt,
            carrier: invoice.carrier,
            trackingNumber: invoice.trackingNumber,
        });
    }
    if (invoice?.uploadedToMarketAt) {
        events.push({
            id: "market-shipping-started",
            flow: "OUTBOUND",
            label: "마켓 배송중 처리",
            description: "국내송장을 마켓에 전송하고 배송중으로 변경했습니다.",
            occurredAt: invoice.uploadedToMarketAt,
            carrier: invoice.carrier,
            trackingNumber: invoice.trackingNumber,
        });
    }
    if (currentIndex >= 0) {
        events.push({
            id: `delivery-stage-${OUTBOUND_MILESTONES[currentIndex].id}`,
            flow: "OUTBOUND",
            label: OUTBOUND_MILESTONES[currentIndex].label,
            description: currentIndex === 4 ? "배송완료 상태가 확인되었습니다." : "현재 확인된 배송 단계입니다.",
            occurredAt: order.sourcingLifeSyncedAt,
            carrier: invoice?.carrier,
            trackingNumber: invoice?.trackingNumber,
        });
    }
    if (order.claimType === "RETURN" || order.claimType === "EXCHANGE") {
        events.push({
            id: "claim-requested",
            flow: order.claimType,
            label: order.claimType === "RETURN" ? "반품 접수" : "교환 접수",
            description: order.claimStatus,
            occurredAt: order.claimRequestedAt,
        });
        if (isCompletedClaim(order)) {
            events.push({
                id: "claim-completed",
                flow: order.claimType,
                label: order.claimType === "RETURN" ? "반품완료" : "교환완료",
                description: `${order.claimType === "RETURN" ? "반품" : "교환"} 배송 처리가 완료되었습니다.`,
                occurredAt: order.claimProcessedAt,
            });
        }
    }

    return events;
}

function summary(order: DeliveryHistoryOrder, currentIndex: number) {
    const claimCompleted = isCompletedClaim(order);
    if (order.claimType === "RETURN") {
        return claimCompleted
            ? { label: "반품완료", title: "반품 배송까지 모두 완료되었습니다", description: "최초 배송부터 반품 회수와 반송 완료까지 누적 이력을 확인합니다." }
            : { label: "반품 진행 중", title: "반품 배송이 진행 중입니다", description: "최초 배송과 현재 반품 회수 단계를 함께 확인합니다." };
    }
    if (order.claimType === "EXCHANGE") {
        return claimCompleted
            ? { label: "교환완료", title: "교환 배송까지 모두 완료되었습니다", description: "최초 배송부터 교환 회수와 재배송 완료까지 누적 이력을 확인합니다." }
            : { label: "교환 진행 중", title: "교환 배송이 진행 중입니다", description: "최초 배송과 현재 교환 회수·재배송 단계를 함께 확인합니다." };
    }
    if (currentIndex === 4) {
        return { label: "배송완료", title: "배송이 완료되었습니다", description: "중국 출고부터 국내 배송완료까지 누적 배송 이력을 확인합니다." };
    }
    if (currentIndex === 3) {
        return { label: "국내 배송중", title: "상품이 국내에서 배송 중입니다", description: "완료된 해외 배송 단계와 현재 국내 배송 이력을 확인합니다." };
    }
    if (currentIndex === 2) {
        return { label: "통관 중", title: "상품이 통관 절차를 진행 중입니다", description: "중국 배송 완료 이후의 통관 진행 이력을 확인합니다." };
    }
    if (currentIndex === 1) {
        return { label: "중국배송중", title: "상품이 중국에서 배송 중입니다", description: "결제완료 이후 중국 배송 이력을 확인합니다." };
    }
    if (currentIndex === 0) {
        return { label: "결제완료", title: "결제한 상품의 배송 준비가 시작되었습니다", description: "소싱 결제완료부터 배송완료까지 누적 이력을 확인합니다." };
    }
    return { label: "중국배송중", title: "상품이 중국에서 배송 중입니다", description: "중국 출고 이후 현재까지 확인된 배송 이력을 확인합니다." };
}

export function getDeliveryHistoryView(order: DeliveryHistoryOrder): DeliveryHistoryView | undefined {
    const currentIndex = outboundStepIndex(order);
    const explicitEvents = order.deliveryHistory ?? [];
    const hasClaimDelivery = order.claimType === "RETURN" || order.claimType === "EXCHANGE";
    if (currentIndex < 0 && explicitEvents.length === 0 && !hasClaimDelivery) return undefined;

    const claimCompleted = isCompletedClaim(order);
    const outboundTerminal = currentIndex === 4 || hasClaimDelivery;
    const outbound = OUTBOUND_MILESTONES.map((step, index) => ({
        ...step,
        state: milestoneState(index, Math.max(currentIndex, 0), outboundTerminal),
    }));
    const milestones = [...outbound, ...claimMilestones(order.claimType, claimCompleted)];
    const fallback = fallbackEvents(order, currentIndex);
    const paymentEvent = fallback.find((event) => event.id === "sourcing-payment-completed");
    const events = explicitEvents.length > 0
        ? [
            ...(paymentEvent && !explicitEvents.some((event) => event.id === paymentEvent.id) ? [paymentEvent] : []),
            ...explicitEvents,
        ]
        : fallback;

    return {
        ...summary(order, Math.max(currentIndex, 0)),
        currentStepIndex: milestones.findLastIndex((step) => step.state !== "UPCOMING"),
        milestones,
        events,
    };
}
