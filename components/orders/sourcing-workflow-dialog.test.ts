import { describe, expect, it } from "vitest";
import {
    buildSavedSourcingCandidate,
    canProceedToPayment,
    calculateSourcingMargin,
    transitionPriceNegotiation,
} from "@/components/orders/sourcing-workflow-dialog";
import { getSourcingCandidates } from "@/lib/mock-data/sourcing-life";
import { mockOrders } from "@/lib/mock-data/orders";

describe("sourcing recommendation cards", () => {
    it("provides every option needed by the two-column recommendation cards", () => {
        const candidates = getSourcingCandidates("ORD-20260610-0001");

        expect(candidates).toHaveLength(20);
        expect(candidates[0].options).toHaveLength(4);
        expect(candidates[0].options).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: "화이트 / 2000mm", stock: 32 }),
            expect.objectContaining({ label: "오크 / 2000mm", stock: 18 }),
            expect.objectContaining({ label: "월넛 / 1800mm", stock: 24 }),
            expect.objectContaining({ label: "블랙 / 1600mm", stock: 11 }),
        ]));
    });

    it("keeps sold-out options in candidate data so the UI can display them", () => {
        const candidates = getSourcingCandidates("ORD-20260610-0002");

        expect(candidates[0].options.some((option) => option.stock === 0)).toBe(true);
    });
});

describe("sourcing margin calculation", () => {
    it("subtracts the collected marketplace fee before product cost", () => {
        expect(calculateSourcingMargin({
            paymentPrice: 100000,
            platformFee: 6000,
            expectedSettlement: 94000,
        }, 50000, {
            sourcingServiceFee: 0,
            currencyExchangeFee: 0,
            estimatedForwarderShippingFee: 0,
        })).toEqual({
            marketPaymentAmount: 100000,
            marketFee: 6000,
            marketFeeRate: 6,
            expectedSettlement: 94000,
            productCost: 50000,
            sourcingServiceFee: 0,
            currencyExchangeFee: 0,
            estimatedForwarderShippingFee: 0,
            sourcingTotalCost: 50000,
            expectedMargin: 44000,
            expectedMarginRate: 44,
        });
    });

    it("derives the fee from the marketplace settlement when an explicit fee is absent", () => {
        expect(calculateSourcingMargin({
            paymentPrice: 80000,
            platformFee: 0,
            expectedSettlement: 76000,
        }, 30000, {
            sourcingServiceFee: 0,
            currencyExchangeFee: 0,
            estimatedForwarderShippingFee: 0,
        })).toMatchObject({
            marketFee: 4000,
            expectedSettlement: 76000,
            expectedMargin: 46000,
        });
    });

    it("includes sourcing, exchange, and estimated forwarder costs in net profit", () => {
        const result = calculateSourcingMargin({
            paymentPrice: 10000,
            platformFee: 589,
            expectedSettlement: 9411,
        }, 11250);

        expect(result).toMatchObject({
            productCost: 11250,
            sourcingServiceFee: 337,
            currencyExchangeFee: 281,
            estimatedForwarderShippingFee: 4750,
            sourcingTotalCost: 11868,
            expectedMargin: -7207,
        });
        expect(result.expectedMarginRate).toBeCloseTo(-72.1, 1);
    });

    it("exposes the avocado bag sample as visible sourcing demo data", () => {
        const [candidate] = getSourcingCandidates("UNKNOWN-ORDER");

        expect(candidate.productName).toContain("아보카도 그린");
        expect(candidate.options[0]).toMatchObject({
            label: "지퍼형【아보카도 그린】5인치 방수",
            labelZh: "拉链【牛油果绿】5寸防水",
            priceCny: 51.25,
            priceKrw: 11250,
        });
    });
});

describe("saved sourcing match", () => {
    it("keeps the saved product, option, and unit cost when the candidate list no longer contains the match", () => {
        const order = mockOrders.find((item) => item.id === "ORD-20260617-0029");
        expect(order).toBeDefined();

        const candidate = buildSavedSourcingCandidate(order!, getSourcingCandidates(order!.id)[0]);

        expect(candidate).toMatchObject({
            id: "ORD-20260617-0029-MATCH-01",
            productId: "SL-P-0029-01",
            productName: "접이식 빨래 건조대 대형",
            priceKrw: 21100,
        });
        expect(candidate?.options[0]).toMatchObject({
            id: "large-silver",
            label: "대형 / 실버",
            priceKrw: 21100,
        });
    });
});

describe("price negotiation controls", () => {
    it("starts a Chinese seller price request only from idle", () => {
        expect(transitionPriceNegotiation("IDLE", "REQUEST")).toEqual({
            status: "REQUESTED",
            message: "가격을 조금 낮춰주실 수 있을까요?",
            sentAt: "깎아줘 요청",
        });
        expect(transitionPriceNegotiation("REQUESTED", "REQUEST")).toBeUndefined();
    });

    it("cancels only an active price request", () => {
        expect(transitionPriceNegotiation("REQUESTED", "CANCEL")).toEqual({
            status: "IDLE",
            message: "가격 인하 요청을 취소합니다.",
            sentAt: "깎아줘 취소",
        });
        expect(transitionPriceNegotiation("IDLE", "CANCEL")).toBeUndefined();
    });

    it("blocks payment while a price request is active", () => {
        expect(canProceedToPayment("REQUESTED")).toBe(false);
        expect(canProceedToPayment("IDLE")).toBe(true);
    });
});
