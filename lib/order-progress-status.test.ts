import { describe, expect, it } from "vitest";
import { mockOrders } from "@/lib/mock-data/orders";
import { getOrderProgressLabel, type OrderProgressProjection } from "@/lib/order-progress-status";

function order(overrides: Partial<OrderProgressProjection> = {}): OrderProgressProjection {
    return {
        status: "READY_TO_SHIP",
        sourcingProgressStage: "SOURCED",
        sourcingLifeSyncStatus: "PAID",
        sourcingLifeOrderId: "SL-1",
        marketOrderStatus: "PAYED",
        sourcingRefund: undefined,
        ...overrides,
    };
}

describe("getOrderProgressLabel", () => {
    it("shows one base sourcing status", () => {
        expect(getOrderProgressLabel(order())).toBe("결제완료");
    });

    it("keeps market cancellation and hold details out of the sourcing progress label", () => {
        expect(getOrderProgressLabel(order({ marketOrderStatus: "CANCEL_REQUESTED" }))).toBe("결제완료");
        expect(getOrderProgressLabel(order({ status: "ON_HOLD", marketOrderStatus: "PAYED" }))).toBe("결제완료");
        expect(getOrderProgressLabel(order({ sourcingProgressStage: "MATCH_PENDING_REVIEW" }))).toBe("소싱필요");
        expect(getOrderProgressLabel(order({ status: "DELIVERED", sourcingProgressStage: "DELIVERED", marketOrderStatus: "PURCHASE_DECIDED" }))).toBe("구매확정");
    });

    it("shows matched for a direct-delivery order before sourcing payment", () => {
        expect(getOrderProgressLabel(order({
            status: "PREPARING",
            sourcingProgressStage: "MATCHED",
            sourcingLifeSyncStatus: "MATCH_SAVED",
            sourcingLifeOrderId: undefined,
            marketOrderStatus: "PAYED",
        }))).toBe("매칭완료");
    });

    it("uses the active sourcing refund as the single highest-priority status", () => {
        expect(getOrderProgressLabel(order({
            marketOrderStatus: "CANCEL_REQUESTED",
            sourcingRefund: {
                id: "refund-1",
                providerRefundId: "provider-refund-1",
                providerPurchaseOrderId: "purchase-1",
                providerStatusCode: 10,
                purchaseOrderLineId: "line-1",
                type: "REFUND_ONLY",
                goodsStatus: "NOT_SHIPPED",
                reasonId: "reason-1",
                reasonLabel: "단순 변심",
                refundFeeCny: 10,
                currency: "CNY",
                status: "PROVIDER_REVIEW",
                requestedAt: "2026-08-18T00:00:00.000Z",
                updatedAt: "2026-08-18T00:00:00.000Z",
            },
        }))).toBe("소싱환불 승인대기");

        expect(getOrderProgressLabel(order({
            sourcingRefund: {
                id: "refund-2",
                providerRefundId: "provider-refund-2",
                providerPurchaseOrderId: "purchase-2",
                providerStatusCode: 0,
                purchaseOrderLineId: "line-2",
                type: "REFUND_ONLY",
                goodsStatus: "NOT_SHIPPED",
                reasonId: "reason-2",
                reasonLabel: "단순 변심",
                refundFeeCny: 10,
                currency: "CNY",
                status: "REQUESTED",
                requestedAt: "2026-08-18T00:00:00.000Z",
                updatedAt: "2026-08-18T00:00:00.000Z",
            },
        }))).toBe("소싱환불 승인대기");
    });

    it("keeps normal and exceptional single-status paths visible in demo orders", () => {
        const progressLabel = (id: string) => {
            const demoOrder = mockOrders.find((item) => item.id === id);
            if (!demoOrder) throw new Error(`missing demo order: ${id}`);
            return getOrderProgressLabel(demoOrder);
        };

        expect(progressLabel("ORD-20260618-0042")).toBe("소싱환불 승인대기");
        expect(progressLabel("ORD-20260618-0043")).toBe("소싱반품 송장필요");
        expect(progressLabel("ORD-20260618-0047")).toBe("소싱환불 확인필요");
        expect(progressLabel("ORD-20260618-0048")).toBe("소싱환불 처리중");
        expect(progressLabel("ORD-20260618-0049")).toBe("소싱반품 배송중");
        expect(progressLabel("ORD-20260618-0050")).toBe("소싱환불 완료");
        expect(progressLabel("ORD-20260618-0036")).toBe("매칭완료");
    });
});
