import { createHash } from "node:crypto";
import type { TransactionClient } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http/api-error";
import { calculateTransparentCosts } from "@/lib/server/sourcing/money";
import {
    findDraftByIdempotencyKey,
    getActiveMapping,
    insertMapping,
    insertPurchaseDraft,
    loadMappingValidationContext,
    lockSourcingOrderItem,
    upsertSourceOption,
    upsertSourceProduct,
} from "@/lib/server/sourcing/repository";
import type {
    MappingFreshnessReport,
    MappingValidationContext,
    PrepareDraftInput,
    PurchaseDraftRecord,
    SaveMappingInput,
    SavedSourcingMapping,
} from "@/lib/server/sourcing/types";

const DEFAULT_FRESHNESS_SECONDS = 900;

function requireSourcingOrderNotOnHold(item: { internalWorkStatus: string }): void {
    if (item.internalWorkStatus === "ON_HOLD") {
        throw new ApiError(
            409,
            "SOURCING_ORDER_ON_HOLD",
            "마켓 취소요청으로 처리 보류된 주문은 소싱을 진행할 수 없습니다.",
        );
    }
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value !== "object" || value === null) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => [key, canonicalize(record[key])]));
}

function sha256(value: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(canonicalize(value)), "utf8")
        .digest("hex");
}

export function configuredSourcingFreshnessSeconds(): number {
    const value = Number(process.env.SOURCING_FRESHNESS_MAX_SECONDS);
    return Number.isSafeInteger(value) && value > 0 && value <= 3_600
        ? value
        : DEFAULT_FRESHNESS_SECONDS;
}

function requireExpectedVersions(
    context: MappingValidationContext,
    orderItemVersion: string,
    mappingRevision: number,
): void {
    if (context.item.version !== orderItemVersion) {
        throw new ApiError(409, "ORDER_ITEM_VERSION_CONFLICT", "주문상품이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }
    if (context.mapping.mappingRevision !== mappingRevision) {
        throw new ApiError(409, "SOURCING_MAPPING_VERSION_CONFLICT", "소싱 매핑이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }
}

export function evaluateMappingFreshness(input: {
    context: MappingValidationContext;
    now: Date;
    maximumAgeSeconds: number;
}): MappingFreshnessReport {
    const { context } = input;
    const reasons: string[] = [];
    const sourceQuantity = context.item.quantity * context.mapping.quantityMultiplier;
    if (context.product.verificationProvenance !== "SERVER_VERIFIED"
        || context.option.verificationProvenance !== "SERVER_VERIFIED") {
        reasons.push("SOURCE_SERVER_VERIFICATION_REQUIRED");
    }
    if (!Number.isSafeInteger(sourceQuantity) || sourceQuantity <= 0
        || sourceQuantity > 2_147_483_647) {
        reasons.push("INVALID_SOURCE_QUANTITY");
    }
    const checkedAtMs = Math.min(
        Date.parse(context.product.lastCheckedAt),
        Date.parse(context.option.lastCheckedAt),
    );
    if (!Number.isFinite(checkedAtMs)
        || input.now.getTime() - checkedAtMs > input.maximumAgeSeconds * 1_000) {
        reasons.push("SOURCE_SNAPSHOT_STALE");
    }
    if (context.product.sourceVersion !== context.mapping.sourceProductVersionSnapshot) {
        reasons.push("PRODUCT_VERSION_CHANGED");
    }
    if (context.option.sourceVersion !== context.mapping.sourceOptionVersionSnapshot) {
        reasons.push("SKU_VERSION_CHANGED");
    }
    if (context.option.externalSkuId !== context.mapping.externalSkuIdSnapshot) {
        reasons.push("EXACT_SKU_CHANGED");
    }
    if (context.option.unitPriceCny !== context.mapping.unitPriceCnySnapshot) {
        reasons.push("PRICE_CHANGED");
    }
    if (context.product.saleStatus !== "ACTIVE") reasons.push("PRODUCT_UNAVAILABLE");
    if (context.product.restrictionStatus === "PROHIBITED") reasons.push("RESTRICTED_ITEM");
    if (context.product.restrictionStatus === "REVIEW_REQUIRED") reasons.push("IMPORT_REVIEW_REQUIRED");
    if (context.option.stockStatus === "OUT_OF_STOCK") reasons.push("SKU_OUT_OF_STOCK");
    if (context.option.stockStatus === "UNKNOWN") reasons.push("STOCK_UNKNOWN");
    if (context.option.stockQuantity !== null && context.option.stockQuantity < sourceQuantity) {
        reasons.push("INSUFFICIENT_STOCK");
    }
    if (sourceQuantity < context.option.minimumQuantity) reasons.push("MINIMUM_QUANTITY_NOT_MET");
    if (sourceQuantity >= context.option.minimumQuantity
        && (sourceQuantity - context.option.minimumQuantity) % context.option.quantityStep !== 0) {
        reasons.push("QUANTITY_STEP_MISMATCH");
    }
    if (context.option.chinaShippingStatus === "UNKNOWN") {
        reasons.push("CHINA_SHIPPING_COST_UNKNOWN");
    }

    const staleReasons = new Set([
        "SOURCE_SNAPSHOT_STALE", "PRODUCT_VERSION_CHANGED", "SKU_VERSION_CHANGED",
        "EXACT_SKU_CHANGED", "PRICE_CHANGED",
    ]);
    const status = reasons.length === 0
        ? "VALID"
        : reasons.some((reason) => !staleReasons.has(reason))
            ? "BLOCKED"
            : "STALE";
    return {
        status,
        reasons,
        sourceQuantity,
        checkedAt: Number.isFinite(checkedAtMs) ? new Date(checkedAtMs).toISOString() : "INVALID",
        maximumAgeSeconds: input.maximumAgeSeconds,
        mappingRevision: context.mapping.mappingRevision,
        currentUnitPriceCny: context.option.unitPriceCny,
        currentStockStatus: context.option.stockStatus,
        currentStockQuantity: context.option.stockQuantity,
    };
}

export async function saveSourcingMapping(
    client: TransactionClient,
    input: SaveMappingInput,
): Promise<SavedSourcingMapping> {
    const item = await lockSourcingOrderItem(client, input.tenantId, input.orderItemId);
    if (!item) throw new ApiError(404, "ORDER_ITEM_NOT_FOUND", "주문상품을 찾을 수 없습니다.");
    requireSourcingOrderNotOnHold(item);
    if (item.version !== input.expectedOrderItemVersion) {
        throw new ApiError(409, "ORDER_ITEM_VERSION_CONFLICT", "주문상품이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }
    if (["PAID", "INVOICE_RECEIVED", "EXTERNAL_PURCHASE"].includes(item.sourcingStatus)) {
        throw new ApiError(409, "SOURCING_MAPPING_LOCKED", "구매가 진행된 주문상품은 소싱 매핑을 변경할 수 없습니다.");
    }
    if (["CANCELED", "DELIVERED"].includes(item.internalWorkStatus)) {
        throw new ApiError(409, "SOURCING_MAPPING_NOT_ALLOWED", "현재 주문 단계에서는 소싱 매핑을 변경할 수 없습니다.");
    }
    const previous = await getActiveMapping(client, input.tenantId, input.orderItemId, true);
    if (previous && input.expectedMappingRevision === undefined) {
        throw new ApiError(409, "SOURCING_MAPPING_ALREADY_EXISTS", "기존 매핑의 revision을 지정해 주세요.");
    }
    if (!previous && input.expectedMappingRevision !== undefined) {
        throw new ApiError(409, "SOURCING_MAPPING_NOT_FOUND", "수정할 기존 매핑이 없습니다.");
    }
    if (previous && previous.mappingRevision !== input.expectedMappingRevision) {
        throw new ApiError(409, "SOURCING_MAPPING_VERSION_CONFLICT", "소싱 매핑이 변경되었습니다.");
    }
    const nowWithSkew = Date.now() + 300_000;
    if (Date.parse(input.sourceProduct.lastCheckedAt) > nowWithSkew
        || Date.parse(input.sourceOption.lastCheckedAt) > nowWithSkew) {
        throw new ApiError(400, "SOURCE_CHECK_TIME_INVALID", "가격·재고 확인시각이 미래입니다.");
    }
    const product = await upsertSourceProduct(client, input);
    if (!product) throw new ApiError(409, "STALE_SOURCE_PRODUCT_SNAPSHOT", "더 최신인 상품 정보가 이미 저장되어 있습니다.");
    const option = await upsertSourceOption(client, input, product.id);
    if (!option) throw new ApiError(409, "STALE_SOURCE_OPTION_SNAPSHOT", "더 최신인 SKU 정보가 이미 저장되어 있습니다.");
    return insertMapping(client, input, item, product, option, previous);
}

export async function validateSourcingMapping(
    client: TransactionClient,
    input: {
        tenantId: string;
        orderItemId: string;
        expectedOrderItemVersion: string;
        expectedMappingRevision: number;
        maximumAgeSeconds?: number;
        now: Date;
    },
): Promise<MappingFreshnessReport> {
    const context = await loadMappingValidationContext(client, input.tenantId, input.orderItemId, false);
    if (!context) throw new ApiError(404, "SOURCING_MAPPING_NOT_FOUND", "활성 소싱 매핑을 찾을 수 없습니다.");
    requireExpectedVersions(context, input.expectedOrderItemVersion, input.expectedMappingRevision);
    const configured = configuredSourcingFreshnessSeconds();
    return evaluateMappingFreshness({
        context,
        now: input.now,
        maximumAgeSeconds: Math.min(configured, input.maximumAgeSeconds ?? configured),
    });
}

function customsBlockingReasons(context: MappingValidationContext): string[] {
    const recipient = context.recipient;
    if (context.product.customsRequirement === "NOT_REQUIRED") return [];
    const reasons: string[] = [];
    if (!recipient?.hasCustomsCode) reasons.push("PCCC_REQUIRED");
    if (recipient?.customsCodeFormatStatus !== "FORMAT_VALID") reasons.push("PCCC_FORMAT_NOT_VALID");
    if (!recipient?.customsConsentAt) reasons.push("PCCC_CONSENT_REQUIRED");
    if (context.product.customsRequirement === "IDENTITY_VERIFIED"
        && recipient?.customsIdentityStatus !== "MATCHED") {
        reasons.push("PCCC_IDENTITY_NOT_VERIFIED");
    }
    if (context.product.customsRequirement === "IDENTITY_VERIFIED"
        && !recipient?.customsVerifiedAt) {
        reasons.push("PCCC_VERIFICATION_TIME_REQUIRED");
    }
    return reasons;
}

export async function preparePurchaseDraft(
    client: TransactionClient,
    input: PrepareDraftInput,
): Promise<PurchaseDraftRecord> {
    const idempotencyKey = `sourcing-draft:v1:${sha256({
        tenantId: input.tenantId,
        orderItemId: input.orderItemId,
        mappingRevision: input.expectedMappingRevision,
        requestRevision: input.requestRevision,
    })}`;
    const requestFingerprint = sha256({
        expectedOrderItemVersion: input.expectedOrderItemVersion,
        expectedMappingRevision: input.expectedMappingRevision,
        requestRevision: input.requestRevision,
        exchangeRateKrwPerCny: input.exchangeRateKrwPerCny,
        exchangeRateSource: input.exchangeRateSource,
        exchangeRateObservedAt: input.exchangeRateObservedAt,
        quoteExpiresAt: input.quoteExpiresAt,
        agencyFeeKrw: input.agencyFeeKrw,
        internationalShipping: input.internationalShipping,
        customsTax: input.customsTax,
        otherFeeKrw: input.otherFeeKrw,
        discountKrw: input.discountKrw,
        discountStatus: input.discountStatus,
        forwarderStatus: input.forwarderStatus,
        userNote: input.userNote,
    });
    const item = await lockSourcingOrderItem(client, input.tenantId, input.orderItemId);
    if (!item) throw new ApiError(404, "ORDER_ITEM_NOT_FOUND", "주문상품을 찾을 수 없습니다.");
    requireSourcingOrderNotOnHold(item);
    const existing = await findDraftByIdempotencyKey(client, input.tenantId, idempotencyKey);
    if (existing) {
        if (existing.fingerprint !== requestFingerprint) {
            throw new ApiError(409, "PURCHASE_DRAFT_IDEMPOTENCY_CONFLICT", "같은 request revision이 다른 견적에 사용되었습니다.");
        }
        return existing.draft;
    }

    const context = await loadMappingValidationContext(client, input.tenantId, input.orderItemId, true);
    if (!context) throw new ApiError(404, "SOURCING_MAPPING_NOT_FOUND", "활성 소싱 매핑을 찾을 수 없습니다.");
    const raced = await findDraftByIdempotencyKey(client, input.tenantId, idempotencyKey);
    if (raced) {
        if (raced.fingerprint !== requestFingerprint) {
            throw new ApiError(409, "PURCHASE_DRAFT_IDEMPOTENCY_CONFLICT", "같은 request revision이 다른 견적에 사용되었습니다.");
        }
        return raced.draft;
    }
    requireExpectedVersions(context, input.expectedOrderItemVersion, input.expectedMappingRevision);
    const freshness = evaluateMappingFreshness({
        context,
        now: input.now,
        maximumAgeSeconds: input.maximumFreshnessSeconds,
    });
    if (freshness.reasons.includes("INVALID_SOURCE_QUANTITY")) {
        throw new ApiError(422, "INVALID_SOURCE_QUANTITY", "소싱 구매수량이 지원 범위를 벗어났습니다.");
    }
    const blockingReasons = [...freshness.reasons];
    const warnings = [
        "PRE_PAYMENT_ONLY",
        "EXTERNAL_FORWARDER_HANDLES_INTERNATIONAL_SHIPPING",
        "CUSTOMS_AND_TAX_MAY_BE_CHARGED_SEPARATELY",
    ];
    if (!context.recipient?.recipientReady) blockingReasons.push("RECIPIENT_INFORMATION_REQUIRED");
    blockingReasons.push(...customsBlockingReasons(context));
    if (input.forwarderStatus !== "READY") blockingReasons.push("FORWARDER_INTEGRATION_NOT_READY");
    if (input.internationalShipping.status === "UNKNOWN") {
        blockingReasons.push("INTERNATIONAL_SHIPPING_COST_UNKNOWN");
    } else if (input.internationalShipping.status === "PAY_LATER") {
        warnings.push("INTERNATIONAL_SHIPPING_PAY_LATER");
    }
    if (input.customsTax.status === "UNKNOWN") {
        blockingReasons.push("CUSTOMS_TAX_UNKNOWN");
    } else if (input.customsTax.status === "PAY_LATER") {
        warnings.push("CUSTOMS_TAX_PAY_LATER");
    }
    if (context.option.chinaShippingStatus === "ESTIMATED") {
        warnings.push("CHINA_SHIPPING_ESTIMATED");
    }
    if (input.discountStatus === "ESTIMATED") warnings.push("DISCOUNT_ESTIMATED");
    const observedAt = Date.parse(input.exchangeRateObservedAt);
    const expiresAt = Date.parse(input.quoteExpiresAt);
    if (observedAt > input.now.getTime() + 300_000
        || input.now.getTime() - observedAt > 3_600_000) {
        blockingReasons.push("EXCHANGE_RATE_STALE");
    }
    if (expiresAt <= input.now.getTime() || expiresAt > input.now.getTime() + 3_600_000) {
        blockingReasons.push("QUOTE_EXPIRY_INVALID");
    }
    const sourceFreshUntil = Date.parse(freshness.checkedAt)
        + input.maximumFreshnessSeconds * 1_000;
    if (!Number.isFinite(sourceFreshUntil) || expiresAt > sourceFreshUntil) {
        blockingReasons.push("QUOTE_EXCEEDS_SOURCE_FRESHNESS");
    }
    const uniqueBlockingReasons = [...new Set(blockingReasons)];
    let costs;
    try {
        costs = calculateTransparentCosts({
            unitPriceCny: context.option.unitPriceCny,
            sourceQuantity: freshness.sourceQuantity,
            chinaShippingCny: context.option.chinaShippingCny,
            exchangeRateKrwPerCny: input.exchangeRateKrwPerCny,
            agencyFeeKrw: input.agencyFeeKrw,
            internationalShippingAmountKrw: input.internationalShipping.amountKrw,
            customsTaxAmountKrw: input.customsTax.amountKrw,
            otherFeeKrw: input.otherFeeKrw,
            discountKrw: input.discountKrw,
        });
    } catch (error) {
        throw new ApiError(400, "COST_CALCULATION_INVALID", "비용 구성값을 확인해 주세요.", {
            reason: error instanceof Error ? error.message : "INVALID_COST",
        });
    }
    return insertPurchaseDraft(client, {
        tenantId: input.tenantId,
        membershipId: input.membershipId,
        correlationId: input.correlationId,
        context,
        status: uniqueBlockingReasons.length === 0 ? "READY_FOR_REVIEW" : "BLOCKED",
        sourceQuantity: freshness.sourceQuantity,
        productSubtotalCny: costs.productSubtotalCny,
        exchangeRateKrwPerCny: input.exchangeRateKrwPerCny,
        exchangeRateSource: input.exchangeRateSource,
        exchangeRateObservedAt: input.exchangeRateObservedAt,
        productAmountKrw: costs.productAmountKrw,
        chinaShippingAmountKrw: costs.chinaShippingAmountKrw,
        agencyFeeKrw: input.agencyFeeKrw,
        internationalShippingStatus: input.internationalShipping.status,
        internationalShippingAmountKrw: input.internationalShipping.amountKrw,
        customsTaxStatus: input.customsTax.status,
        customsTaxAmountKrw: input.customsTax.amountKrw,
        otherFeeKrw: input.otherFeeKrw,
        discountKrw: input.discountKrw,
        discountStatus: input.discountStatus,
        knownCostTotalKrw: costs.knownCostTotalKrw,
        forwarderStatus: input.forwarderStatus,
        blockingReasons: uniqueBlockingReasons,
        warnings: [...new Set(warnings)],
        requestRevision: input.requestRevision,
        idempotencyKey,
        requestFingerprint,
        quoteExpiresAt: input.quoteExpiresAt,
        userNote: input.userNote,
    });
}
