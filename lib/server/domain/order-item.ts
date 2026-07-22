export const INTERNAL_WORK_STATUSES = [
  "NEW",
  "PREPARING",
  "READY_TO_SHIP",
  "SHIPPING",
  "DELIVERED",
  "ON_HOLD",
  "CANCELED",
] as const;

export type InternalWorkStatus = (typeof INTERNAL_WORK_STATUSES)[number];

export const MARKET_FULFILLMENT_STATUSES = [
  "PAYMENT_WAITING",
  "PAID",
  "ACKNOWLEDGED",
  "SHIPPING",
  "DELIVERED",
  "PURCHASE_CONFIRMED",
  "CANCELED",
  "UNKNOWN",
] as const;

export type MarketFulfillmentStatus =
  (typeof MARKET_FULFILLMENT_STATUSES)[number];

export type MarketDeliveryMethod = "NONE" | "DELIVERY" | "DIRECT_DELIVERY";

export type MarketFulfillmentSubmission =
  | {
      readonly status: "NOT_SUBMITTED";
    }
  | {
      readonly status: "PENDING";
      readonly commandId: string;
    }
  | {
      readonly status: "FAILED";
      readonly commandId: string;
      readonly errorCode: string | null;
    }
  | {
      readonly status: "SUBMITTED";
      /** ID of the outbound command whose status was confirmed SUCCEEDED. */
      readonly succeededCommandId: string;
      readonly submittedAt: string;
    };

export interface MarketOrderAxis {
  readonly rawStatus: string | null;
  readonly fulfillmentStatus: MarketFulfillmentStatus;
  readonly deliveryMethod: MarketDeliveryMethod;
  readonly submission: MarketFulfillmentSubmission;
}

export type PurchaseMethod = "SOURCING_LIFE" | "EXTERNAL";

export const PURCHASE_STATUSES = [
  "NOT_STARTED",
  "APPLICATION_SUBMITTED",
  "PAYMENT_PENDING",
  "PAID",
  "PURCHASED",
  "CANCEL_PENDING",
  "CANCELED",
  "REFUND_PENDING",
  "REFUNDED",
  "FAILED",
] as const;

export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export interface PurchaseAxis {
  readonly method: PurchaseMethod | null;
  readonly status: PurchaseStatus;
  readonly paidAt: string | null;
  /** Remains populated after a later cancellation/refund. */
  readonly purchasedAt: string | null;
}

export type DomesticInvoiceStatus = "NOT_RECEIVED" | "INVOICE_RECEIVED";

export type DomesticShipmentStatus =
  | "NOT_STARTED"
  | "PREPARING"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "EXCEPTION";

export interface DomesticInvoice {
  readonly carrierCode: string;
  readonly trackingNumber: string;
  readonly receivedAt: string;
  readonly source: "SOURCING_LIFE" | "OPERATOR" | "EXTERNAL_SYSTEM";
}

export interface ShipmentAxis {
  /** Kept separate from PurchaseAxis.status; PAID never implies this value. */
  readonly invoiceStatus: DomesticInvoiceStatus;
  readonly domesticStatus: DomesticShipmentStatus;
  readonly invoice: DomesticInvoice | null;
}

export type ClaimType = "CANCEL" | "RETURN" | "EXCHANGE";

export type ActiveClaimStatus =
  | "REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "ON_HOLD"
  | "COLLECTING"
  | "COLLECTED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "RESHIPPING"
  | "COMPLETED"
  | "WITHDRAWN";

export type ClaimAxis =
  | {
      readonly status: "NONE";
      readonly activeClaimId: null;
      readonly type: null;
    }
  | {
      readonly status: ActiveClaimStatus;
      readonly activeClaimId: string;
      readonly type: ClaimType;
    };

export interface OrderItemState {
  readonly id: string;
  readonly version: number;
  readonly internalWorkStatus: InternalWorkStatus;
  readonly market: MarketOrderAxis;
  readonly purchase: PurchaseAxis;
  readonly shipment: ShipmentAxis;
  readonly claim: ClaimAxis;
}

export type OrderItemInvariantViolationCode =
  | "INVOICE_STATUS_MISMATCH"
  | "INVOICE_FIELDS_REQUIRED"
  | "READY_TO_SHIP_REQUIRES_PURCHASE"
  | "READY_TO_SHIP_REQUIRES_INVOICE"
  | "READY_TO_SHIP_CANNOT_HAVE_SUBMITTED_DIRECT_DELIVERY"
  | "SHIPPING_REQUIRES_PURCHASE"
  | "SHIPPING_REQUIRES_INVOICE"
  | "SHIPPING_REQUIRES_MARKET_SUBMISSION"
  | "SHIPPING_REQUIRES_DELIVERY_METHOD"
  | "DIRECT_DELIVERY_PENDING_PURCHASE_MUST_REMAIN_PREPARING"
  | "DIRECT_DELIVERY_PENDING_PURCHASE_CANNOT_HAVE_INVOICE"
  | "DELIVERED_REQUIRES_DOMESTIC_DELIVERY"
  | "DELIVERED_REQUIRES_PURCHASE"
  | "DELIVERED_REQUIRES_INVOICE";

export interface OrderItemInvariantViolation {
  readonly code: OrderItemInvariantViolationCode;
  readonly message: string;
}

export type OrderItemTransitionViolation =
  | OrderItemInvariantViolation
  | {
      readonly code: "ILLEGAL_WORK_STATUS_TRANSITION";
      readonly message: string;
    };

export interface OrderItemTransitionDecision {
  readonly allowed: boolean;
  readonly violations: readonly OrderItemTransitionViolation[];
}

const ALLOWED_WORK_STATUS_TRANSITIONS: Readonly<
  Record<InternalWorkStatus, readonly InternalWorkStatus[]>
> = {
  NEW: ["PREPARING", "ON_HOLD", "CANCELED"],
  PREPARING: ["READY_TO_SHIP", "SHIPPING", "ON_HOLD", "CANCELED"],
  READY_TO_SHIP: ["SHIPPING", "ON_HOLD", "CANCELED"],
  SHIPPING: ["DELIVERED"],
  DELIVERED: [],
  ON_HOLD: [
    "NEW",
    "PREPARING",
    "READY_TO_SHIP",
    "SHIPPING",
    "CANCELED",
  ],
  CANCELED: [],
};

export function hasCompletedPurchase(purchase: PurchaseAxis): boolean {
  return purchase.method !== null && purchase.purchasedAt !== null;
}

export function hasValidDomesticInvoice(shipment: ShipmentAxis): boolean {
  if (shipment.invoiceStatus !== "INVOICE_RECEIVED" || !shipment.invoice) {
    return false;
  }

  return (
    shipment.invoice.carrierCode.trim().length > 0 &&
    shipment.invoice.trackingNumber.trim().length > 0 &&
    shipment.invoice.receivedAt.trim().length > 0
  );
}

function violation(
  code: OrderItemInvariantViolationCode,
  message: string,
): OrderItemInvariantViolation {
  return { code, message };
}

/** Validates cross-axis production invariants without mutating state. */
export function validateOrderItemState(
  state: OrderItemState,
): readonly OrderItemInvariantViolation[] {
  const violations: OrderItemInvariantViolation[] = [];
  const purchaseCompleted = hasCompletedPurchase(state.purchase);
  const validInvoice = hasValidDomesticInvoice(state.shipment);
  const submissionSucceeded = state.market.submission.status === "SUBMITTED";
  const directDeliverySubmitted =
    state.market.deliveryMethod === "DIRECT_DELIVERY" && submissionSucceeded;

  if (state.shipment.invoiceStatus === "NOT_RECEIVED" && state.shipment.invoice) {
    violations.push(
      violation(
        "INVOICE_STATUS_MISMATCH",
        "An invoice cannot exist while invoiceStatus is NOT_RECEIVED.",
      ),
    );
  }

  if (
    state.shipment.invoiceStatus === "INVOICE_RECEIVED" &&
    !validInvoice
  ) {
    violations.push(
      violation(
        "INVOICE_FIELDS_REQUIRED",
        "INVOICE_RECEIVED requires carrier, tracking number, and received time.",
      ),
    );
  }

  if (state.internalWorkStatus === "READY_TO_SHIP") {
    if (!purchaseCompleted) {
      violations.push(
        violation(
          "READY_TO_SHIP_REQUIRES_PURCHASE",
          "READY_TO_SHIP requires a completed purchase event.",
        ),
      );
    }

    if (!validInvoice) {
      violations.push(
        violation(
          "READY_TO_SHIP_REQUIRES_INVOICE",
          "READY_TO_SHIP requires a valid domestic invoice.",
        ),
      );
    }

    if (directDeliverySubmitted) {
      violations.push(
        violation(
          "READY_TO_SHIP_CANNOT_HAVE_SUBMITTED_DIRECT_DELIVERY",
          "A purchased and invoiced direct-delivery item must be SHIPPING.",
        ),
      );
    }
  }

  if (state.internalWorkStatus === "SHIPPING") {
    if (!purchaseCompleted) {
      violations.push(
        violation(
          "SHIPPING_REQUIRES_PURCHASE",
          "SHIPPING requires a completed purchase event.",
        ),
      );
    }

    if (!validInvoice) {
      violations.push(
        violation(
          "SHIPPING_REQUIRES_INVOICE",
          "SHIPPING requires a valid domestic invoice.",
        ),
      );
    }

    if (!submissionSucceeded) {
      violations.push(
        violation(
          "SHIPPING_REQUIRES_MARKET_SUBMISSION",
          "SHIPPING requires a confirmed successful market submission.",
        ),
      );
    }

    if (state.market.deliveryMethod === "NONE") {
      violations.push(
        violation(
          "SHIPPING_REQUIRES_DELIVERY_METHOD",
          "SHIPPING requires DELIVERY or DIRECT_DELIVERY.",
        ),
      );
    }
  }

  if (directDeliverySubmitted && !purchaseCompleted) {
    if (state.internalWorkStatus !== "PREPARING") {
      violations.push(
        violation(
          "DIRECT_DELIVERY_PENDING_PURCHASE_MUST_REMAIN_PREPARING",
          "Direct delivery alone must not advance an unpurchased item.",
        ),
      );
    }

    if (validInvoice) {
      violations.push(
        violation(
          "DIRECT_DELIVERY_PENDING_PURCHASE_CANNOT_HAVE_INVOICE",
          "An unpurchased direct-delivery item cannot have a domestic invoice.",
        ),
      );
    }
  }

  if (state.internalWorkStatus === "DELIVERED") {
    if (state.shipment.domesticStatus !== "DELIVERED") {
      violations.push(
        violation(
          "DELIVERED_REQUIRES_DOMESTIC_DELIVERY",
          "DELIVERED requires the actual domestic shipment to be delivered.",
        ),
      );
    }

    if (!purchaseCompleted) {
      violations.push(
        violation(
          "DELIVERED_REQUIRES_PURCHASE",
          "DELIVERED requires a completed purchase event.",
        ),
      );
    }

    if (!validInvoice) {
      violations.push(
        violation(
          "DELIVERED_REQUIRES_INVOICE",
          "DELIVERED requires a valid domestic invoice.",
        ),
      );
    }
  }

  return violations;
}

/**
 * Guards the internal workflow transition and every invariant of the proposed
 * next state. Claim updates remain on the separate claim axis.
 */
export function guardOrderItemTransition(
  current: OrderItemState,
  next: OrderItemState,
): OrderItemTransitionDecision {
  const violations: OrderItemTransitionViolation[] = [
    ...validateOrderItemState(next),
  ];
  const workStatusChanged =
    current.internalWorkStatus !== next.internalWorkStatus;

  if (
    workStatusChanged &&
    !ALLOWED_WORK_STATUS_TRANSITIONS[current.internalWorkStatus].includes(
      next.internalWorkStatus,
    )
  ) {
    violations.unshift({
      code: "ILLEGAL_WORK_STATUS_TRANSITION",
      message: `Cannot transition ${current.internalWorkStatus} to ${next.internalWorkStatus}.`,
    });
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}
