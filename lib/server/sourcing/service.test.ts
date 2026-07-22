import type { TransactionClient } from "@/lib/server/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MappingValidationContext, SaveMappingInput } from "@/lib/server/sourcing/types";

const repositoryMocks = vi.hoisted(() => ({
    findDraftByIdempotencyKey: vi.fn(),
    getActiveMapping: vi.fn(),
    insertMapping: vi.fn(),
    insertPurchaseDraft: vi.fn(),
    loadMappingValidationContext: vi.fn(),
    lockSourcingOrderItem: vi.fn(),
    upsertSourceOption: vi.fn(),
    upsertSourceProduct: vi.fn(),
}));

vi.mock("@/lib/server/sourcing/repository", () => repositoryMocks);

import { evaluateMappingFreshness, saveSourcingMapping } from "@/lib/server/sourcing/service";

const NOW = new Date("2026-07-10T03:10:00.000Z");

function context(overrides: Partial<MappingValidationContext["option"]> = {}): MappingValidationContext {
    return {
        item: {
            id: "item", marketAccountId: "account", salesOrderId: "order",
            quantity: 2, marketProductId: "market-product", marketOptionId: "market-option",
            sourcingStatus: "MATCHED", internalWorkStatus: "PREPARING", version: "3",
        },
        mapping: {
            id: "mapping", mappingRevision: 1, orderItemVersion: "3",
            marketAccountId: "account", mappingRuleId: "rule", ruleRevisionSnapshot: 1,
            sourceProductId: "product", sourceOptionId: "option",
            sourceProductVersionSnapshot: "p1", sourceOptionVersionSnapshot: "s1",
            productVerificationSnapshot: "SERVER_VERIFIED",
            optionVerificationSnapshot: "SERVER_VERIFIED",
            externalSkuIdSnapshot: "sku-1", optionAttributesSnapshot: { color: "black" },
            optionLabelKoSnapshot: null, optionLabelZhSnapshot: null,
            unitPriceCnySnapshot: "10.00", stockStatusSnapshot: "AVAILABLE",
            stockQuantitySnapshot: 10, minimumQuantitySnapshot: 1,
            quantityStepSnapshot: 1, chinaShippingStatusSnapshot: "CONFIRMED",
            chinaShippingCnySnapshot: "5.00", quantityMultiplier: 2,
            sourceCheckedAtSnapshot: "2026-07-10T03:05:00.000Z",
        },
        product: {
            saleStatus: "ACTIVE", restrictionStatus: "CLEAR",
            customsRequirement: "FORMAT_VALID", sourceVersion: "p1",
            verificationProvenance: "SERVER_VERIFIED",
            lastCheckedAt: "2026-07-10T03:05:00.000Z",
        },
        option: {
            externalSkuId: "sku-1", unitPriceCny: "10.00",
            stockStatus: "AVAILABLE", stockQuantity: 10,
            minimumQuantity: 1, quantityStep: 1,
            chinaShippingStatus: "CONFIRMED", chinaShippingCny: "5.00",
            sourceVersion: "s1", verificationProvenance: "SERVER_VERIFIED",
            lastCheckedAt: "2026-07-10T03:05:00.000Z",
            ...overrides,
        },
        recipient: null,
    };
}

describe("sourcing mapping freshness", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("validates exact SKU, price, stock, and quantity", () => {
        expect(evaluateMappingFreshness({
            context: context(), now: NOW, maximumAgeSeconds: 900,
        })).toMatchObject({ status: "VALID", sourceQuantity: 4, reasons: [] });
    });

    it("requires a refresh after the maximum age", () => {
        const value = context({ lastCheckedAt: "2026-07-10T02:00:00.000Z" });
        value.product.lastCheckedAt = "2026-07-10T02:00:00.000Z";
        expect(evaluateMappingFreshness({
            context: value, now: NOW, maximumAgeSeconds: 900,
        })).toMatchObject({ status: "STALE", reasons: ["SOURCE_SNAPSHOT_STALE"] });
    });

    it("reports a price change instead of silently updating the draft", () => {
        expect(evaluateMappingFreshness({
            context: context({ unitPriceCny: "11.00" }), now: NOW, maximumAgeSeconds: 900,
        })).toMatchObject({ status: "STALE", reasons: ["PRICE_CHANGED"] });
    });

    it("blocks an out-of-stock exact SKU", () => {
        expect(evaluateMappingFreshness({
            context: context({ stockStatus: "OUT_OF_STOCK", stockQuantity: 0 }),
            now: NOW, maximumAgeSeconds: 900,
        })).toMatchObject({ status: "BLOCKED" });
    });

    it("blocks quantities that violate the seller step", () => {
        expect(evaluateMappingFreshness({
            context: context({ minimumQuantity: 1, quantityStep: 2 }),
            now: NOW, maximumAgeSeconds: 900,
        })).toMatchObject({ status: "BLOCKED", reasons: ["QUANTITY_STEP_MISMATCH"] });
    });

    it("blocks browser/operator snapshots until a trusted server verifies them", () => {
        const value = context();
        value.product.verificationProvenance = "MANUAL_UNVERIFIED";
        value.option.verificationProvenance = "MANUAL_UNVERIFIED";
        expect(evaluateMappingFreshness({
            context: value, now: NOW, maximumAgeSeconds: 900,
        })).toMatchObject({
            status: "BLOCKED",
            reasons: ["SOURCE_SERVER_VERIFICATION_REQUIRED"],
        });
    });
});

describe("sourcing mapping state guard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("rejects an ON_HOLD order before changing its sourcing mapping", async () => {
        repositoryMocks.lockSourcingOrderItem.mockResolvedValue({
            ...context().item,
            internalWorkStatus: "ON_HOLD",
        });

        await expect(saveSourcingMapping(
            {} as TransactionClient,
            {
                tenantId: "tenant",
                orderItemId: "item",
                membershipId: "member",
                correlationId: "correlation",
                expectedOrderItemVersion: "3",
            } as SaveMappingInput,
        )).rejects.toMatchObject({
            status: 409,
            code: "SOURCING_ORDER_ON_HOLD",
        });
        expect(repositoryMocks.getActiveMapping).not.toHaveBeenCalled();
        expect(repositoryMocks.insertMapping).not.toHaveBeenCalled();
    });
});
