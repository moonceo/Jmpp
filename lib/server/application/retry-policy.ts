import type { OutboundCommandStatus } from "../domain/outbound-command";

export type OutboundFailureObservation =
  | {
      readonly kind: "TIMEOUT";
    }
  | {
      readonly kind: "NETWORK";
      readonly requestMayHaveReachedProvider: boolean;
    }
  | {
      readonly kind: "HTTP";
      readonly status: number;
      readonly retryAfterMs?: number;
      readonly credentialRefreshAvailable?: boolean;
      readonly credentialRefreshAlreadyAttempted?: boolean;
    }
  | {
      readonly kind: "PROVIDER";
      readonly classification: "RETRYABLE" | "PERMANENT" | "UNKNOWN";
      readonly code: string;
      readonly retryAfterMs?: number;
    }
  | {
      readonly kind: "UNSUPPORTED";
    };

export type OutboundFailureClassification =
  | "RETRYABLE"
  | "PERMANENT"
  | "UNKNOWN";

export interface RetryPolicyContext {
  /** One-based number of the attempt that just failed. */
  readonly attemptNumber: number;
  readonly maxAttempts: number;
}

export interface OutboundFailureDecision {
  readonly classification: OutboundFailureClassification;
  readonly nextStatus: Extract<
    OutboundCommandStatus,
    "RETRY" | "UNKNOWN" | "FAILED" | "DEAD"
  >;
  readonly shouldRetry: boolean;
  readonly reconcileBeforeRetry: boolean;
  readonly retryAfterMs: number | null;
  readonly reason:
    | "AUTH_REFRESH_AVAILABLE"
    | "RATE_LIMITED"
    | "TRANSIENT_HTTP_FAILURE"
    | "TRANSIENT_NETWORK_FAILURE"
    | "PROVIDER_RETRYABLE"
    | "RETRY_LIMIT_EXHAUSTED"
    | "TIMEOUT_RESULT_UNKNOWN"
    | "NETWORK_RESULT_UNKNOWN"
    | "HTTP_STATE_REQUIRES_RECONCILIATION"
    | "PROVIDER_RESULT_UNKNOWN"
    | "AUTHENTICATION_REQUIRED"
    | "PERMISSION_OR_IP_ERROR"
    | "PERMANENT_CLIENT_ERROR"
    | "PROVIDER_PERMANENT_FAILURE"
    | "CAPABILITY_UNSUPPORTED";
}

function validateContext(context: RetryPolicyContext): void {
  if (!Number.isInteger(context.attemptNumber) || context.attemptNumber < 1) {
    throw new RangeError("attemptNumber must be a positive integer");
  }

  if (!Number.isInteger(context.maxAttempts) || context.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
}

function retryableDecision(
  context: RetryPolicyContext,
  reason:
    | "AUTH_REFRESH_AVAILABLE"
    | "RATE_LIMITED"
    | "TRANSIENT_HTTP_FAILURE"
    | "TRANSIENT_NETWORK_FAILURE"
    | "PROVIDER_RETRYABLE",
  retryAfterMs: number | undefined,
): OutboundFailureDecision {
  if (context.attemptNumber >= context.maxAttempts) {
    return {
      classification: "RETRYABLE",
      nextStatus: "DEAD",
      shouldRetry: false,
      reconcileBeforeRetry: false,
      retryAfterMs: null,
      reason: "RETRY_LIMIT_EXHAUSTED",
    };
  }

  return {
    classification: "RETRYABLE",
    nextStatus: "RETRY",
    shouldRetry: true,
    reconcileBeforeRetry: false,
    retryAfterMs: retryAfterMs ?? null,
    reason,
  };
}

function unknownDecision(
  reason:
    | "TIMEOUT_RESULT_UNKNOWN"
    | "NETWORK_RESULT_UNKNOWN"
    | "HTTP_STATE_REQUIRES_RECONCILIATION"
    | "PROVIDER_RESULT_UNKNOWN",
): OutboundFailureDecision {
  return {
    classification: "UNKNOWN",
    nextStatus: "UNKNOWN",
    shouldRetry: false,
    reconcileBeforeRetry: true,
    retryAfterMs: null,
    reason,
  };
}

function permanentDecision(
  reason:
    | "AUTHENTICATION_REQUIRED"
    | "PERMISSION_OR_IP_ERROR"
    | "PERMANENT_CLIENT_ERROR"
    | "PROVIDER_PERMANENT_FAILURE"
    | "CAPABILITY_UNSUPPORTED",
): OutboundFailureDecision {
  return {
    classification: "PERMANENT",
    nextStatus: "FAILED",
    shouldRetry: false,
    reconcileBeforeRetry: false,
    retryAfterMs: null,
    reason,
  };
}

/** Classifies a failed write attempt without inspecting mutable global state. */
export function classifyOutboundFailure(
  observation: OutboundFailureObservation,
  context: RetryPolicyContext,
): OutboundFailureDecision {
  validateContext(context);

  if (observation.kind === "TIMEOUT") {
    return unknownDecision("TIMEOUT_RESULT_UNKNOWN");
  }

  if (observation.kind === "NETWORK") {
    return observation.requestMayHaveReachedProvider
      ? unknownDecision("NETWORK_RESULT_UNKNOWN")
      : retryableDecision(
          context,
          "TRANSIENT_NETWORK_FAILURE",
          undefined,
        );
  }

  if (observation.kind === "UNSUPPORTED") {
    return permanentDecision("CAPABILITY_UNSUPPORTED");
  }

  if (observation.kind === "PROVIDER") {
    if (observation.classification === "RETRYABLE") {
      return retryableDecision(
        context,
        "PROVIDER_RETRYABLE",
        observation.retryAfterMs,
      );
    }

    if (observation.classification === "UNKNOWN") {
      return unknownDecision("PROVIDER_RESULT_UNKNOWN");
    }

    return permanentDecision("PROVIDER_PERMANENT_FAILURE");
  }

  if (observation.status === 401) {
    const canRefresh =
      observation.credentialRefreshAvailable === true &&
      observation.credentialRefreshAlreadyAttempted !== true;

    return canRefresh
      ? retryableDecision(context, "AUTH_REFRESH_AVAILABLE", undefined)
      : permanentDecision("AUTHENTICATION_REQUIRED");
  }

  if (observation.status === 403) {
    return permanentDecision("PERMISSION_OR_IP_ERROR");
  }

  if (
    observation.status === 404 ||
    observation.status === 408 ||
    observation.status === 409
  ) {
    return unknownDecision("HTTP_STATE_REQUIRES_RECONCILIATION");
  }

  if (observation.status === 429) {
    return retryableDecision(
      context,
      "RATE_LIMITED",
      observation.retryAfterMs,
    );
  }

  if (observation.status >= 500 && observation.status <= 599) {
    return retryableDecision(
      context,
      "TRANSIENT_HTTP_FAILURE",
      observation.retryAfterMs,
    );
  }

  return permanentDecision("PERMANENT_CLIENT_ERROR");
}
