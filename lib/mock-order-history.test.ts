import { describe, expect, it } from "vitest";
import { createMockOrders, mockOrders } from "@/lib/mock-data/orders";
import { getOrderHistory } from "@/lib/order-history";

function orderAtStage(stage: NonNullable<(typeof mockOrders)[number]["sourcingProgressStage"]>) {
    return mockOrders.find((order) => order.sourcingProgressStage === stage);
}

describe("order history demo coverage", () => {
    it("provides a visible demo for every normal history stage", () => {
        const cases = [
            mockOrders.find((order) => order.status === "NEW"),
            orderAtStage("MATCHED"),
            orderAtStage("PAYMENT_WAITING"),
            orderAtStage("EXTERNAL_PURCHASE"),
            orderAtStage("SOURCED"),
            orderAtStage("CHINA_SHIPPING"),
            orderAtStage("CUSTOMS_CLEARANCE"),
            orderAtStage("DOMESTIC_SHIPPING"),
            orderAtStage("DELIVERED"),
        ];

        expect(cases.every(Boolean)).toBe(true);
        cases.forEach((order) => {
            const history = getOrderHistory(order!);
            expect(history.length).toBeGreaterThan(0);
            expect(history.every((event) => event.occurredAt)).toBe(true);
        });
    });

    it("keeps every generated history chronological and at or before the reference time", () => {
        const reference = new Date("2026-08-24T10:00:00+09:00");
        const orders = createMockOrders(reference);

        orders.forEach((order) => {
            const timestamps = getOrderHistory(order).map((event) => {
                expect(event.occurredAt).toBeTruthy();
                return new Date(`${event.occurredAt!.replace(" ", "T")}:00+09:00`).getTime();
            });

            expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right));
            expect(timestamps.every((timestamp) => timestamp <= reference.getTime())).toBe(true);
        });
    });

    it("keeps refund requests after purchase and refund updates after requests", () => {
        const orders = createMockOrders("2026-08-24T10:00:00+09:00");
        const refundOrders = orders.filter((order) => order.sourcingRefund);
        const timestamp = (value: string) => new Date(`${value.replace(" ", "T")}:00+09:00`).getTime();

        expect(refundOrders.length).toBeGreaterThan(0);
        refundOrders.forEach((order) => {
            const refund = order.sourcingRefund!;
            expect(timestamp(refund.requestedAt)).toBeGreaterThanOrEqual(timestamp(order.sourcingLifeActualPayment!.paidAt));
            expect(timestamp(refund.updatedAt)).toBeGreaterThanOrEqual(timestamp(refund.requestedAt));
            if (refund.returnLogistics) {
                expect(timestamp(refund.returnLogistics.submittedAt)).toBeGreaterThanOrEqual(timestamp(refund.requestedAt));
            }
        });
    });

    it("provides dedicated canceled and on-hold demos in the all-orders view", () => {
        const canceled = mockOrders.find((order) => order.id === "ORD-20260715-0051");
        const onHold = mockOrders.find((order) => order.id === "ORD-20260715-0052");

        expect(canceled).toMatchObject({ status: "CANCELED", sellerCancelReason: "판매자 재고 부족" });
        expect(onHold).toMatchObject({ status: "ON_HOLD", sourcingLifeSyncStatus: "HOLD" });
        expect(getOrderHistory(canceled!).at(-1)).toMatchObject({ label: "주문 취소", state: "completed" });
        expect(onHold?.failureReason).toContain("처리를 보류");
    });

    it("includes request and completion facts for claim demos", () => {
        const completedClaim = mockOrders.find((order) => order.claimType && order.claimProcessedAt);
        const labels = getOrderHistory(completedClaim!).map((event) => event.label);

        expect(completedClaim).toBeDefined();
        expect(labels.some((label) => label.endsWith("접수"))).toBe(true);
        expect(labels.some((label) => label.endsWith("처리 완료"))).toBe(true);
    });
});
