import type { TransactionClient } from "@/lib/server/db";
import type { MappingValidationContext, PurchaseDraftRecord } from "@/lib/server/sourcing/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { preparePurchaseDraft } from "@/lib/server/sourcing/service";

const NOW = new Date("2026-07-10T03:10:00.000Z");

function context(): MappingValidationContext {
    return {
        item: {
            id: "item", marketAccountId: "account", salesOrderId: "order",
            quantity: 1, marketProductId: "market-product", marketOptionId: "market-option",
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
            optionLabelKoSnapshot: "검정", optionLabelZhSnapshot: "黑色",
            unitPriceCnySnapshot: "10.00", stockStatusSnapshot: "AVAILABLE",
            stockQuantitySnapshot: 10, minimumQuantitySnapshot: 1,
            quantityStepSnapshot: 1, chinaShippingStatusSnapshot: "CONFIRMED",
            chinaShippingCnySnapshot: "5.00", quantityMultiplier: 1,
            sourceCheckedAtSnapshot: "2026-07-10T03:05:00.000Z",
        },
        product: {
            saleStatus: "ACTIVE", restrictionStatus: "CLEAR",
            customsRequirement: "IDENTITY_VERIFIED", sourceVersion: "p1",
            verificationProvenance: "SERVER_VERIFIED",
            lastCheckedAt: "2026-07-10T03:05:00.000Z",
        },
        option: {
            externalSkuId: "sku-1", unitPriceCny: "10.00", stockStatus: "AVAILABLE",
            stockQuantity: 10, minimumQuantity: 1, quantityStep: 1,
            chinaShippingStatus: "CONFIRMED", chinaShippingCny: "5.00",
            sourceVersion: "s1", verificationProvenance: "SERVER_VERIFIED",
            lastCheckedAt: "2026-07-10T03:05:00.000Z",
        },
        recipient: {
            id: "recipient", recipientReady: true, hasCustomsCode: true,
            customsCodeFormatStatus: "FORMAT_VALID", customsIdentityStatus: "MATCHED",
            customsConsentAt: "2026-07-10T02:00:00.000Z",
            customsVerifiedAt: "2026-07-10T02:05:00.000Z",
        },
    };
}

function draft(status: PurchaseDraftRecord["status"]): PurchaseDraftRecord {
    return {
        id: "draft", orderItemId: "item", mappingId: "mapping", mappingRevision: 1,
        status, sourceQuantity: 1, externalSkuId: "sku-1",
        sourceVerificationProvenance: "SERVER_VERIFIED", unitPriceCny: "10.00",
        productSubtotalCny: "10.00", chinaShippingStatus: "CONFIRMED",
        chinaShippingCny: "5.00", exchangeRateKrwPerCny: "190.000000",
        exchangeRateSource: "BANK", exchangeRateObservedAt: NOW.toISOString(),
        productAmountKrw: 1900, chinaShippingAmountKrw: 950, agencyFeeKrw: 100,
        internationalShippingStatus: "ESTIMATED", internationalShippingAmountKrw: 500,
        customsTaxStatus: "NOT_APPLICABLE", customsTaxAmountKrw: null,
        otherFeeKrw: 0, discountKrw: 0, discountStatus: "CONFIRMED",
        knownCostTotalKrw: 3450,
        blockingReasons: [], warnings: ["PRE_PAYMENT_ONLY"],
        quoteExpiresAt: "2026-07-10T03:14:00.000Z", replayed: false,
        prePaymentOnly: true, purchaseSubmissionStatus: "NOT_SUBMITTED",
        paymentStatus: "NOT_STARTED", canSubmitPurchase: false,
        canCreatePaymentSession: false,
    };
}

function input() {
    return {
        tenantId: "tenant", orderItemId: "item", membershipId: "member",
        correlationId: "correlation", expectedOrderItemVersion: "3",
        expectedMappingRevision: 1, requestRevision: "request-1",
        exchangeRateKrwPerCny: "190.000000", exchangeRateSource: "BANK",
        exchangeRateObservedAt: NOW.toISOString(), quoteExpiresAt: "2026-07-10T03:14:00.000Z",
        agencyFeeKrw: 100,
        internationalShipping: { status: "ESTIMATED" as const, amountKrw: 500 },
        customsTax: { status: "NOT_APPLICABLE" as const, amountKrw: null },
        otherFeeKrw: 0, discountKrw: 0, discountStatus: "CONFIRMED" as const,
        forwarderStatus: "READY" as const,
        now: NOW, maximumFreshnessSeconds: 900,
    };
}

describe("purchase draft preparation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        repositoryMocks.findDraftByIdempotencyKey.mockResolvedValue(null);
        repositoryMocks.lockSourcingOrderItem.mockResolvedValue(context().item);
        repositoryMocks.loadMappingValidationContext.mockResolvedValue(context());
        repositoryMocks.insertPurchaseDraft.mockImplementation(async (_client, value) => {
            const result = draft(value.status);
            result.blockingReasons = value.blockingReasons;
            result.warnings = value.warnings;
            return result;
        });
    });

    it("creates only a READY_FOR_REVIEW pre-payment draft", async () => {
        const result = await preparePurchaseDraft({} as TransactionClient, input());
        expect(result).toMatchObject({
            status: "READY_FOR_REVIEW",
            prePaymentOnly: true,
            purchaseSubmissionStatus: "NOT_SUBMITTED",
            paymentStatus: "NOT_STARTED",
            canSubmitPurchase: false,
            canCreatePaymentSession: false,
        });
    });

    it("persists a blocked draft when customs or forwarder readiness is missing", async () => {
        const value = context();
        value.recipient!.customsIdentityStatus = "NOT_CHECKED";
        value.recipient!.customsVerifiedAt = null;
        repositoryMocks.loadMappingValidationContext.mockResolvedValue(value);
        const result = await preparePurchaseDraft({} as TransactionClient, {
            ...input(), forwarderStatus: "ACTION_REQUIRED",
        });
        expect(result.status).toBe("BLOCKED");
        expect(result.blockingReasons).toEqual(expect.arrayContaining([
            "PCCC_IDENTITY_NOT_VERIFIED",
            "PCCC_VERIFICATION_TIME_REQUIRED",
            "FORWARDER_INTEGRATION_NOT_READY",
        ]));
    });

    it("persists a blocked draft for a manual browser snapshot", async () => {
        const value = context();
        value.product.verificationProvenance = "MANUAL_UNVERIFIED";
        value.option.verificationProvenance = "MANUAL_UNVERIFIED";
        repositoryMocks.loadMappingValidationContext.mockResolvedValue(value);

        const result = await preparePurchaseDraft({} as TransactionClient, input());

        expect(result.status).toBe("BLOCKED");
        expect(result.blockingReasons).toContain("SOURCE_SERVER_VERIFICATION_REQUIRED");
    });

    it("rejects an ON_HOLD order before replaying or preparing a purchase draft", async () => {
        repositoryMocks.lockSourcingOrderItem.mockResolvedValue({
            ...context().item,
            internalWorkStatus: "ON_HOLD",
        });

        await expect(preparePurchaseDraft({} as TransactionClient, input()))
            .rejects.toMatchObject({
                status: 409,
                code: "SOURCING_ORDER_ON_HOLD",
            });
        expect(repositoryMocks.findDraftByIdempotencyKey).not.toHaveBeenCalled();
        expect(repositoryMocks.loadMappingValidationContext).not.toHaveBeenCalled();
        expect(repositoryMocks.insertPurchaseDraft).not.toHaveBeenCalled();
    });

    it("returns an exact idempotent replay after the ON_HOLD state guard", async () => {
        const existing = draft("READY_FOR_REVIEW");
        existing.replayed = true;
        // First call learns the generated key/fingerprint through the conflict-free path.
        await preparePurchaseDraft({} as TransactionClient, input());
        const inserted = repositoryMocks.insertPurchaseDraft.mock.calls[0][1];
        vi.clearAllMocks();
        repositoryMocks.findDraftByIdempotencyKey.mockResolvedValue({
            draft: existing,
            fingerprint: inserted.requestFingerprint,
        });

        await expect(preparePurchaseDraft({} as TransactionClient, input()))
            .resolves.toMatchObject({ id: "draft", replayed: true });
        expect(repositoryMocks.loadMappingValidationContext).not.toHaveBeenCalled();
        expect(repositoryMocks.insertPurchaseDraft).not.toHaveBeenCalled();
    });
});
