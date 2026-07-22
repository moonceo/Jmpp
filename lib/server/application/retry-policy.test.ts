import { describe, expect, it } from "vitest";

import { classifyOutboundFailure } from "./retry-policy";

const context = { attemptNumber: 1, maxAttempts: 3 } as const;

describe("outbound retry policy", () => {
  it("does not blindly retry a timeout", () => {
    expect(classifyOutboundFailure({ kind: "TIMEOUT" }, context)).toMatchObject({
      classification: "UNKNOWN",
      nextStatus: "UNKNOWN",
      shouldRetry: false,
      reconcileBeforeRetry: true,
    });
  });

  it("distinguishes a pre-dispatch network failure from an ambiguous one", () => {
    expect(
      classifyOutboundFailure(
        { kind: "NETWORK", requestMayHaveReachedProvider: false },
        context,
      ),
    ).toMatchObject({ nextStatus: "RETRY", shouldRetry: true });

    expect(
      classifyOutboundFailure(
        { kind: "NETWORK", requestMayHaveReachedProvider: true },
        context,
      ),
    ).toMatchObject({
      nextStatus: "UNKNOWN",
      reconcileBeforeRetry: true,
    });
  });

  it("honors rate-limit delay and retries 5xx", () => {
    expect(
      classifyOutboundFailure(
        { kind: "HTTP", status: 429, retryAfterMs: 12_000 },
        context,
      ),
    ).toMatchObject({
      nextStatus: "RETRY",
      retryAfterMs: 12_000,
      reason: "RATE_LIMITED",
    });

    expect(
      classifyOutboundFailure({ kind: "HTTP", status: 503 }, context),
    ).toMatchObject({
      classification: "RETRYABLE",
      nextStatus: "RETRY",
    });
  });

  it("refreshes 401 once but never automatically retries 403", () => {
    expect(
      classifyOutboundFailure(
        {
          kind: "HTTP",
          status: 401,
          credentialRefreshAvailable: true,
          credentialRefreshAlreadyAttempted: false,
        },
        context,
      ),
    ).toMatchObject({ nextStatus: "RETRY", reason: "AUTH_REFRESH_AVAILABLE" });

    expect(
      classifyOutboundFailure({ kind: "HTTP", status: 403 }, context),
    ).toMatchObject({
      nextStatus: "FAILED",
      reason: "PERMISSION_OR_IP_ERROR",
    });
  });

  it("requires reconciliation for provider state conflicts", () => {
    expect(
      classifyOutboundFailure({ kind: "HTTP", status: 409 }, context),
    ).toMatchObject({
      nextStatus: "UNKNOWN",
      reconcileBeforeRetry: true,
    });
  });

  it("moves exhausted transient failures to DEAD", () => {
    expect(
      classifyOutboundFailure(
        { kind: "HTTP", status: 503 },
        { attemptNumber: 3, maxAttempts: 3 },
      ),
    ).toMatchObject({
      classification: "RETRYABLE",
      nextStatus: "DEAD",
      shouldRetry: false,
      reason: "RETRY_LIMIT_EXHAUSTED",
    });
  });
});
