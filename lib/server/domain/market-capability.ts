export const MARKET_CAPABILITY_ACTIONS = [
  "ORDER_CONFIRM",
  "INVOICE_SUBMIT",
  "INVOICE_CORRECT",
  "DIRECT_DELIVERY",
  "SELLER_CANCEL",
  "CANCEL_CLAIM",
  "RETURN_CLAIM",
  "EXCHANGE_CLAIM",
] as const;

export type MarketCapabilityAction =
  (typeof MARKET_CAPABILITY_ACTIONS)[number];

export const MARKET_CAPABILITY_MODES = [
  "API",
  "MANUAL_FALLBACK",
  "UNSUPPORTED",
] as const;

export type MarketCapabilityMode =
  (typeof MARKET_CAPABILITY_MODES)[number];

export type CapabilityUatStatus = "NOT_RUN" | "PASSED" | "FAILED";

export interface MarketCapability {
  readonly action: MarketCapabilityAction;
  readonly mode: MarketCapabilityMode;
  readonly officialDocumentReviewedAt: string | null;
  readonly uatStatus: CapabilityUatStatus;
  readonly note: string | null;
}

export type CapabilityExecutionDecision =
  | {
      readonly execution: "API";
      readonly reason: "API_CAPABILITY_CONFIRMED";
    }
  | {
      readonly execution: "MANUAL_FALLBACK";
      readonly reason: "MANUAL_PROCESS_REQUIRED";
    }
  | {
      readonly execution: "UNSUPPORTED";
      readonly reason: "CAPABILITY_NOT_CONFIGURED" | "EXPLICITLY_UNSUPPORTED";
    };

/**
 * Resolves a configured capability to an execution path.
 * Missing/unknown capability data fails closed and is never treated as API support.
 */
export function decideCapabilityExecution(
  capability: MarketCapability | undefined,
): CapabilityExecutionDecision {
  if (!capability) {
    return {
      execution: "UNSUPPORTED",
      reason: "CAPABILITY_NOT_CONFIGURED",
    };
  }

  if (capability.mode === "API") {
    return {
      execution: "API",
      reason: "API_CAPABILITY_CONFIRMED",
    };
  }

  if (capability.mode === "MANUAL_FALLBACK") {
    return {
      execution: "MANUAL_FALLBACK",
      reason: "MANUAL_PROCESS_REQUIRED",
    };
  }

  return {
    execution: "UNSUPPORTED",
    reason: "EXPLICITLY_UNSUPPORTED",
  };
}
