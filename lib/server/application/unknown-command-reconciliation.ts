import type { OutboundCommandStatus } from "../domain/outbound-command";

export type ProviderReconciliationObservation =
  | {
      readonly kind: "TARGET_APPLIED";
      readonly providerReference: string | null;
    }
  | {
      readonly kind: "TARGET_NOT_APPLIED";
      readonly authoritative: boolean;
    }
  | {
      readonly kind: "CONFLICTING_STATE";
      readonly providerStatus: string;
    }
  | {
      readonly kind: "PROVIDER_UNAVAILABLE";
    }
  | {
      readonly kind: "INDETERMINATE";
    };

export type CommandPreconditionState = "SATISFIED" | "STALE" | "UNKNOWN";

export interface UnknownCommandReconciliationInput {
  readonly observation: ProviderReconciliationObservation;
  readonly preconditionState: CommandPreconditionState;
}

export interface UnknownCommandReconciliationDecision {
  readonly action:
    | "MARK_SUCCEEDED"
    | "RETRY_COMMAND"
    | "MARK_FAILED"
    | "KEEP_UNKNOWN";
  readonly nextStatus: Extract<
    OutboundCommandStatus,
    "SUCCEEDED" | "RETRY" | "FAILED" | "UNKNOWN"
  >;
  readonly requiresManualReview: boolean;
  readonly reason:
    | "TARGET_STATE_CONFIRMED"
    | "AUTHORITATIVE_ABSENCE_CONFIRMED"
    | "ABSENCE_NOT_AUTHORITATIVE"
    | "PRECONDITION_STALE"
    | "PRECONDITION_UNKNOWN"
    | "CONFLICTING_PROVIDER_STATE"
    | "PROVIDER_READ_UNAVAILABLE"
    | "PROVIDER_RESULT_INDETERMINATE";
}

/**
 * Decides the only safe next step for a command whose write result is UNKNOWN.
 * An identical write is never retried until an authoritative read proves that
 * the target effect was not applied and the original preconditions still hold.
 */
export function decideUnknownCommandReconciliation(
  input: UnknownCommandReconciliationInput,
): UnknownCommandReconciliationDecision {
  if (input.observation.kind === "TARGET_APPLIED") {
    return {
      action: "MARK_SUCCEEDED",
      nextStatus: "SUCCEEDED",
      requiresManualReview: false,
      reason: "TARGET_STATE_CONFIRMED",
    };
  }

  if (input.observation.kind === "PROVIDER_UNAVAILABLE") {
    return {
      action: "KEEP_UNKNOWN",
      nextStatus: "UNKNOWN",
      requiresManualReview: false,
      reason: "PROVIDER_READ_UNAVAILABLE",
    };
  }

  if (input.observation.kind === "INDETERMINATE") {
    return {
      action: "KEEP_UNKNOWN",
      nextStatus: "UNKNOWN",
      requiresManualReview: true,
      reason: "PROVIDER_RESULT_INDETERMINATE",
    };
  }

  if (input.observation.kind === "CONFLICTING_STATE") {
    return {
      action: "MARK_FAILED",
      nextStatus: "FAILED",
      requiresManualReview: true,
      reason: "CONFLICTING_PROVIDER_STATE",
    };
  }

  if (!input.observation.authoritative) {
    return {
      action: "KEEP_UNKNOWN",
      nextStatus: "UNKNOWN",
      requiresManualReview: false,
      reason: "ABSENCE_NOT_AUTHORITATIVE",
    };
  }

  if (input.preconditionState === "STALE") {
    return {
      action: "MARK_FAILED",
      nextStatus: "FAILED",
      requiresManualReview: true,
      reason: "PRECONDITION_STALE",
    };
  }

  if (input.preconditionState === "UNKNOWN") {
    return {
      action: "KEEP_UNKNOWN",
      nextStatus: "UNKNOWN",
      requiresManualReview: false,
      reason: "PRECONDITION_UNKNOWN",
    };
  }

  return {
    action: "RETRY_COMMAND",
    nextStatus: "RETRY",
    requiresManualReview: false,
    reason: "AUTHORITATIVE_ABSENCE_CONFIRMED",
  };
}
