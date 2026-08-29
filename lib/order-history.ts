import { resolveSourcingProgressStage } from "@/lib/sourcing-progress";
import type { DeliveryHistoryEvent, Order } from "@/types/order";

export type OrderHistoryStepState = "completed" | "current";

export interface OrderHistoryDatum {
    label: string;
    value: string;
}

export interface OrderHistoryStep {
    id: string;
    label: string;
    description: string;
    state: OrderHistoryStepState;
    occurredAt?: string;
    data: OrderHistoryDatum[];
}

function formatTimestamp(value?: string) {
    if (!value) return undefined;
    return value.replace("T", " ").replace(/\.\d{3}Z$/, "").slice(0, 16);
}

function won(value: number) {
    return `${value.toLocaleString("ko-KR")}원`;
}

function findDeliveryEvent(order: Order, ...keywords: string[]): DeliveryHistoryEvent | undefined {
    return order.deliveryHistory?.find((event) => (
        event.flow === "OUTBOUND" && keywords.some((keyword) => event.label.includes(keyword))
    ));
}

function findDeliveredEvent(order: Order): DeliveryHistoryEvent | undefined {
    return order.deliveryHistory?.find((event) => (
        event.flow === "OUTBOUND"
        && (event.label === "배송완료" || event.label.includes("배송 완료") || event.label.includes("국내 배송완료"))
    ));
}

function compactData(data: Array<OrderHistoryDatum | false | undefined>): OrderHistoryDatum[] {
    return data.filter((item): item is OrderHistoryDatum => Boolean(item));
}

export function getOrderHistory(order: Order): OrderHistoryStep[] {
    const progress = resolveSourcingProgressStage(order);
    const paymentAt = order.sourcingLifeActualPayment?.paidAt ?? order.taoWorldPurchase?.paidAt;
    const chinaEvent = findDeliveryEvent(order, "중국 판매자 출고", "중국 배송", "중국배송");
    const customsEvent = findDeliveryEvent(order, "통관");
    const domesticEvent = findDeliveryEvent(order, "국내 배송", "국내배송", "마켓 배송중");
    const deliveredEvent = findDeliveredEvent(order);
    const terminal = order.status === "DELIVERED" || order.status === "CANCELED"
        || Boolean(order.claimStatus?.includes("완료"));

    const events: Array<Omit<OrderHistoryStep, "state">> = [
        {
            id: "received",
            label: "주문 접수",
            description: "판매 마켓에서 상품 주문을 수집했습니다.",
            occurredAt: order.orderDate,
            data: [
                { label: "마켓 주문번호", value: order.marketOrderId },
                { label: "판매처", value: order.storeName },
                { label: "주문금액", value: won(order.paymentPrice) },
            ],
        },
    ];

    if (order.status !== "NEW" && order.previousStatus !== "NEW") {
        events.push({
            id: "accepted",
            label: "주문 확인",
            description: "주문과 수령 정보를 확인하고 처리를 시작했습니다.",
            occurredAt: order.orderAcceptedAt ?? order.marketPaidAt ?? order.orderDate,
            data: compactData([
                { label: "수령인", value: order.recipient.name },
                { label: "수량", value: `${order.product.quantity}개` },
                order.recipient.personalCustomsCode ? { label: "개인통관부호", value: order.recipient.personalCustomsCode } : undefined,
            ]),
        });
    }

    if (order.sourcingLifeMatch) {
        events.push({
            id: "matched",
            label: "상품 매칭",
            description: "주문 상품과 구매할 소싱 상품을 연결했습니다.",
            occurredAt: order.sourcingMatchedAt ?? order.sourcingLifeSyncedAt,
            data: compactData([
                order.sourcingLifeMatch.productName ? { label: "매칭상품", value: order.sourcingLifeMatch.productName } : undefined,
                order.sourcingLifeMatch.optionName ? { label: "옵션", value: order.sourcingLifeMatch.optionName } : undefined,
                order.sourcingLifeMatch.estimatedCost !== undefined && { label: "예상 소싱금액", value: won(order.sourcingLifeMatch.estimatedCost) },
                order.sourcingLifeMatch.matchRate !== undefined && { label: "매칭률", value: `${order.sourcingLifeMatch.matchRate}%` },
            ]),
        });
    }

    if (order.sourcingPaymentRequestedAt) {
        events.push({
            id: "payment-ready",
            label: "소싱 결제 준비",
            description: "구매 상품과 배송대행 정보를 확정하고 결제를 요청했습니다.",
            occurredAt: order.sourcingPaymentRequestedAt,
            data: compactData([
                order.sourcingForwarder?.name ? { label: "배송대행지", value: order.sourcingForwarder.name } : undefined,
                order.sourcingLifeMatch?.estimatedCost !== undefined && { label: "예상 결제금액", value: won(order.sourcingLifeMatch.estimatedCost) },
            ]),
        });
    }

    if (paymentAt || order.taoWorldPurchase) {
        events.push({
            id: "purchased",
            label: "소싱 결제 완료",
            description: "소싱 상품 구매 결제가 완료되었습니다.",
            occurredAt: paymentAt,
            data: compactData([
                order.sourcingLifeActualPayment ? { label: "결제금액", value: won(order.sourcingLifeActualPayment.amount) } : undefined,
                order.taoWorldPurchase ? { label: "해외 결제금액", value: `${order.taoWorldPurchase.paidAmountCny.toLocaleString("ko-KR")} CNY` } : undefined,
                order.sourcingLifeOrderId ? { label: "소싱 주문번호", value: order.sourcingLifeOrderId } : undefined,
                order.taoWorldPurchase?.payOrderId ? { label: "결제번호", value: order.taoWorldPurchase.payOrderId } : undefined,
            ]),
        });
    }

    if (progress === "EXTERNAL_PURCHASE" && order.domesticInvoice) {
        events.push({
            id: "external-purchase",
            label: "외부구매 배송정보 등록",
            description: "외부에서 구매한 상품의 국내 배송정보를 등록했습니다.",
            occurredAt: order.domesticInvoice.receivedAt,
            data: compactData([
                { label: "택배사", value: order.domesticInvoice.carrier },
                { label: "국내 송장번호", value: order.domesticInvoice.trackingNumber },
            ]),
        });
    }

    if (chinaEvent || order.chinaInvoice || (progress === "CHINA_SHIPPING" && order.sourcingLifeSyncedAt)) {
        events.push({
            id: "china-shipping",
            label: "중국 배송",
            description: chinaEvent?.description ?? "중국 판매처에서 배송이 시작되었습니다.",
            occurredAt: chinaEvent?.occurredAt ?? order.chinaInvoice?.receivedAt ?? (progress === "CHINA_SHIPPING" ? order.sourcingLifeSyncedAt : undefined),
            data: compactData([
                (chinaEvent?.carrier ?? order.chinaInvoice?.carrier) ? { label: "택배사", value: chinaEvent?.carrier ?? order.chinaInvoice?.carrier ?? "" } : undefined,
                (chinaEvent?.trackingNumber ?? order.chinaInvoice?.trackingNumber) ? { label: "중국 송장번호", value: chinaEvent?.trackingNumber ?? order.chinaInvoice?.trackingNumber ?? "" } : undefined,
                chinaEvent?.location ? { label: "위치", value: chinaEvent.location } : undefined,
            ]),
        });
    }

    if (customsEvent || (progress === "CUSTOMS_CLEARANCE" && order.sourcingLifeSyncedAt)) {
        events.push({
            id: "customs",
            label: customsEvent?.label ?? "통관",
            description: customsEvent?.description ?? "국제 운송 물품의 통관 단계가 확인되었습니다.",
            occurredAt: customsEvent?.occurredAt ?? (progress === "CUSTOMS_CLEARANCE" ? order.sourcingLifeSyncedAt : undefined),
            data: compactData([
                customsEvent?.location ? { label: "통관 위치", value: customsEvent.location } : undefined,
                order.recipient.personalCustomsCode ? { label: "개인통관부호", value: order.recipient.personalCustomsCode } : undefined,
            ]),
        });
    }

    if (domesticEvent || (progress === "DOMESTIC_SHIPPING" && order.domesticInvoice)) {
        events.push({
            id: "domestic-shipping",
            label: "국내 배송",
            description: domesticEvent?.description ?? "국내 택배사에 인계되어 배송이 시작되었습니다.",
            occurredAt: domesticEvent?.occurredAt ?? order.domesticInvoice?.uploadedToMarketAt ?? order.domesticInvoice?.receivedAt,
            data: compactData([
                (domesticEvent?.carrier ?? order.domesticInvoice?.carrier) ? { label: "택배사", value: domesticEvent?.carrier ?? order.domesticInvoice?.carrier ?? "" } : undefined,
                (domesticEvent?.trackingNumber ?? order.domesticInvoice?.trackingNumber) ? { label: "국내 송장번호", value: domesticEvent?.trackingNumber ?? order.domesticInvoice?.trackingNumber ?? "" } : undefined,
                domesticEvent?.location ? { label: "위치", value: domesticEvent.location } : undefined,
            ]),
        });
    }

    if (order.status === "DELIVERED" || deliveredEvent) {
        events.push({
            id: "delivered",
            label: "배송 완료",
            description: deliveredEvent?.description ?? "상품이 고객에게 전달되었습니다.",
            occurredAt: deliveredEvent?.occurredAt ?? order.marketPurchaseConfirmedAt ?? order.sourcingLifeSyncedAt,
            data: compactData([
                (deliveredEvent?.carrier ?? order.domesticInvoice?.carrier) ? { label: "택배사", value: deliveredEvent?.carrier ?? order.domesticInvoice?.carrier ?? "" } : undefined,
                (deliveredEvent?.trackingNumber ?? order.domesticInvoice?.trackingNumber) ? { label: "송장번호", value: deliveredEvent?.trackingNumber ?? order.domesticInvoice?.trackingNumber ?? "" } : undefined,
                deliveredEvent?.location ? { label: "배송 위치", value: deliveredEvent.location } : undefined,
            ]),
        });
    }

    if (order.status === "CANCELED") {
        events.push({
            id: "canceled",
            label: "주문 취소",
            description: order.failureReason ?? order.sellerCancelReason ?? "주문 취소가 완료되었습니다.",
            occurredAt: order.sellerCanceledAt,
            data: compactData([
                order.sellerCancelReason ? { label: "취소 사유", value: order.sellerCancelReason } : undefined,
            ]),
        });
    }

    if (order.status === "ON_HOLD") {
        events.push({
            id: "on-hold",
            label: "처리보류",
            description: order.failureReason ?? "주문 처리가 일시적으로 보류되었습니다.",
            occurredAt: order.sourcingLifeSyncedAt,
            data: compactData([
                order.failureReason ? { label: "보류 사유", value: order.failureReason } : undefined,
            ]),
        });
    }

    if (order.claimType && order.claimRequestedAt) {
        const claimLabel = order.claimType === "CANCEL" ? "취소 접수" : order.claimType === "RETURN" ? "반품 접수" : "교환 접수";
        events.push({
            id: "claim-requested",
            label: claimLabel,
            description: order.claimReason ?? `${claimLabel} 요청이 확인되었습니다.`,
            occurredAt: order.claimRequestedAt,
            data: compactData([
                order.claimStatus ? { label: "처리상태", value: order.claimStatus } : undefined,
                order.claimReason ? { label: "요청사유", value: order.claimReason } : undefined,
            ]),
        });
    }

    if (order.claimType && order.claimProcessedAt) {
        const completedLabel = order.claimType === "CANCEL" ? "취소 처리 완료" : order.claimType === "RETURN" ? "반품 처리 완료" : "교환 처리 완료";
        events.push({
            id: "claim-completed",
            label: completedLabel,
            description: `${completedLabel} 상태가 확인되었습니다.`,
            occurredAt: order.claimProcessedAt,
            data: compactData([
                order.claimStatus ? { label: "최종상태", value: order.claimStatus } : undefined,
            ]),
        });
    }

    const sortedEvents = [...events].sort((left, right) => {
        if (!left.occurredAt) return 1;
        if (!right.occurredAt) return -1;
        return left.occurredAt.localeCompare(right.occurredAt);
    });

    return sortedEvents.map((event, index) => ({
        ...event,
        occurredAt: formatTimestamp(event.occurredAt),
        state: terminal || index < sortedEvents.length - 1 ? "completed" : "current",
    }));
}
