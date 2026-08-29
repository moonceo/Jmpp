import { describe, expect, it } from "vitest";
import { getOrderHistory } from "@/lib/order-history";
import type { Order } from "@/types/order";

function makeOrder(overrides: Partial<Order> = {}): Order {
    return {
        id: "order-1",
        marketOrderId: "20260821-1",
        marketType: "naver",
        storeName: "테스트 스토어",
        orderDate: "2026-08-21 09:00",
        status: "NEW",
        buyerName: "구매자",
        buyerPhone: "010-0000-0000",
        recipient: { name: "수령인", phone: "010-0000-0000", address: "서울" },
        product: { id: "product-1", name: "테스트 상품", thumbnail: "/test.png", optionName: "기본", quantity: 1, unitPrice: 10000 },
        paymentPrice: 10000,
        platformFee: 1000,
        expectedSettlement: 9000,
        sourcingLifeSyncStatus: "NOT_LINKED",
        ...overrides,
    };
}

describe("order history", () => {
    it("shows only the received event for a new order", () => {
        const history = getOrderHistory(makeOrder());

        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ label: "주문 접수", state: "current" });
        expect(history[0].data).toContainEqual({ label: "마켓 주문번호", value: "20260821-1" });
    });

    it("marks every step completed after delivery", () => {
        const history = getOrderHistory(makeOrder({ status: "DELIVERED", sourcingProgressStage: "DELIVERED" }));

        expect(history.every((step) => step.state === "completed")).toBe(true);
    });

    it("adds payment facts only when payment data exists", () => {
        const history = getOrderHistory(makeOrder({
            status: "SHIPPING",
            sourcingProgressStage: "SOURCED",
            sourcingLifeActualPayment: { amount: 18400, currency: "KRW", paidAt: "2026-08-21 11:30" },
            sourcingLifeOrderId: "SL-20260821-01",
        }));

        expect(history.map((step) => step.label)).toEqual(["주문 접수", "주문 확인", "소싱 결제 완료"]);
        expect(history[2].data).toContainEqual({ label: "결제금액", value: "18,400원" });
    });
});
