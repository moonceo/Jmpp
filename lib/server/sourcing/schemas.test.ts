import { describe, expect, it } from "vitest";
import {
    preparePurchaseDraftBodySchema,
    saveSourcingMappingBodySchema,
} from "@/lib/server/sourcing/schemas";

const mapping = {
    expectedOrderItemVersion: "1",
    quantityMultiplier: 1,
    sourceProduct: {
        platform: "TAOBAO",
        externalProductId: "123",
        canonicalUrl: "https://item.taobao.com/item.htm?id=123",
        saleStatus: "ACTIVE",
        restrictionStatus: "CLEAR",
        customsRequirement: "FORMAT_VALID",
        sourceVersion: "p1",
        lastCheckedAt: "2026-07-10T03:00:00Z",
    },
    sourceOption: {
        externalSkuId: "sku-1",
        optionAttributes: { color: "black", size: "M" },
        unitPriceCny: "12.30",
        stockStatus: "AVAILABLE",
        stockQuantity: 10,
        minimumQuantity: 1,
        quantityStep: 1,
        chinaShippingStatus: "CONFIRMED",
        chinaShippingCny: "5.00",
        sourceVersion: "s1",
        lastCheckedAt: "2026-07-10T03:00:00Z",
    },
};

describe("sourcing request schemas", () => {
    it("accepts an exact SKU snapshot", () => {
        expect(saveSourcingMappingBodySchema.safeParse(mapping).success).toBe(true);
    });

    it("rejects a Taobao product with a non-Taobao canonical URL", () => {
        expect(saveSourcingMappingBodySchema.safeParse({
            ...mapping,
            sourceProduct: { ...mapping.sourceProduct, canonicalUrl: "https://example.com/item/123" },
        }).success).toBe(false);
    });

    it("requires explicit option attributes instead of a product-only match", () => {
        expect(saveSourcingMappingBodySchema.safeParse({
            ...mapping,
            sourceOption: { ...mapping.sourceOption, optionAttributes: {} },
        }).success).toBe(false);
    });

    it("does not let a browser/operator claim server verification", () => {
        expect(saveSourcingMappingBodySchema.safeParse({
            ...mapping,
            verificationProvenance: "SERVER_VERIFIED",
        }).success).toBe(false);
        expect(saveSourcingMappingBodySchema.safeParse({
            ...mapping,
            sourceProduct: {
                ...mapping.sourceProduct,
                verificationProvenance: "SERVER_VERIFIED",
            },
        }).success).toBe(false);
    });

    it("rejects lookalike Taobao hosts and non-HTTPS thumbnails", () => {
        expect(saveSourcingMappingBodySchema.safeParse({
            ...mapping,
            sourceProduct: {
                ...mapping.sourceProduct,
                canonicalUrl: "https://eviltaobao.com/item/123",
            },
        }).success).toBe(false);
        expect(saveSourcingMappingBodySchema.safeParse({
            ...mapping,
            sourceProduct: {
                ...mapping.sourceProduct,
                thumbnailUrl: "http://img.taobao.com/123.jpg",
            },
        }).success).toBe(false);
    });

    it("does not accept an amount when China shipping is unknown", () => {
        expect(saveSourcingMappingBodySchema.safeParse({
            ...mapping,
            sourceOption: {
                ...mapping.sourceOption,
                chinaShippingStatus: "UNKNOWN",
                chinaShippingCny: "0.00",
            },
        }).success).toBe(false);
    });

    it("requires estimated international shipping to disclose an amount", () => {
        expect(preparePurchaseDraftBodySchema.safeParse({
            expectedOrderItemVersion: "1", expectedMappingRevision: 1,
            requestRevision: "draft-1", exchangeRateKrwPerCny: "190.1",
            exchangeRateSource: "BANK", exchangeRateObservedAt: "2026-07-10T03:00:00Z",
            quoteExpiresAt: "2026-07-10T03:10:00Z", agencyFeeKrw: 1000,
            internationalShipping: { status: "ESTIMATED", amountKrw: null },
            customsTax: { status: "PAY_LATER", amountKrw: null },
            otherFeeKrw: 0, discountKrw: 0, discountStatus: "CONFIRMED", forwarderStatus: "READY",
        }).success).toBe(false);
    });

    it("never accepts a plaintext PCCC in a purchase draft request", () => {
        expect(preparePurchaseDraftBodySchema.safeParse({
            expectedOrderItemVersion: "1", expectedMappingRevision: 1,
            requestRevision: "draft-1", exchangeRateKrwPerCny: "190.1",
            exchangeRateSource: "BANK", exchangeRateObservedAt: "2026-07-10T03:00:00Z",
            quoteExpiresAt: "2026-07-10T03:10:00Z", agencyFeeKrw: 1000,
            internationalShipping: { status: "PAY_LATER", amountKrw: null },
            customsTax: { status: "PAY_LATER", amountKrw: null },
            otherFeeKrw: 0, discountKrw: 0, discountStatus: "CONFIRMED", forwarderStatus: "READY",
            personalCustomsCode: "P123456789012",
        }).success).toBe(false);
    });
});
