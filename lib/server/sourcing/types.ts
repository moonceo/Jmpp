import type {
    PreparePurchaseDraftBody,
    SaveSourcingMappingBody,
} from "@/lib/server/sourcing/schemas";

export interface SourcingOrderItemRow {
    id: string;
    marketAccountId: string;
    salesOrderId: string;
    quantity: number;
    marketProductId: string | null;
    marketOptionId: string | null;
    sourcingStatus: string;
    internalWorkStatus: string;
    version: string;
}

export interface StoredSourceProduct {
    id: string;
    sourceVersion: string;
    lastCheckedAt: string;
    verificationProvenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
}

export interface StoredSourceOption {
    id: string;
    sourceVersion: string;
    lastCheckedAt: string;
    verificationProvenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
}

export interface ActiveSourcingMapping {
    id: string;
    mappingRevision: number;
    orderItemVersion: string;
    marketAccountId: string;
    mappingRuleId: string | null;
    ruleRevisionSnapshot: number | null;
    sourceProductId: string;
    sourceOptionId: string;
    sourceProductVersionSnapshot: string;
    sourceOptionVersionSnapshot: string;
    productVerificationSnapshot: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
    optionVerificationSnapshot: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
    externalSkuIdSnapshot: string;
    optionAttributesSnapshot: Record<string, string>;
    optionLabelKoSnapshot: string | null;
    optionLabelZhSnapshot: string | null;
    unitPriceCnySnapshot: string;
    stockStatusSnapshot: string;
    stockQuantitySnapshot: number | null;
    minimumQuantitySnapshot: number;
    quantityStepSnapshot: number;
    chinaShippingStatusSnapshot: "CONFIRMED" | "ESTIMATED" | "UNKNOWN";
    chinaShippingCnySnapshot: string | null;
    quantityMultiplier: number;
    sourceCheckedAtSnapshot: string;
}

export interface MappingValidationContext {
    item: SourcingOrderItemRow;
    mapping: ActiveSourcingMapping;
    product: {
        saleStatus: string;
        restrictionStatus: "CLEAR" | "REVIEW_REQUIRED" | "PROHIBITED";
        customsRequirement: "NOT_REQUIRED" | "FORMAT_VALID" | "IDENTITY_VERIFIED";
        sourceVersion: string;
        verificationProvenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
        lastCheckedAt: string;
    };
    option: {
        externalSkuId: string;
        unitPriceCny: string;
        stockStatus: "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
        stockQuantity: number | null;
        minimumQuantity: number;
        quantityStep: number;
        chinaShippingStatus: "CONFIRMED" | "ESTIMATED" | "UNKNOWN";
        chinaShippingCny: string | null;
        sourceVersion: string;
        verificationProvenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
        lastCheckedAt: string;
    };
    recipient: {
        id: string;
        recipientReady: boolean;
        hasCustomsCode: boolean;
        customsCodeFormatStatus: "NOT_CHECKED" | "MISSING" | "FORMAT_VALID" | "INVALID";
        customsIdentityStatus: "NOT_CHECKED" | "MATCHED" | "MISMATCH" | "NOT_REQUIRED";
        customsConsentAt: string | null;
        customsVerifiedAt: string | null;
    } | null;
}

export interface SavedSourcingMapping {
    id: string;
    mappingRevision: number;
    orderItemId: string;
    orderItemVersion: string;
    sourceProductId: string;
    sourceOptionId: string;
    externalSkuId: string;
    selectedOption: Record<string, string>;
    unitPriceCny: string;
    sourceCheckedAt: string;
    quantityMultiplier: number;
    verificationProvenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
    mappingRuleId: string | null;
    ruleRevision: number | null;
}

export interface ReusableSourcingRule {
    id: string;
    ruleRevision: number;
    marketProductId: string;
    marketOptionId: string | null;
    sourceProductId: string;
    sourceOptionId: string;
    externalSkuId: string;
    quantityMultiplier: number;
    verificationProvenance: "SERVER_VERIFIED";
    approvalStatus: "APPROVED";
    approvedAt: string;
}

export interface MappingFreshnessReport {
    status: "VALID" | "STALE" | "BLOCKED";
    reasons: string[];
    sourceQuantity: number;
    checkedAt: string;
    maximumAgeSeconds: number;
    mappingRevision: number;
    currentUnitPriceCny: string;
    currentStockStatus: string;
    currentStockQuantity: number | null;
}

export interface PurchaseDraftRecord {
    id: string;
    orderItemId: string;
    mappingId: string;
    mappingRevision: number;
    status: "BLOCKED" | "READY_FOR_REVIEW" | "EXPIRED" | "SUPERSEDED";
    sourceQuantity: number;
    externalSkuId: string;
    sourceVerificationProvenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
    unitPriceCny: string;
    productSubtotalCny: string;
    chinaShippingStatus: string;
    chinaShippingCny: string | null;
    exchangeRateKrwPerCny: string;
    exchangeRateSource: string;
    exchangeRateObservedAt: string;
    productAmountKrw: number;
    chinaShippingAmountKrw: number | null;
    agencyFeeKrw: number;
    internationalShippingStatus: string;
    internationalShippingAmountKrw: number | null;
    customsTaxStatus: string;
    customsTaxAmountKrw: number | null;
    otherFeeKrw: number;
    discountKrw: number;
    discountStatus: "CONFIRMED" | "ESTIMATED";
    knownCostTotalKrw: number;
    blockingReasons: string[];
    warnings: string[];
    quoteExpiresAt: string;
    replayed: boolean;
    prePaymentOnly: true;
    purchaseSubmissionStatus: "NOT_SUBMITTED";
    paymentStatus: "NOT_STARTED";
    canSubmitPurchase: false;
    canCreatePaymentSession: false;
}

export interface SaveMappingInput extends SaveSourcingMappingBody {
    tenantId: string;
    orderItemId: string;
    membershipId: string;
    correlationId: string;
}

export interface PrepareDraftInput extends PreparePurchaseDraftBody {
    tenantId: string;
    orderItemId: string;
    membershipId: string;
    correlationId: string;
    now: Date;
    maximumFreshnessSeconds: number;
}
