import { describe, expect, it } from "vitest";
import { calculateOrderMargin } from "@/lib/order-margin";

const baseOrder = {
    paymentPrice: 10_000,
    product: {
        id: "product-1",
        name: "테스트 상품",
        thumbnail: "/images/dummy/vintage-lamp.png",
        optionName: "기본",
        quantity: 2,
        unitPrice: 5_000,
    },
};

describe("calculateOrderMargin", () => {
    it("uses the actual sourcing payment before every other price", () => {
        expect(calculateOrderMargin({
            ...baseOrder,
            expectedCost: 7_000,
            sourcingLifeActualPayment: { amount: 6_000, currency: "KRW", paidAt: "2026-08-24 10:00" },
            sourcingLifeMatch: { estimatedCost: 3_500, quantity: 2 },
        })).toEqual({
            paymentAmount: 10_000,
            sourcingCost: 6_000,
            marginAmount: 4_000,
            marginRate: 40,
            costBasis: "ACTUAL_PAYMENT",
        });
    });

    it("multiplies the matched unit price by the matched quantity before payment", () => {
        expect(calculateOrderMargin({
            ...baseOrder,
            sourcingLifeMatch: { estimatedCost: 3_000, quantity: 2 },
        })).toMatchObject({
            sourcingCost: 6_000,
            marginAmount: 4_000,
            marginRate: 40,
            costBasis: "MATCHED_PRICE",
        });
    });

    it("uses the recorded direct-purchase cost and supports negative margins", () => {
        expect(calculateOrderMargin({
            ...baseOrder,
            sourcingProgressStage: "EXTERNAL_PURCHASE",
            expectedCost: 12_000,
        })).toMatchObject({
            sourcingCost: 12_000,
            marginAmount: -2_000,
            marginRate: -20,
            costBasis: "DIRECT_PURCHASE",
        });
    });

    it("does not estimate a margin before a product is matched or purchased", () => {
        expect(calculateOrderMargin({ ...baseOrder, expectedCost: 5_000 })).toBeUndefined();
    });
});
