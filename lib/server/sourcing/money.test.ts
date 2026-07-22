import { describe, expect, it } from "vitest";
import { calculateTransparentCosts } from "@/lib/server/sourcing/money";

describe("transparent sourcing costs", () => {
    it("rounds CNY conversion once at each disclosed cost line", () => {
        expect(calculateTransparentCosts({
            unitPriceCny: "12.34",
            sourceQuantity: 3,
            chinaShippingCny: "5.00",
            exchangeRateKrwPerCny: "190.123456",
            agencyFeeKrw: 1_000,
            internationalShippingAmountKrw: 2_000,
            customsTaxAmountKrw: null,
            otherFeeKrw: 500,
            discountKrw: 300,
        })).toEqual({
            productSubtotalCny: "37.02",
            productAmountKrw: 7_038,
            chinaShippingAmountKrw: 951,
            knownCostTotalKrw: 11_189,
        });
    });

    it("does not turn an unknown China shipping amount into zero", () => {
        const result = calculateTransparentCosts({
            unitPriceCny: "1.00", sourceQuantity: 1, chinaShippingCny: null,
            exchangeRateKrwPerCny: "200.000000", agencyFeeKrw: 0,
            internationalShippingAmountKrw: null, customsTaxAmountKrw: null,
            otherFeeKrw: 0, discountKrw: 0,
        });
        expect(result.chinaShippingAmountKrw).toBeNull();
    });

    it("rejects discounts larger than all known costs", () => {
        expect(() => calculateTransparentCosts({
            unitPriceCny: "1.00", sourceQuantity: 1, chinaShippingCny: null,
            exchangeRateKrwPerCny: "100.000000", agencyFeeKrw: 0,
            internationalShippingAmountKrw: null, customsTaxAmountKrw: null,
            otherFeeKrw: 0, discountKrw: 101,
        })).toThrow("discountKrw");
    });
});
