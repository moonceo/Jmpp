import { createHash } from "node:crypto";

export const OUTBOUND_COMMAND_STATUSES = [
  "PENDING",
  "LEASED",
  "SUCCEEDED",
  "RETRY",
  "UNKNOWN",
  "FAILED",
  "DEAD",
  "CANCELED",
] as const;

export type OutboundCommandStatus =
  (typeof OUTBOUND_COMMAND_STATUSES)[number];

export const OUTBOUND_COMMAND_TYPES = [
  "ORDER_CONFIRM",
  "SELLER_CANCEL",
  "INVOICE_SUBMIT",
  "INVOICE_CORRECT",
  "DIRECT_DELIVERY",
  "SHIPPING_PROCESS",
  "CANCEL_APPROVE",
  "CANCEL_REJECT",
  "RETURN_APPROVE",
  "RETURN_REJECT",
  "RETURN_HOLD",
  "RETURN_RELEASE",
  "RETURN_RECEIVE",
  "EXCHANGE_APPROVE",
  "EXCHANGE_REJECT",
  "EXCHANGE_HOLD",
  "EXCHANGE_RELEASE",
  "EXCHANGE_COLLECT",
  "EXCHANGE_RESHIP",
  "SOURCING_PURCHASE_REQUEST",
  "SOURCING_REFUND_REQUEST",
] as const;

export type OutboundCommandType = (typeof OUTBOUND_COMMAND_TYPES)[number];

export type OutboundAggregateType =
  | "ORDER_ITEM"
  | "CLAIM"
  | "SOURCING_PURCHASE";

export interface OutboundCommandAggregate {
  readonly type: OutboundAggregateType;
  readonly id: string;
  readonly expectedVersion: number;
}

export interface OutboundCommand<TPayload = unknown> {
  readonly id: string;
  readonly tenantId: string;
  readonly aggregate: OutboundCommandAggregate;
  readonly type: OutboundCommandType;
  readonly payload: TPayload;
  readonly idempotencyKey: string;
  readonly status: OutboundCommandStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt: string | null;
  readonly leaseOwner: string | null;
  readonly leaseUntil: string | null;
  readonly lastErrorCode: string | null;
  readonly requestedBy: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface OutboundCommandIdempotencyInput {
  readonly tenantId: string;
  readonly aggregateType: OutboundAggregateType;
  readonly aggregateId: string;
  readonly commandType: OutboundCommandType;
  /**
   * Stable business-effect identity, such as an invoice revision ID or claim
   * action version. Retries of the same intent must reuse this value.
   */
  readonly effectKey: string;
}

const ALLOWED_STATUS_TRANSITIONS: Readonly<
  Record<OutboundCommandStatus, readonly OutboundCommandStatus[]>
> = {
  PENDING: ["LEASED", "FAILED", "DEAD", "CANCELED"],
  LEASED: ["SUCCEEDED", "RETRY", "UNKNOWN", "FAILED", "DEAD"],
  SUCCEEDED: [],
  RETRY: ["LEASED", "FAILED", "DEAD", "CANCELED"],
  UNKNOWN: ["LEASED", "SUCCEEDED", "RETRY", "FAILED", "DEAD"],
  // A FAILED reconciliation may be reopened only by the audited admin service.
  // Ordinary execution code never leases FAILED directly.
  FAILED: ["UNKNOWN"],
  DEAD: [],
  CANCELED: [],
};

function requireNonBlank(value: string, fieldName: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new RangeError(`${fieldName} must not be blank`);
  }

  return normalized;
}

/**
 * Produces a deterministic, non-secret key for the same external business
 * effect. The payload itself is intentionally excluded; callers supply a
 * versioned effectKey so harmless serialization changes do not create a new
 * external action.
 */
export function createOutboundCommandIdempotencyKey(
  input: OutboundCommandIdempotencyInput,
): string {
  const material = [
    "v1",
    requireNonBlank(input.tenantId, "tenantId"),
    input.aggregateType,
    requireNonBlank(input.aggregateId, "aggregateId"),
    input.commandType,
    requireNonBlank(input.effectKey, "effectKey"),
  ].join("\u001f");

  const digest = createHash("sha256").update(material, "utf8").digest("hex");

  return `outbound:v1:${digest}`;
}

export function isOutboundCommandStatusTransitionAllowed(
  current: OutboundCommandStatus,
  next: OutboundCommandStatus,
): boolean {
  return current === next || ALLOWED_STATUS_TRANSITIONS[current].includes(next);
}
