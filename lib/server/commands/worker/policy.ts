import { createHash } from "node:crypto";
import type {
    IntegrationFailure,
    IntegrationResult,
} from "@/lib/server/integrations/core";
import type {
    NaverBatchOperationResult,
    NaverProductOrderDetail,
    NaverSellerCancelReason,
} from "@/lib/server/integrations/naver";
import { NAVER_SELLER_CANCEL_REASONS } from "@/lib/server/integrations/naver";
import { classifyOutboundFailure } from "@/lib/server/application/retry-policy";
import { guardOrderItemTransition, type OrderItemState } from "@/lib/server/domain/order-item";
import {
    directDeliveryPayloadSchema,
    invoiceSubmitPayloadSchema,
    orderConfirmPayloadSchema,
    sellerCancelPayloadSchema,
} from "@/lib/server/commands/schemas";
import type {
    NaverCommandFinalization,
    NaverCommandOrderItem,
    NaverOutboundCommandType,
} from "@/lib/server/commands/worker/types";

export type ParsedNaverCommandPayload =
    | { type: "ORDER_CONFIRM"; payload: Record<string, never> }
    | {
        type: "INVOICE_SUBMIT";
        payload: {
            carrierCode: string;
            trackingNumber: string;
            dispatchAt: string;
        };
    }
    | { type: "DIRECT_DELIVERY"; payload: { dispatchAt: string } }
    | {
        type: "SELLER_CANCEL";
        payload: {
            reasonCode: NaverSellerCancelReason;
            reasonDetail?: string;
            quantity?: number;
        };
    };

export type ProviderTargetInspection =
    | { state: "APPLIED"; providerStatus: string }
    | { state: "NOT_APPLIED"; providerStatus: string }
    | { state: "CONFLICT"; providerStatus: string; code: string }
    | { state: "INDETERMINATE"; providerStatus: string; code: string };

export type NaverPreconditionResult =
    | { ok: true }
    | { ok: false; code: string; message: string };

export type NaverSuccessPatch =
    | {
        ok: true;
        confirmedAt: string | null;
        marketInvoiceSubmittedAt: string | null;
        marketDeliveryMethod: "DELIVERY" | "DIRECT_DELIVERY" | null;
        marketFulfillmentStatus: string | null;
        internalWorkStatus: NaverCommandOrderItem["internalWorkStatus"];
    }
    | {
        ok: false;
        code: "LOCAL_INVARIANT_CONFLICT";
        violations: readonly string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedText(value: unknown): string | null {
    return typeof value === "string" && value.trim()
        ? value.trim().toUpperCase()
        : null;
}

function positiveSafeInteger(value: unknown): number | null {
    return Number.isSafeInteger(value) && (value as number) > 0
        ? value as number
        : null;
}

function nonnegativeSafeInteger(value: unknown): number | null {
    return Number.isSafeInteger(value) && (value as number) >= 0
        ? value as number
        : null;
}

function isNaverSellerCancelReason(
    value: string,
): value is NaverSellerCancelReason {
    return (NAVER_SELLER_CANCEL_REASONS as readonly string[]).includes(value);
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!isRecord(value)) return value;

    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .filter((key) => value[key] !== undefined)
            .map((key) => [key, canonicalize(value[key])]),
    );
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

function maskedTrackingNumber(value: unknown): string | null {
    if (typeof value !== "string" || !value) return null;
    const suffix = value.slice(-4);
    return `${"*".repeat(Math.max(4, value.length - suffix.length))}${suffix}`;
}

export function buildNaverAttemptIdentity(input: {
    commandId: string;
    type: string;
    productOrderId: string | null;
    payload: Record<string, unknown>;
}): { requestSha256: string; requestSummary: Record<string, unknown> } {
    const request = {
        market: "NAVER",
        commandId: input.commandId,
        commandType: input.type,
        productOrderId: input.productOrderId,
        payload: input.payload,
    };
    const requestSha256 = createHash("sha256")
        .update(canonicalJson(request), "utf8")
        .digest("hex");

    const summaryPayload = input.type === "INVOICE_SUBMIT"
        ? {
            carrierCode: input.payload.carrierCode,
            trackingNumberMasked: maskedTrackingNumber(input.payload.trackingNumber),
            dispatchAt: input.payload.dispatchAt,
        }
        : input.type === "DIRECT_DELIVERY"
            ? { dispatchAt: input.payload.dispatchAt }
            : input.type === "SELLER_CANCEL"
                ? {
                    reasonCode: input.payload.reasonCode,
                    quantity: input.payload.quantity,
                }
                : {};

    return {
        requestSha256,
        requestSummary: {
            market: "NAVER",
            commandType: input.type,
            productOrderId: input.productOrderId,
            payload: summaryPayload,
        },
    };
}

export function parseNaverCommandPayload(
    type: string,
    payload: Record<string, unknown>,
): ParsedNaverCommandPayload | null {
    if (type === "ORDER_CONFIRM") {
        const parsed = orderConfirmPayloadSchema.safeParse(payload);
        return parsed.success
            ? { type, payload: parsed.data as Record<string, never> }
            : null;
    }
    if (type === "INVOICE_SUBMIT") {
        const parsed = invoiceSubmitPayloadSchema.safeParse(payload);
        return parsed.success ? { type, payload: parsed.data } : null;
    }
    if (type === "DIRECT_DELIVERY") {
        const parsed = directDeliveryPayloadSchema.safeParse(payload);
        return parsed.success ? { type, payload: parsed.data } : null;
    }
    if (type === "SELLER_CANCEL") {
        const parsed = sellerCancelPayloadSchema.safeParse(payload);
        if (!parsed.success || !isNaverSellerCancelReason(parsed.data.reasonCode)) {
            return null;
        }
        return {
            type,
            payload: {
                ...parsed.data,
                reasonCode: parsed.data.reasonCode,
            },
        };
    }
    return null;
}

function providerFields(detail: NaverProductOrderDetail) {
    const productOrder = detail.productOrder;
    const containers = [detail, productOrder].filter(isRecord);
    const currentClaim = containers
        .map((container) => container.currentClaim)
        .find(isRecord);
    const fallbackRecord = (key: "cancel" | "return" | "exchange") => currentClaim
        ? null
        : containers.map((container) => container[key]).find(isRecord) ?? null;
    const currentCancel = isRecord(currentClaim?.cancel)
        ? currentClaim.cancel
        : fallbackRecord("cancel");
    const currentReturn = isRecord(currentClaim?.return)
        ? currentClaim.return
        : fallbackRecord("return");
    const currentExchange = isRecord(currentClaim?.exchange)
        ? currentClaim.exchange
        : fallbackRecord("exchange");
    const completedClaims = containers.flatMap((container) => (
        Array.isArray(container.completedClaims)
            ? container.completedClaims.filter(isRecord)
            : []
    ));
    const completedCancelEvidence = completedClaims.some((claim) => {
        const type = normalizedText(claim.claimType);
        const status = normalizedText(claim.claimStatus);
        return type === "CANCEL"
            || type === "ADMIN_CANCEL"
            || (type === null && /CANCEL/.test(status ?? ""));
    });
    const inferredClaimType = currentCancel
        ? "CANCEL"
        : currentReturn
            ? "RETURN"
            : currentExchange
                ? "EXCHANGE"
                : null;
    const currentClaimStatus = normalizedText(
        currentCancel?.claimStatus
        ?? currentReturn?.claimStatus
        ?? currentExchange?.claimStatus,
    );
    const legacyClaimType = normalizedText(productOrder.claimType);
    const legacyClaimStatus = normalizedText(productOrder.claimStatus);
    const legacyCancelEvidence = legacyClaimType === "CANCEL"
        || legacyClaimType === "ADMIN_CANCEL"
        || /CANCEL/.test(legacyClaimStatus ?? "");
    const initialQuantity = positiveSafeInteger(productOrder.initialQuantity)
        ?? positiveSafeInteger(productOrder.quantity);
    const remainingQuantity = nonnegativeSafeInteger(productOrder.remainQuantity)
        ?? (completedClaims.length === 0
            ? nonnegativeSafeInteger(productOrder.quantity)
            : null);
    return {
        productOrderStatus: normalizedText(productOrder.productOrderStatus) ?? "UNKNOWN",
        placeOrderStatus: normalizedText(productOrder.placeOrderStatus),
        deliveryMethod: normalizedText(productOrder.deliveryMethod),
        carrierCode: normalizedText(productOrder.deliveryCompanyCode),
        trackingNumber: typeof productOrder.trackingNumber === "string"
            ? productOrder.trackingNumber.trim()
            : null,
        claimType: legacyClaimType ?? inferredClaimType,
        claimStatus: legacyClaimStatus ?? currentClaimStatus,
        hasCurrentCancelEvidence: currentCancel !== null || legacyCancelEvidence,
        hasCompletedCancelEvidence: completedCancelEvidence,
        initialQuantity,
        remainingQuantity,
    };
}

function providerHasClaim(fields: ReturnType<typeof providerFields>): boolean {
    const inactiveClaimValues = new Set(["NONE", "NO_CLAIM", "NOT_REQUESTED"]);
    return fields.claimType !== null && !inactiveClaimValues.has(fields.claimType)
        || fields.claimStatus !== null && !inactiveClaimValues.has(fields.claimStatus)
        || /CANCEL|RETURN|EXCHANGE|CLAIM|HOLDBACK/.test(fields.productOrderStatus);
}

function providerIsDispatched(status: string): boolean {
    return /DELIVERING|DELIVERED|PURCHASE_DECIDED|DISPATCH/.test(status);
}

function providerIsConfirmed(fields: ReturnType<typeof providerFields>): boolean {
    return fields.placeOrderStatus !== null
        && ["OK", "CONFIRMED", "PLACE_ORDER"].includes(fields.placeOrderStatus)
        || providerIsDispatched(fields.productOrderStatus);
}

export function inspectNaverProviderTarget(
    command: ParsedNaverCommandPayload,
    detail: NaverProductOrderDetail,
): ProviderTargetInspection {
    const fields = providerFields(detail);

    if (command.type === "SELLER_CANCEL") {
        if (fields.productOrderStatus === "CANCELED") {
            return { state: "APPLIED", providerStatus: fields.productOrderStatus };
        }
        if (fields.hasCurrentCancelEvidence || fields.hasCompletedCancelEvidence) {
            // Until a pre-write claim baseline is persisted, current and completed
            // cancellation records cannot be attributed to this command safely.
            // This includes CANCEL_REJECT: it proves a request existed and must
            // never be interpreted as permission to issue another cancellation.
            return {
                state: "INDETERMINATE",
                providerStatus: fields.productOrderStatus,
                code: "PROVIDER_CANCEL_CAUSALITY_UNPROVEN",
            };
        }
        if (providerHasClaim(fields)) {
            return {
                state: "CONFLICT",
                providerStatus: fields.productOrderStatus,
                code: "PROVIDER_CLAIM_CONFLICT",
            };
        }
        if (["PAYED", "PAID"].includes(fields.productOrderStatus)) {
            return { state: "NOT_APPLIED", providerStatus: fields.productOrderStatus };
        }
        return {
            state: "CONFLICT",
            providerStatus: fields.productOrderStatus,
            code: "SELLER_CANCEL_STATE_CONFLICT",
        };
    }

    if (providerHasClaim(fields)) {
        return {
            state: "CONFLICT",
            providerStatus: fields.productOrderStatus,
            code: "PROVIDER_CLAIM_CONFLICT",
        };
    }

    if (command.type === "ORDER_CONFIRM") {
        return providerIsConfirmed(fields)
            ? { state: "APPLIED", providerStatus: fields.productOrderStatus }
            : { state: "NOT_APPLIED", providerStatus: fields.productOrderStatus };
    }

    if (!providerIsDispatched(fields.productOrderStatus)) {
        return { state: "NOT_APPLIED", providerStatus: fields.productOrderStatus };
    }

    if (command.type === "DIRECT_DELIVERY") {
        if (fields.deliveryMethod === "DIRECT_DELIVERY" || fields.deliveryMethod === "DIRECT") {
            return { state: "APPLIED", providerStatus: fields.productOrderStatus };
        }
        return {
            state: fields.deliveryMethod === null ? "INDETERMINATE" : "CONFLICT",
            providerStatus: fields.productOrderStatus,
            code: fields.deliveryMethod === null
                ? "PROVIDER_DELIVERY_METHOD_MISSING"
                : "PROVIDER_DELIVERY_METHOD_CONFLICT",
        };
    }

    const expectedCarrier = command.payload.carrierCode.toUpperCase();
    const carrierMatches = fields.carrierCode === expectedCarrier;
    const trackingMatches = fields.trackingNumber === command.payload.trackingNumber;
    if (carrierMatches && trackingMatches) {
        return { state: "APPLIED", providerStatus: fields.productOrderStatus };
    }
    if (fields.carrierCode === null || fields.trackingNumber === null) {
        return {
            state: "INDETERMINATE",
            providerStatus: fields.productOrderStatus,
            code: "PROVIDER_INVOICE_DETAILS_MISSING",
        };
    }
    return {
        state: "CONFLICT",
        providerStatus: fields.productOrderStatus,
        code: "PROVIDER_INVOICE_CONFLICT",
    };
}

export function hasCompletedLocalPurchase(item: NaverCommandOrderItem): boolean {
    return item.sourcingStatus === "INVOICE_RECEIVED"
        || item.sourcingStatus === "EXTERNAL_PURCHASE";
}

export function hasLocalDomesticInvoice(item: NaverCommandOrderItem): boolean {
    return Boolean(item.domesticCarrierCode?.trim() && item.domesticTrackingNumber?.trim());
}

function capabilityIsApi(
    capabilities: Record<string, unknown>,
    action: string,
): boolean {
    const configured = capabilities[action];
    return isRecord(configured)
        && configured.mode === "API"
        && (action !== "SELLER_CANCEL" || configured.uatStatus === "PASSED");
}

export function validateNaverCommandPreconditions(input: {
    command: ParsedNaverCommandPayload;
    expectedVersion: number | null;
    accountActive: boolean;
    accountAuthStatus: string;
    accountCapabilities: Record<string, unknown>;
    item: NaverCommandOrderItem | null;
    detail: NaverProductOrderDetail;
}): NaverPreconditionResult {
    const { command, item } = input;
    if (!item) {
        return { ok: false, code: "ORDER_ITEM_NOT_FOUND", message: "The order item is unavailable." };
    }
    if (!input.accountActive || input.accountAuthStatus !== "CONNECTED") {
        return { ok: false, code: "MARKET_ACCOUNT_NOT_CONNECTED", message: "The market account is unavailable." };
    }
    if (!capabilityIsApi(input.accountCapabilities, command.type)) {
        return { ok: false, code: "MARKET_CAPABILITY_NOT_API", message: "The write capability is not enabled." };
    }
    if (input.expectedVersion === null || item.version !== input.expectedVersion) {
        return { ok: false, code: "STALE_ORDER_ITEM_VERSION", message: "The order item version changed." };
    }
    if (!item.externalOrderItemId?.trim()) {
        return { ok: false, code: "EXTERNAL_ORDER_ITEM_ID_MISSING", message: "The marketplace item ID is missing." };
    }
    if (item.internalWorkStatus === "CANCELED" || item.internalWorkStatus === "ON_HOLD") {
        return { ok: false, code: "LOCAL_ORDER_STATE_CONFLICT", message: "The local order state blocks the command." };
    }

    const fields = providerFields(input.detail);
    if (providerHasClaim(fields)) {
        return { ok: false, code: "PROVIDER_CLAIM_CONFLICT", message: "A marketplace claim blocks the command." };
    }

    if (command.type === "ORDER_CONFIRM") {
        if (!["PAYED", "PAID"].includes(fields.productOrderStatus)) {
            return { ok: false, code: "ORDER_CONFIRM_STATE_CONFLICT", message: "The marketplace order is not awaiting confirmation." };
        }
        return { ok: true };
    }

    if (command.type === "SELLER_CANCEL") {
        const providerInitialQuantity = fields.initialQuantity;
        const providerRemainingQuantity = fields.remainingQuantity;
        if (providerInitialQuantity === null) {
            return { ok: false, code: "PROVIDER_INITIAL_QUANTITY_MISSING", message: "The provider initial quantity is unavailable." };
        }
        if (providerRemainingQuantity === null) {
            return { ok: false, code: "PROVIDER_REMAINING_QUANTITY_MISSING", message: "The provider remaining quantity is unavailable." };
        }
        if (providerRemainingQuantity > providerInitialQuantity) {
            return { ok: false, code: "PROVIDER_REMAINING_QUANTITY_INVALID", message: "The provider remaining quantity exceeds the initial quantity." };
        }
        if (providerRemainingQuantity === 0) {
            return { ok: false, code: "PROVIDER_REMAINING_QUANTITY_EMPTY", message: "The provider has no remaining quantity to cancel." };
        }
        if (item.quantity !== providerInitialQuantity) {
            return { ok: false, code: "ORDER_QUANTITY_MISMATCH", message: "The local and provider order quantities differ." };
        }
        // An omitted quantity means all currently remaining units. The client
        // still omits cancelQuantity from the actual Naver request body.
        const requestedQuantity = command.payload.quantity ?? providerRemainingQuantity;
        if (requestedQuantity > providerRemainingQuantity) {
            return { ok: false, code: "CANCEL_QUANTITY_EXCEEDS_REMAINING", message: "The cancellation quantity exceeds the provider remaining quantity." };
        }
        if (!["PAYED", "PAID"].includes(fields.productOrderStatus)) {
            return { ok: false, code: "SELLER_CANCEL_STATE_CONFLICT", message: "The marketplace order cannot be seller-canceled in its current state." };
        }
        return { ok: true };
    }

    if (!item.confirmedAt && !providerIsConfirmed(fields)) {
        return { ok: false, code: "ORDER_NOT_CONFIRMED", message: "The order must be confirmed before dispatch." };
    }
    if (!["PREPARING", "READY_TO_SHIP"].includes(item.internalWorkStatus)) {
        return { ok: false, code: "DISPATCH_STATE_CONFLICT", message: "The local order is not dispatchable." };
    }

    const purchaseCompleted = hasCompletedLocalPurchase(item);
    const hasInvoice = hasLocalDomesticInvoice(item);
    if (command.type === "INVOICE_SUBMIT") {
        if (!purchaseCompleted || !hasInvoice) {
            return { ok: false, code: "PURCHASE_AND_INVOICE_REQUIRED", message: "Purchase and domestic invoice are required." };
        }
        if (
            item.domesticCarrierCode !== command.payload.carrierCode
            || item.domesticTrackingNumber !== command.payload.trackingNumber
        ) {
            return { ok: false, code: "DOMESTIC_INVOICE_MISMATCH", message: "The command invoice differs from the stored invoice." };
        }
    }
    if (command.type === "DIRECT_DELIVERY") {
        if (!purchaseCompleted && hasInvoice) {
            return { ok: false, code: "DIRECT_DELIVERY_INVARIANT_CONFLICT", message: "An invoice cannot precede a completed purchase." };
        }
        if (item.internalWorkStatus === "READY_TO_SHIP" && (!purchaseCompleted || !hasInvoice)) {
            return { ok: false, code: "READY_TO_SHIP_INVARIANT_CONFLICT", message: "READY_TO_SHIP requires purchase and invoice." };
        }
    }

    return { ok: true };
}

function safeCode(value: unknown, fallback: string): string {
    const text = typeof value === "string" ? value.toUpperCase() : "";
    return text.replace(/[^A-Z0-9_.-]/g, "_").slice(0, 100) || fallback;
}

export function classifyNaverIntegrationFailure(input: {
    failure: IntegrationFailure;
    phase: "READ" | "WRITE";
    attemptNumber: number;
    maxAttempts: number;
}): Omit<NaverCommandFinalization, "responseSummary"> {
    const error = input.failure.error;
    let observation: Parameters<typeof classifyOutboundFailure>[0];

    if (input.phase === "READ" && (error.kind === "timeout" || error.kind === "network" || error.kind === "aborted")) {
        observation = { kind: "NETWORK", requestMayHaveReachedProvider: false };
    } else if (input.phase === "WRITE" && (error.kind === "timeout" || error.kind === "aborted")) {
        observation = { kind: "TIMEOUT" };
    } else if (input.phase === "WRITE" && error.kind === "network") {
        observation = { kind: "NETWORK", requestMayHaveReachedProvider: true };
    } else if (error.httpStatus !== undefined) {
        observation = {
            kind: "HTTP",
            status: error.httpStatus,
            ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
        };
    } else if (input.phase === "WRITE" && error.kind === "unexpected_response") {
        observation = {
            kind: "PROVIDER",
            classification: "UNKNOWN",
            code: safeCode(error.code, "NAVER_UNEXPECTED_RESPONSE"),
        };
    } else {
        observation = {
            kind: "PROVIDER",
            classification: error.retryable ? "RETRYABLE" : "PERMANENT",
            code: safeCode(error.code, `NAVER_${error.kind}`),
            ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
        };
    }

    const decision = classifyOutboundFailure(observation, {
        attemptNumber: input.attemptNumber,
        maxAttempts: input.maxAttempts,
    });
    const code = safeCode(error.code, `NAVER_${error.kind}`);

    return {
        status: decision.nextStatus,
        attemptOutcome: decision.classification === "UNKNOWN"
            ? "UNKNOWN"
            : decision.classification === "RETRYABLE"
                ? "RETRYABLE"
                : "PERMANENT",
        code,
        message: decision.reason,
        ...(decision.retryAfterMs === null ? {} : { retryAfterMs: decision.retryAfterMs }),
        ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
    };
}

function batchDataFromFailure(failure: IntegrationFailure): NaverBatchOperationResult | null {
    const details = failure.error.details;
    if (!isRecord(details)) return null;
    const succeeded = details.succeededProductOrderIds;
    const failed = details.failedProductOrders;
    if (!Array.isArray(succeeded) || !Array.isArray(failed)) return null;
    return details as unknown as NaverBatchOperationResult;
}

export function resolveNaverBatchResult(input: {
    result: IntegrationResult<NaverBatchOperationResult>;
    productOrderId: string;
    attemptNumber: number;
    maxAttempts: number;
}):
    | { succeeded: true; httpStatus?: number; responseSummary: Record<string, unknown> }
    | { succeeded: false; resolution: NaverCommandFinalization } {
    const data = input.result.outcome === "failure"
        ? batchDataFromFailure(input.result)
        : input.result.data;
    const httpStatus = input.result.raw?.status;
    const itemFailure = data?.failedProductOrders.find(
        (failure) => failure.productOrderId === input.productOrderId,
    );
    const itemSucceeded = data?.succeededProductOrderIds.includes(input.productOrderId) === true;

    if (itemSucceeded && itemFailure) {
        return {
            succeeded: false,
            resolution: {
                status: "UNKNOWN",
                attemptOutcome: "UNKNOWN",
                code: "CONFLICTING_ITEM_RESULT",
                message: "PROVIDER_RESULT_UNKNOWN",
                responseSummary: {
                    provider: "NAVER",
                    productOrderId: input.productOrderId,
                    applied: "UNKNOWN",
                },
                ...(httpStatus === undefined ? {} : { httpStatus }),
            },
        };
    }

    if (itemSucceeded) {
        return {
            succeeded: true,
            ...(httpStatus === undefined ? {} : { httpStatus }),
            responseSummary: {
                provider: "NAVER",
                productOrderId: input.productOrderId,
                outcome: input.result.outcome,
                applied: true,
            },
        };
    }

    if (itemFailure?.code === "MISSING_ITEM_RESULT" || !data && input.result.outcome !== "failure") {
        const decision = classifyOutboundFailure({
            kind: "PROVIDER",
            classification: "UNKNOWN",
            code: "MISSING_ITEM_RESULT",
        }, {
            attemptNumber: input.attemptNumber,
            maxAttempts: input.maxAttempts,
        });
        return {
            succeeded: false,
            resolution: {
                status: decision.nextStatus,
                attemptOutcome: "UNKNOWN",
                code: "MISSING_ITEM_RESULT",
                message: decision.reason,
                responseSummary: {
                    provider: "NAVER",
                    productOrderId: input.productOrderId,
                    applied: "UNKNOWN",
                },
                ...(httpStatus === undefined ? {} : { httpStatus }),
            },
        };
    }

    if (itemFailure) {
        const decision = classifyOutboundFailure({
            kind: "PROVIDER",
            classification: itemFailure.retryable ? "RETRYABLE" : "PERMANENT",
            code: safeCode(itemFailure.code, "NAVER_ITEM_REJECTED"),
        }, {
            attemptNumber: input.attemptNumber,
            maxAttempts: input.maxAttempts,
        });
        return {
            succeeded: false,
            resolution: {
                status: decision.nextStatus,
                attemptOutcome: itemFailure.retryable ? "RETRYABLE" : "PERMANENT",
                code: safeCode(itemFailure.code, "NAVER_ITEM_REJECTED"),
                message: decision.reason,
                responseSummary: {
                    provider: "NAVER",
                    productOrderId: input.productOrderId,
                    applied: false,
                },
                ...(httpStatus === undefined ? {} : { httpStatus }),
            },
        };
    }

    if (input.result.outcome === "failure") {
        const classified = classifyNaverIntegrationFailure({
            failure: input.result,
            phase: "WRITE",
            attemptNumber: input.attemptNumber,
            maxAttempts: input.maxAttempts,
        });
        return {
            succeeded: false,
            resolution: {
                ...classified,
                responseSummary: {
                    provider: "NAVER",
                    productOrderId: input.productOrderId,
                    applied: classified.status === "UNKNOWN" ? "UNKNOWN" : false,
                },
            },
        };
    }

    return {
        succeeded: false,
        resolution: {
            status: "UNKNOWN",
            attemptOutcome: "UNKNOWN",
            code: "MISSING_ITEM_RESULT",
            message: "PROVIDER_RESULT_UNKNOWN",
            responseSummary: {
                provider: "NAVER",
                productOrderId: input.productOrderId,
                applied: "UNKNOWN",
            },
            ...(httpStatus === undefined ? {} : { httpStatus }),
        },
    };
}

function purchaseAxis(item: NaverCommandOrderItem, now: string): OrderItemState["purchase"] {
    if (hasCompletedLocalPurchase(item)) {
        return {
            method: item.sourcingStatus === "EXTERNAL_PURCHASE" ? "EXTERNAL" : "SOURCING_LIFE",
            status: "PURCHASED",
            paidAt: now,
            purchasedAt: now,
        };
    }
    if (item.sourcingStatus === "PAID") {
        return { method: "SOURCING_LIFE", status: "PAID", paidAt: now, purchasedAt: null };
    }
    return { method: null, status: "NOT_STARTED", paidAt: null, purchasedAt: null };
}

function shipmentAxis(item: NaverCommandOrderItem, now: string): OrderItemState["shipment"] {
    if (hasLocalDomesticInvoice(item)) {
        return {
            invoiceStatus: "INVOICE_RECEIVED",
            domesticStatus: item.internalWorkStatus === "DELIVERED"
                ? "DELIVERED"
                : item.internalWorkStatus === "SHIPPING"
                    ? "IN_TRANSIT"
                    : "PREPARING",
            invoice: {
                carrierCode: item.domesticCarrierCode!,
                trackingNumber: item.domesticTrackingNumber!,
                receivedAt: now,
                source: item.sourcingStatus === "EXTERNAL_PURCHASE"
                    ? "EXTERNAL_SYSTEM"
                    : "SOURCING_LIFE",
            },
        };
    }
    return {
        invoiceStatus: "NOT_RECEIVED",
        domesticStatus: "NOT_STARTED",
        invoice: null,
    };
}

function fulfillmentStatus(item: NaverCommandOrderItem): OrderItemState["market"]["fulfillmentStatus"] {
    const value = normalizedText(item.marketFulfillmentStatus);
    const supported: OrderItemState["market"]["fulfillmentStatus"][] = [
        "PAYMENT_WAITING", "PAID", "ACKNOWLEDGED", "SHIPPING", "DELIVERED",
        "PURCHASE_CONFIRMED", "CANCELED", "UNKNOWN",
    ];
    return supported.includes(value as OrderItemState["market"]["fulfillmentStatus"])
        ? value as OrderItemState["market"]["fulfillmentStatus"]
        : "UNKNOWN";
}

function orderItemState(input: {
    item: NaverCommandOrderItem;
    now: string;
    commandId: string;
    submitted: boolean;
    deliveryMethod: "DELIVERY" | "DIRECT_DELIVERY" | null;
    internalWorkStatus: NaverCommandOrderItem["internalWorkStatus"];
}): OrderItemState {
    return {
        id: input.item.id,
        version: input.item.version,
        internalWorkStatus: input.internalWorkStatus,
        market: {
            rawStatus: input.item.marketStatusRaw,
            fulfillmentStatus: input.submitted ? "SHIPPING" : fulfillmentStatus(input.item),
            deliveryMethod: input.deliveryMethod ?? "NONE",
            submission: input.submitted
                ? {
                    status: "SUBMITTED",
                    succeededCommandId: input.commandId,
                    submittedAt: input.now,
                }
                : { status: "NOT_SUBMITTED" },
        },
        purchase: purchaseAxis(input.item, input.now),
        shipment: shipmentAxis(input.item, input.now),
        claim: { status: "NONE", activeClaimId: null, type: null },
    };
}

export function deriveNaverSuccessPatch(input: {
    type: NaverOutboundCommandType;
    item: NaverCommandOrderItem;
    commandId: string;
    now: string;
}): NaverSuccessPatch {
    const { item, type } = input;
    if (type === "ORDER_CONFIRM") {
        const advanced = /SHIPPING|DELIVERED|PURCHASE/.test(
            normalizedText(item.marketFulfillmentStatus) ?? "",
        );
        return {
            ok: true,
            confirmedAt: item.confirmedAt ?? input.now,
            marketInvoiceSubmittedAt: item.marketInvoiceSubmittedAt,
            marketDeliveryMethod: item.marketDeliveryMethod,
            marketFulfillmentStatus: advanced
                ? item.marketFulfillmentStatus
                : "ACKNOWLEDGED",
            internalWorkStatus: item.internalWorkStatus === "NEW"
                ? "PREPARING"
                : item.internalWorkStatus,
        };
    }

    if (type === "SELLER_CANCEL") {
        return {
            ok: true,
            confirmedAt: item.confirmedAt,
            marketInvoiceSubmittedAt: item.marketInvoiceSubmittedAt,
            marketDeliveryMethod: item.marketDeliveryMethod,
            marketFulfillmentStatus: "CANCEL_REQUESTED",
            internalWorkStatus: "ON_HOLD",
        };
    }

    const deliveryMethod = type === "INVOICE_SUBMIT"
        ? "DELIVERY" as const
        : "DIRECT_DELIVERY" as const;
    const canAdvance = hasCompletedLocalPurchase(item)
        && hasLocalDomesticInvoice(item)
        && ["PREPARING", "READY_TO_SHIP"].includes(item.internalWorkStatus);
    const nextInternalStatus = canAdvance ? "SHIPPING" : item.internalWorkStatus;
    const current = orderItemState({
        item,
        now: input.now,
        commandId: input.commandId,
        submitted: item.marketInvoiceSubmittedAt !== null,
        deliveryMethod: item.marketDeliveryMethod,
        internalWorkStatus: item.internalWorkStatus,
    });
    const next = orderItemState({
        item,
        now: input.now,
        commandId: input.commandId,
        submitted: true,
        deliveryMethod,
        internalWorkStatus: nextInternalStatus,
    });
    const guard = guardOrderItemTransition(current, next);
    if (!guard.allowed) {
        return {
            ok: false,
            code: "LOCAL_INVARIANT_CONFLICT",
            violations: guard.violations.map((violation) => violation.code),
        };
    }

    const providerAdvanced = /DELIVERED|PURCHASE/.test(
        normalizedText(item.marketFulfillmentStatus) ?? "",
    );
    return {
        ok: true,
        confirmedAt: item.confirmedAt ?? input.now,
        marketInvoiceSubmittedAt: item.marketInvoiceSubmittedAt ?? input.now,
        marketDeliveryMethod: deliveryMethod,
        marketFulfillmentStatus: providerAdvanced
            ? item.marketFulfillmentStatus
            : "SHIPPING",
        internalWorkStatus: nextInternalStatus,
    };
}
