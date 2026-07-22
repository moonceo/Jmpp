import type { InboundClaimSnapshotPayloadInput } from "@/lib/server/claims/schemas";
import type {
  ClaimFaultType,
  ClaimRequester,
  ClaimResolutionStatus,
  ClaimResolutionType,
  ClaimStatus,
  ClaimType,
} from "@/lib/server/claims/types";
import type {
  NaverChangedProductOrder,
  NaverProductOrderDetail,
} from "@/lib/server/integrations/naver";

type ClaimRecord = Record<string, unknown>;

interface ClaimCandidate {
  type: ClaimType;
  data: ClaimRecord;
}

export interface NaverClaimMappingIssue {
  code:
    | "MISSING_CLAIM_ID"
    | "INVALID_REQUEST_QUANTITY"
    | "UNSUPPORTED_CLAIM_TYPE";
  providerClaimType: string | null;
  providerClaimStatus: string | null;
}

export interface NaverClaimMappingResult {
  snapshots: InboundClaimSnapshotPayloadInput[];
  issues: NaverClaimMappingIssue[];
}

function isRecord(value: unknown): value is ClaimRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  const milliseconds = Date.parse(candidate);
  return Number.isNaN(milliseconds) ? null : new Date(milliseconds).toISOString();
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isInteger(number) && number > 0 ? number : null;
}

function claimType(value: unknown): ClaimType | null {
  const type = text(value)?.toUpperCase();
  if (type === "CANCEL" || type === "ADMIN_CANCEL") return "CANCEL";
  if (type === "RETURN") return "RETURN";
  if (type === "EXCHANGE") return "EXCHANGE";
  return null;
}

function normalizedStatus(rawValue: string | null, holdbackStatus: string | null): ClaimStatus {
  if (holdbackStatus === "HOLDBACK") return "ON_HOLD";
  switch (rawValue) {
    case "CANCEL_REQUEST":
    case "RETURN_REQUEST":
    case "EXCHANGE_REQUEST":
      return "REQUESTED";
    case "CANCELING":
    case "ADMIN_CANCELING":
      return "UNDER_REVIEW";
    case "COLLECTING":
      return "IN_TRANSIT";
    case "COLLECT_DONE":
      return "RECEIVED";
    case "EXCHANGE_REDELIVERING":
      return "REPLACEMENT_SHIPPED";
    case "CANCEL_DONE":
    case "RETURN_DONE":
    case "EXCHANGE_DONE":
    case "ADMIN_CANCEL_DONE":
      return "COMPLETED";
    case "CANCEL_REJECT":
    case "RETURN_REJECT":
    case "EXCHANGE_REJECT":
    case "ADMIN_CANCEL_REJECT":
      return "WITHDRAWN";
    default:
      return "ON_HOLD";
  }
}

function resolution(
  type: ClaimType,
  status: ClaimStatus,
): { type: ClaimResolutionType; status: ClaimResolutionStatus } {
  if (status === "WITHDRAWN" || status === "REJECTED") {
    return { type: "NO_ACTION", status: "NOT_REQUIRED" };
  }
  return {
    type: type === "EXCHANGE" ? "REPLACEMENT" : "REFUND",
    status: status === "COMPLETED" ? "SUCCEEDED" : "PENDING",
  };
}

function requester(channel: string | null, providerType: string | null): ClaimRequester {
  if (providerType === "ADMIN_CANCEL") return "MARKET";
  const normalized = channel?.toUpperCase() ?? "";
  if (normalized.includes("SELLER")) return "SELLER";
  if (normalized.includes("ADMIN") || normalized.includes("NAVER") || normalized.includes("SYSTEM")) {
    return "MARKET";
  }
  return "CUSTOMER";
}

const CUSTOMER_FAULT_REASONS = new Set([
  "INTENT_CHANGED",
  "COLOR_AND_SIZE",
  "WRONG_ORDER",
  "SIMPLE_INTENT_CHANGED",
  "MISTAKE_ORDER",
]);

const SELLER_FAULT_REASONS = new Set([
  "SOLD_OUT",
  "OUT_OF_STOCK",
  "SALE_INTENT_CHANGED",
]);

function fault(reason: string | null): ClaimFaultType {
  if (reason && CUSTOMER_FAULT_REASONS.has(reason)) return "CUSTOMER";
  if (reason && SELLER_FAULT_REASONS.has(reason)) return "SELLER";
  return "UNKNOWN";
}

function reasonFields(type: ClaimType, data: ClaimRecord) {
  const prefix = type === "CANCEL" ? "cancel" : type === "RETURN" ? "return" : "exchange";
  return {
    code: text(data[`${prefix}Reason`]) ?? text(data.claimRequestReason),
    detail: text(data[`${prefix}DetailedReason`]) ?? text(data.claimRequestDetailContent),
  };
}

function candidateContainers(detail: NaverProductOrderDetail): ClaimRecord[] {
  const detailRecord = detail as ClaimRecord;
  const productOrder = detail.productOrder as ClaimRecord;
  return [detailRecord, productOrder];
}

function collectCandidates(
  detail: NaverProductOrderDetail,
  issues: NaverClaimMappingIssue[],
): ClaimCandidate[] {
  const candidates: ClaimCandidate[] = [];
  const containers = candidateContainers(detail);
  const currentClaim = containers
    .map((container) => container.currentClaim)
    .find(isRecord);
  const keys = [
    ["cancel", "CANCEL"],
    ["return", "RETURN"],
    ["exchange", "EXCHANGE"],
  ] as const;

  if (currentClaim) {
    for (const [key, type] of keys) {
      const data = currentClaim[key];
      if (isRecord(data)) candidates.push({ type, data });
    }
  } else {
    // Compatibility only for providers that still return the deprecated nodes.
    for (const container of containers) {
      for (const [key, type] of keys) {
        const data = container[key];
        if (isRecord(data)) candidates.push({ type, data });
      }
    }
  }

  const completedClaims = containers
    .map((container) => container.completedClaims)
    .find(Array.isArray);
  for (const value of completedClaims ?? []) {
    if (!isRecord(value)) continue;
    const rawType = text(value.claimType);
    const type = claimType(rawType);
    if (!type) {
      // Purchase-decision holdbacks are not cancel/return/exchange claims.
      if (rawType && rawType !== "PURCHASE_DECISION_HOLDBACK") {
        issues.push({
          code: "UNSUPPORTED_CLAIM_TYPE",
          providerClaimType: rawType,
          providerClaimStatus: text(value.claimStatus),
        });
      }
      continue;
    }
    candidates.push({ type, data: value });
  }

  return candidates;
}

export function mapNaverClaimSnapshots(input: {
  change: NaverChangedProductOrder;
  detail: NaverProductOrderDetail;
  externalOrderId: string;
  externalOrderItemId: string;
  orderQuantity: number;
  sourceUpdatedAt: string;
}): NaverClaimMappingResult {
  const issues: NaverClaimMappingIssue[] = [];
  const snapshots: InboundClaimSnapshotPayloadInput[] = [];
  const seen = new Set<string>();
  const fallbackStatus = text(input.detail.productOrder.claimStatus)
    ?? text(input.change.claimStatus);
  const fallbackProviderType = text(input.detail.productOrder.claimType)
    ?? text(input.change.claimType);

  for (const candidate of collectCandidates(input.detail, issues)) {
    const externalClaimId = text(candidate.data.claimId);
    const marketStatusRaw = (text(candidate.data.claimStatus) ?? fallbackStatus ?? "UNKNOWN").toUpperCase();
    if (!externalClaimId) {
      issues.push({
        code: "MISSING_CLAIM_ID",
        providerClaimType: candidate.type,
        providerClaimStatus: marketStatusRaw,
      });
      continue;
    }
    const identity = `${candidate.type}:${externalClaimId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const rawRequestedQuantity = candidate.data.requestQuantity;
    const requestedQuantity = rawRequestedQuantity === undefined || rawRequestedQuantity === null
      ? input.orderQuantity
      : positiveInteger(rawRequestedQuantity);
    if (requestedQuantity === null || requestedQuantity > input.orderQuantity) {
      issues.push({
        code: "INVALID_REQUEST_QUANTITY",
        providerClaimType: candidate.type,
        providerClaimStatus: marketStatusRaw,
      });
      continue;
    }
    const status = normalizedStatus(
      marketStatusRaw,
      text(candidate.data.holdbackStatus)?.toUpperCase() ?? null,
    );
    const claimResolution = resolution(candidate.type, status);
    const reason = reasonFields(candidate.type, candidate.data);
    const requestChannel = text(candidate.data.requestChannel);
    const requestedAt = timestamp(candidate.data.claimRequestDate) ?? input.sourceUpdatedAt;
    const refundExpectedAt = timestamp(candidate.data.refundExpectedDate);
    const receivedAt = timestamp(candidate.data.collectCompletedDate)
      ?? (status === "RECEIVED" ? input.sourceUpdatedAt : null);
    const providerType = text(candidate.data.claimType) ?? fallbackProviderType;
    const terminalAt = status === "COMPLETED" || status === "WITHDRAWN"
      ? timestamp(candidate.data.cancelCompletedDate)
        ?? timestamp(candidate.data.returnCompletedDate)
        ?? timestamp(candidate.data.exchangeCompletedDate)
        ?? input.sourceUpdatedAt
      : null;

    snapshots.push({
      externalOrderId: input.externalOrderId,
      externalClaimId,
      externalEventId: null,
      claimType: candidate.type,
      source: "MARKET",
      requesterType: requester(requestChannel, providerType),
      faultType: fault(reason.code),
      normalizedStatus: status,
      marketStatusRaw,
      marketReasonCode: reason.code,
      rawMarketReason: reason.detail,
      providerProcessingId: null,
      providerErrorCode: null,
      rawSnapshotRef: null,
      deadlineAt: refundExpectedAt,
      deadlineType: refundExpectedAt ? "REFUND_EXPECTED_AT" : null,
      resolutionType: claimResolution.type,
      resolutionStatus: claimResolution.status,
      requestedAt,
      reviewedAt: status === "UNDER_REVIEW" ? input.sourceUpdatedAt : null,
      approvedAt: timestamp(candidate.data.cancelApprovalDate),
      rejectedAt: status === "WITHDRAWN" ? terminalAt : null,
      collectionStartedAt: status === "IN_TRANSIT" ? input.sourceUpdatedAt : null,
      receivedAt,
      resolvedAt: terminalAt,
      completedAt: status === "COMPLETED" ? terminalAt : null,
      sourceCreatedAt: requestedAt,
      sourceUpdatedAt: input.sourceUpdatedAt,
      lines: [{
        externalClaimLineId: null,
        externalOrderItemId: input.externalOrderItemId,
        requestedQuantity,
        normalizedStatus: status,
        marketStatusRaw,
        marketReasonCode: reason.code,
        rawMarketReason: reason.detail,
        resolutionType: claimResolution.type,
        resolutionStatus: claimResolution.status,
        refundAmount: null,
        refundCurrency: null,
      }],
    });
  }

  return { snapshots, issues };
}
