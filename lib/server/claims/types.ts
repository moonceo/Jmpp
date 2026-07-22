import type { OrderMarketCode } from "@/lib/server/repositories/orders";

export const CLAIM_TYPES = ["CANCEL", "RETURN", "EXCHANGE"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_SOURCES = ["MARKET", "SELLER", "INTERNAL"] as const;
export type ClaimSource = (typeof CLAIM_SOURCES)[number];

export const CLAIM_REQUESTERS = [
    "CUSTOMER", "SELLER", "MARKET", "INTERNAL", "UNKNOWN",
] as const;
export type ClaimRequester = (typeof CLAIM_REQUESTERS)[number];

export const CLAIM_FAULT_TYPES = [
    "CUSTOMER", "SELLER", "MARKET", "CARRIER", "SOURCING", "UNKNOWN",
] as const;
export type ClaimFaultType = (typeof CLAIM_FAULT_TYPES)[number];

export const CLAIM_STATUSES = [
    "REQUESTED",
    "UNDER_REVIEW",
    "APPROVAL_PENDING",
    "APPROVED",
    "REJECTED",
    "ON_HOLD",
    "COLLECTION_PENDING",
    "IN_TRANSIT",
    "RECEIVED",
    "REFUND_PENDING",
    "REFUNDED",
    "REPLACEMENT_PENDING",
    "REPLACEMENT_SHIPPED",
    "WITHDRAWN",
    "COMPLETED",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_RESOLUTION_TYPES = [
    "REFUND", "REPLACEMENT", "REJECT", "NO_ACTION",
] as const;
export type ClaimResolutionType = (typeof CLAIM_RESOLUTION_TYPES)[number];

export const CLAIM_RESOLUTION_STATUSES = [
    "UNDECIDED", "PENDING", "PARTIAL", "SUCCEEDED",
    "FAILED", "UNKNOWN", "NOT_REQUIRED",
] as const;
export type ClaimResolutionStatus = (typeof CLAIM_RESOLUTION_STATUSES)[number];

export const PURCHASE_COMPENSATION_STATUSES = [
    "NOT_REQUIRED", "PENDING", "IN_PROGRESS", "SUCCEEDED",
    "FAILED", "NEEDS_ATTENTION", "UNKNOWN",
] as const;
export type PurchaseCompensationStatus = (typeof PURCHASE_COMPENSATION_STATUSES)[number];

export const CLAIM_PROVIDER_ACTIONS = [
    "CANCEL_APPROVE",
    "CANCEL_REJECT",
    "CLAIM_WITHDRAW",
    "RETURN_APPROVE",
    "RETURN_REJECT",
    "RETURN_HOLD",
    "RETURN_RELEASE",
    "RETURN_RECEIVE",
    "EXCHANGE_APPROVE",
    "EXCHANGE_REJECT",
    "EXCHANGE_HOLD",
    "EXCHANGE_RELEASE",
    "EXCHANGE_RECEIVE",
    "EXCHANGE_DISPATCH",
] as const;
export type ClaimProviderAction = (typeof CLAIM_PROVIDER_ACTIONS)[number];

export interface ClaimActionAvailability {
    available: false;
    execution: "UNAVAILABLE";
    reason: "CLAIM_PROVIDER_WRITES_NOT_IMPLEMENTED";
}

export type ClaimActionAvailabilityMap = Record<ClaimProviderAction, ClaimActionAvailability>;

export interface PreparedInboundClaimLine {
    externalClaimLineId: string | null;
    externalOrderItemId: string;
    lineKey: string;
    requestedQuantity: number;
    normalizedStatus: ClaimStatus;
    marketStatusRaw: string;
    marketReasonCode: string | null;
    marketReasonEncrypted: string | null;
    marketReasonMasked: string | null;
    resolutionType: ClaimResolutionType | null;
    resolutionStatus: ClaimResolutionStatus;
    refundAmount: string | null;
    refundCurrency: string | null;
}

export interface PreparedInboundClaimSnapshot {
    tenantId: string;
    marketAccountId: string;
    externalOrderId: string;
    externalClaimId: string;
    externalEventId: string | null;
    dedupeKey: string;
    eventKey: string;
    payloadSha256: string;
    correlationId: string;
    claimType: ClaimType;
    source: ClaimSource;
    requesterType: ClaimRequester;
    faultType: ClaimFaultType;
    normalizedStatus: ClaimStatus;
    marketStatusRaw: string;
    marketReasonCode: string | null;
    marketReasonEncrypted: string | null;
    marketReasonMasked: string | null;
    providerProcessingId: string | null;
    providerErrorCode: string | null;
    rawSnapshotRef: string | null;
    deadlineAt: Date | null;
    deadlineType: string | null;
    resolutionType: ClaimResolutionType | null;
    resolutionStatus: ClaimResolutionStatus;
    requestedAt: Date;
    reviewedAt: Date | null;
    approvedAt: Date | null;
    rejectedAt: Date | null;
    collectionStartedAt: Date | null;
    receivedAt: Date | null;
    resolvedAt: Date | null;
    completedAt: Date | null;
    sourceCreatedAt: Date | null;
    sourceUpdatedAt: Date;
    lines: PreparedInboundClaimLine[];
}

export interface ClaimListQuery {
    limit: number;
    cursor?: string;
    claimType?: ClaimType;
    status?: ClaimStatus;
    requesterType?: ClaimRequester;
    marketAccountId?: string;
    deadlineBefore?: string;
    activeOnly?: boolean;
    search?: string;
}

export interface ClaimLineView {
    id: string;
    orderItemId: string;
    externalOrderItemId: string | null;
    externalClaimLineId: string | null;
    productName: string;
    optionName: string | null;
    orderedQuantity: number;
    requestedQuantity: number;
    itemStatusAtRequest: string;
    sourcingStatusAtRequest: string;
    fulfillmentStatusAtRequest: string | null;
    normalizedStatus: ClaimStatus;
    marketStatusRaw: string;
    marketReasonCode: string | null;
    marketReasonMasked: string | null;
    resolutionType: ClaimResolutionType | null;
    resolutionStatus: ClaimResolutionStatus;
    refundAmount: string | null;
    refundCurrency: string | null;
    version: string;
}

export interface ClaimListItem {
    id: string;
    marketAccountId: string;
    marketCode: OrderMarketCode;
    storeName: string;
    salesOrderId: string;
    externalOrderId: string;
    externalOrderNumber: string | null;
    externalClaimId: string;
    claimType: ClaimType;
    source: ClaimSource;
    requesterType: ClaimRequester;
    faultType: ClaimFaultType;
    normalizedStatus: ClaimStatus;
    marketStatusRaw: string;
    marketReasonCode: string | null;
    marketReasonMasked: string | null;
    deadlineAt: string | null;
    deadlineType: string | null;
    deadlineOverdue: boolean;
    resolutionType: ClaimResolutionType | null;
    resolutionStatus: ClaimResolutionStatus;
    purchaseCompensationStatus: PurchaseCompensationStatus;
    purchaseCompensationReference: string | null;
    purchaseCompensationNextActionAt: string | null;
    requestedAt: string;
    sourceUpdatedAt: string;
    buyerNameMasked: string | null;
    recipientNameMasked: string | null;
    affectedLineCount: number;
    totalClaimQuantity: number;
    version: string;
    actionAvailability: ClaimActionAvailabilityMap;
}

export interface ClaimEventView {
    id: string;
    externalEventId: string | null;
    eventType: string;
    eventSource: string;
    fromStatus: ClaimStatus | null;
    toStatus: ClaimStatus | null;
    marketStatusRaw: string | null;
    marketReasonCode: string | null;
    sourceOccurredAt: string | null;
    receivedAt: string;
}

export interface ClaimDetail extends ClaimListItem {
    providerProcessingId: string | null;
    providerErrorCode: string | null;
    rawSnapshotAvailable: boolean;
    orderStatusAtRequest: string;
    itemStatusAtRequest: string;
    sourcingStatusAtRequest: string;
    fulfillmentStatusAtRequest: string | null;
    reviewedAt: string | null;
    approvedAt: string | null;
    rejectedAt: string | null;
    collectionStartedAt: string | null;
    receivedAt: string | null;
    resolvedAt: string | null;
    completedAt: string | null;
    purchaseCompensationCompletedAt: string | null;
    lines: ClaimLineView[];
    events: ClaimEventView[];
    eventsTruncated: boolean;
}

export interface ClaimCursorPage {
    items: ClaimListItem[];
    nextCursor: string | null;
}

export interface InboundClaimUpsertResult {
    claimId: string;
    version: string;
    normalizedStatus: ClaimStatus;
    applied: boolean;
    replayed: boolean;
    ignoredReason: "DUPLICATE_EVENT" | "STALE_SNAPSHOT" | "SAME_TIMESTAMP_CONFLICT" | "INVALID_TRANSITION" | null;
}
