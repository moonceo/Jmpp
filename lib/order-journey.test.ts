import { describe, expect, it } from "vitest";
import { getOrderJourneyIssue, orderJourneyTargetHref, projectOrderJourneyStatus } from "@/lib/order-journey";
import type { Order } from "@/types/order";

function order(overrides: Partial<Order> = {}): Order {
    return {
        id: "order-1",
        marketOrderId: "MARKET-1",
        marketType: "naver",
        storeName: "테스트 스토어",
        orderDate: "2026-08-12 10:00",
        status: "NEW",
        buyerName: "구매자",
        buyerPhone: "010-0000-0000",
        recipient: {
            name: "수령자",
            phone: "010-0000-0000",
            address: "서울시",
            personalCustomsCode: "P123456789012",
        },
        product: {
            id: "product-1",
            name: "테스트 상품",
            thumbnail: "/placeholder.svg",
            optionName: "기본",
            quantity: 1,
            unitPrice: 10_000,
        },
        paymentPrice: 20_000,
        platformFee: 2_000,
        expectedSettlement: 18_000,
        sourcingLifeSyncStatus: "NOT_LINKED",
        ...overrides,
    };
}

describe("order journey projection", () => {
    it("separates customs-code collection from a normal new order", () => {
        expect(projectOrderJourneyStatus(order())).toBe("NEW_ORDER");
        expect(projectOrderJourneyStatus(order({
            recipient: {
                name: "수령자",
                phone: "010-0000-0000",
                address: "서울시",
                personalCustomsCode: "WRONG",
            },
        }))).toBe("CUSTOMS_COLLECTING");
    });

    it("projects overseas delivery and purchase confirmation independently", () => {
        expect(projectOrderJourneyStatus(order({
            status: "READY_TO_SHIP",
            sourcingProgressStage: "CHINA_SHIPPING",
        }))).toBe("CHINA_SHIPPING");
        expect(projectOrderJourneyStatus(order({
            status: "READY_TO_SHIP",
            sourcingProgressStage: "CUSTOMS_CLEARANCE",
        }))).toBe("DOMESTIC_ARRIVAL");
        expect(projectOrderJourneyStatus(order({
            status: "DELIVERED",
            sourcingProgressStage: "DELIVERED",
            marketOrderStatus: "PURCHASE_DECIDED",
        }))).toBe("PURCHASE_CONFIRMED");
    });

    it("keeps market claims visible as a parallel workflow", () => {
        const claimOrder = order({
            status: "CLAIM",
            claimType: "RETURN",
            claimStatus: "반품 요청",
        });
        expect(projectOrderJourneyStatus(claimOrder)).toBe("MARKET_RETURN");
        expect(getOrderJourneyIssue(claimOrder)).toMatchObject({ code: "CLAIM", label: "반품 처리 필요" });
    });

    it("projects only an actual sourcing refund and keeps market cancellation separate", () => {
        const canceledPaidOrder = order({
            status: "CANCELED",
            sourcingLifeSyncStatus: "PAID",
            sourcingLifeOrderId: "SL-ORDER-1",
            sourcingProgressStage: "SOURCED",
        });

        expect(projectOrderJourneyStatus(canceledPaidOrder)).toBe("MARKET_CANCEL");
        expect(getOrderJourneyIssue(canceledPaidOrder)).toMatchObject({ code: "SOURCING_REFUND" });
        expect(orderJourneyTargetHref("MARKET_CANCEL", "SOURCING_REFUND")).toBe("/orders?view=all");

        const requested = order({
            ...canceledPaidOrder,
            sourcingRefund: {
                id: "refund-1",
                providerRefundId: "110000312001",
                providerPurchaseOrderId: "2608284132117736001",
                providerStatusCode: 10,
                purchaseOrderLineId: "200002671001",
                type: "REFUND_ONLY",
                goodsStatus: "NOT_SHIPPED",
                status: "REQUESTED",
                reasonId: "403769",
                reasonLabel: "더 이상 원하지 않음",
                refundFeeCny: 43.86,
                currency: "CNY",
                requestedAt: "2026-08-12T10:00:00.000Z",
                updatedAt: "2026-08-12T10:00:00.000Z",
            },
        });
        expect(projectOrderJourneyStatus(requested)).toBe("SOURCING_REFUND_REQUESTED");

        expect(projectOrderJourneyStatus(order({
            ...requested,
            sourcingRefund: { ...requested.sourcingRefund!, status: "RECONCILIATION_REQUIRED" },
        }))).toBe("SOURCING_REFUND_RECONCILIATION");
    });

    it("flags invalid customs codes and negative margin paths", () => {
        expect(getOrderJourneyIssue(order({
            recipient: {
                name: "수령자",
                phone: "010-0000-0000",
                address: "서울시",
            },
        }))).toMatchObject({ code: "CUSTOMS" });
        expect(getOrderJourneyIssue(order({
            status: "READY_TO_SHIP",
            expectedSettlement: 8_000,
            expectedCost: 10_000,
        }))).toMatchObject({ code: "MARGIN" });
    });
});
