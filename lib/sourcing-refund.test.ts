import { describe, expect, it } from "vitest";
import {
    advanceDemoSourcingRefund,
    canRestartSourcingAfterRefund,
    createSourcingRefundRequest,
    getSourcingRefundAvailability,
    prepareOrderForResourcingAfterRefund,
    recommendedSourcingRefundType,
    renderTaoWorldRefundOrder,
    submitDemoReturnLogistics,
    validateSourcingRefundDraft,
} from "@/lib/sourcing-refund";
import type { Order, SourcingRefundDraft } from "@/types/order";

function paidOrder(overrides: Partial<Order> = {}): Order {
    return {
        id: "order-1",
        marketOrderId: "MARKET-1",
        marketType: "naver",
        storeName: "테스트",
        orderDate: "2026-08-13 10:00",
        status: "SHIPPING",
        buyerName: "구매자",
        buyerPhone: "010-0000-0000",
        recipient: { name: "수령자", phone: "010-0000-0000", address: "서울" },
        product: { id: "product-1", name: "상품", thumbnail: "/placeholder.svg", optionName: "기본", quantity: 2, unitPrice: 10_000 },
        paymentPrice: 20_000,
        platformFee: 1_000,
        expectedSettlement: 19_000,
        expectedCost: 12_000,
        sourcingLifeSyncStatus: "PAID",
        sourcingProgressStage: "SOURCED",
        sourcingLifeOrderId: "SL-ORDER-1",
        sourcingLifeActualPayment: { amount: 12_000, currency: "KRW", paidAt: "2026-08-13T09:00:00.000Z" },
        taoWorldPurchase: {
            distributorId: "2100000927014",
            purchaseOrderId: "2608284132117736001",
            purchaseOrderLineId: "200002671001",
            payOrderId: "2597049687002736001",
            currency: "CNY",
            paidAmountCny: 52.63,
            paidAt: "2026-08-13T09:00:00.000Z",
        },
        ...overrides,
    };
}

function refundDraft(order = paidOrder(), overrides: Partial<SourcingRefundDraft> = {}): SourcingRefundDraft {
    const rendered = renderTaoWorldRefundOrder(order, "REFUND_ONLY", "NOT_SHIPPED");
    if (!rendered) throw new Error("render fixture missing");
    return {
        purchaseOrderLineId: rendered.purchaseOrderLineId,
        type: "REFUND_ONLY",
        goodsStatus: "NOT_SHIPPED",
        reasonId: rendered.reasons[0].reasonId,
        reasonLabel: rendered.reasons[0].reasonLabel,
        refundFeeCny: rendered.maxRefundFeeCny,
        currency: "CNY",
        ...overrides,
    };
}

describe("TaoWorld-shaped sourcing refund prototype", () => {
    it("requires a paid purchase line and excludes external purchases", () => {
        expect(getSourcingRefundAvailability(paidOrder())).toEqual({ canOpen: true, canRequest: true });
        expect(getSourcingRefundAvailability(paidOrder({
            sourcingLifeSyncStatus: "PAYMENT_READY",
            sourcingProgressStage: "PAYMENT_WAITING",
            sourcingLifeOrderId: "SL-PAYMENT-WAITING",
        }))).toMatchObject({ canOpen: false, canRequest: false });
        expect(getSourcingRefundAvailability(paidOrder({
            sourcingProgressStage: "CHINA_SHIPPING",
        }))).toEqual({ canOpen: true, canRequest: true });
        expect(getSourcingRefundAvailability(paidOrder({
            sourcingProgressStage: "CUSTOMS_CLEARANCE",
        }))).toEqual({ canOpen: true, canRequest: true });
        expect(getSourcingRefundAvailability(paidOrder({
            sourcingProgressStage: "DOMESTIC_SHIPPING",
        }))).toEqual({ canOpen: true, canRequest: true });
        expect(getSourcingRefundAvailability(paidOrder({
            sourcingProgressStage: "DELIVERED",
        }))).toMatchObject({ canOpen: false, canRequest: false });
        const existingRefund = createSourcingRefundRequest(paidOrder(), refundDraft());
        expect(getSourcingRefundAvailability(paidOrder({
            sourcingProgressStage: "CUSTOMS_CLEARANCE",
            sourcingRefund: existingRefund,
        }))).toEqual({ canOpen: true, canRequest: false });
        expect(getSourcingRefundAvailability(paidOrder({ taoWorldPurchase: undefined }))).toMatchObject({ canOpen: false, canRequest: false });
        expect(getSourcingRefundAvailability(paidOrder({
            sourcingProgressStage: "EXTERNAL_PURCHASE",
            sourcingLifeSyncStatus: "NOT_LINKED",
            sourcingLifeOrderId: undefined,
        }))).toMatchObject({ canOpen: false, canRequest: false });
    });

    it("renders dynamic reasons and validates the line, reason, and CNY maximum", () => {
        const order = paidOrder();
        expect(recommendedSourcingRefundType(order)).toBe("REFUND_ONLY");
        expect(recommendedSourcingRefundType(paidOrder({ sourcingProgressStage: "CHINA_SHIPPING" }))).toBe("RETURN_AND_REFUND");
        const rendered = renderTaoWorldRefundOrder(order, "RETURN_AND_REFUND", "RECEIVED");
        expect(rendered).toMatchObject({ refundType: 2, goodsStatus: 4, currency: "CNY", maxRefundFeeCny: 52.63 });
        expect(rendered?.reasons.length).toBeGreaterThan(1);
        expect(validateSourcingRefundDraft(order, refundDraft(order, { refundFeeCny: 60 }))).toContain("최대 가능금액");
        expect(validateSourcingRefundDraft(order, refundDraft(order, { reasonId: "999999" }))).toContain("render 응답");
    });

    it("creates provider IDs and advances refund-only query states", () => {
        const order = paidOrder();
        const refund = createSourcingRefundRequest(order, refundDraft(order, { marketClaimId: "CLAIM-1" }), "2026-08-13T10:00:00.000Z");
        expect(refund).toMatchObject({
            status: "REQUESTED",
            providerStatusCode: 10,
            purchaseOrderLineId: "200002671001",
            refundFeeCny: 52.63,
            marketClaimId: "CLAIM-1",
        });
        const reviewing = advanceDemoSourcingRefund(refund);
        const pending = advanceDemoSourcingRefund(reviewing);
        const completed = advanceDemoSourcingRefund(pending);
        expect([reviewing.status, pending.status, completed.status]).toEqual(["PROVIDER_REVIEW", "REFUND_PENDING", "REFUNDED"]);
        expect(completed.providerStatusCode).toBe(100);
        expect(order.status).toBe("SHIPPING");
    });

    it("requires return logistics before a return-and-refund can continue", () => {
        const order = paidOrder({ sourcingProgressStage: "CHINA_SHIPPING" });
        const rendered = renderTaoWorldRefundOrder(order, "RETURN_AND_REFUND", "RECEIVED");
        if (!rendered) throw new Error("render fixture missing");
        const requested = createSourcingRefundRequest(order, refundDraft(order, {
            type: "RETURN_AND_REFUND",
            goodsStatus: "RECEIVED",
            reasonId: rendered.reasons[1].reasonId,
            reasonLabel: rendered.reasons[1].reasonLabel,
        }));
        const returnRequired = advanceDemoSourcingRefund(advanceDemoSourcingRefund(requested));
        expect(returnRequired.status).toBe("RETURN_REQUIRED");
        const inTransit = submitDemoReturnLogistics(returnRequired, {
            companyCode: "SF",
            companyName: "顺丰速运(SF Express)",
            trackingNumber: "SF00111TEST",
            buyerPhone: "15068763422",
        });
        expect(inTransit).toMatchObject({ status: "RETURN_IN_TRANSIT", goodsStatus: "SENT_BACK" });
        expect(inTransit.returnLogistics?.trackingNumber).toBe("SF00111TEST");
    });

    it("archives a completed refund and resets only the sourcing connection for a new seller", () => {
        const originalOrder = paidOrder({
            domesticInvoice: {
                carrier: "CJ대한통운",
                trackingNumber: "1234567890",
                receivedAt: "2026-08-13 09:30",
                source: "sourcing_life",
            },
            chinaInvoice: {
                carrier: "중통택배",
                trackingNumber: "CN0000000001",
                receivedAt: "2026-08-13 08:30",
                source: "sourcing_life",
            },
        });
        const requested = createSourcingRefundRequest(originalOrder, refundDraft(originalOrder));
        const completedRefund = advanceDemoSourcingRefund(
            advanceDemoSourcingRefund(advanceDemoSourcingRefund(requested)),
        );
        const refundedOrder = { ...originalOrder, sourcingRefund: completedRefund };

        expect(canRestartSourcingAfterRefund(refundedOrder)).toBe(true);
        expect(canRestartSourcingAfterRefund({
            ...refundedOrder,
            marketOrderStatus: "DELIVERING",
        })).toBe(false);

        const restarted = prepareOrderForResourcingAfterRefund(refundedOrder);

        expect(restarted).toMatchObject({
            status: "PREPARING",
            sourcingLifeSyncStatus: "NOT_LINKED",
            sourcingProgressStage: "MATCH_REQUIRED",
        });
        expect(restarted.sourcingLifeSyncedAt).toBeUndefined();
        expect(restarted.sourcingRefund).toBeUndefined();
        expect(restarted.sourcingRefundHistory).toEqual([completedRefund]);
        expect(restarted.sourcingLifeOrderId).toBeUndefined();
        expect(restarted.sourcingLifeActualPayment).toBeUndefined();
        expect(restarted.taoWorldPurchase).toBeUndefined();
        expect(restarted.sourcingLifeMatch).toBeUndefined();
        expect(restarted.domesticInvoice).toBeUndefined();
        expect(restarted.chinaInvoice).toBeUndefined();
        expect(restarted.marketOrderId).toBe(originalOrder.marketOrderId);
        expect(restarted.product).toEqual(originalOrder.product);
    });
});
