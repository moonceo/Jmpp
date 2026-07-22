import { describe, expect, it } from "vitest";

import { decideUnknownCommandReconciliation } from "./unknown-command-reconciliation";

describe("UNKNOWN command reconciliation", () => {
  it("marks the command successful when the provider target is confirmed", () => {
    expect(
      decideUnknownCommandReconciliation({
        observation: {
          kind: "TARGET_APPLIED",
          providerReference: "provider-result-1",
        },
        preconditionState: "STALE",
      }),
    ).toMatchObject({
      action: "MARK_SUCCEEDED",
      nextStatus: "SUCCEEDED",
      reason: "TARGET_STATE_CONFIRMED",
    });
  });

  it("retries only after authoritative absence and valid preconditions", () => {
    expect(
      decideUnknownCommandReconciliation({
        observation: {
          kind: "TARGET_NOT_APPLIED",
          authoritative: true,
        },
        preconditionState: "SATISFIED",
      }),
    ).toEqual({
      action: "RETRY_COMMAND",
      nextStatus: "RETRY",
      requiresManualReview: false,
      reason: "AUTHORITATIVE_ABSENCE_CONFIRMED",
    });
  });

  it("keeps UNKNOWN when absence may be eventual consistency", () => {
    expect(
      decideUnknownCommandReconciliation({
        observation: {
          kind: "TARGET_NOT_APPLIED",
          authoritative: false,
        },
        preconditionState: "SATISFIED",
      }),
    ).toMatchObject({
      action: "KEEP_UNKNOWN",
      nextStatus: "UNKNOWN",
      reason: "ABSENCE_NOT_AUTHORITATIVE",
    });
  });

  it("fails for manual review when the aggregate precondition is stale", () => {
    expect(
      decideUnknownCommandReconciliation({
        observation: {
          kind: "TARGET_NOT_APPLIED",
          authoritative: true,
        },
        preconditionState: "STALE",
      }),
    ).toMatchObject({
      action: "MARK_FAILED",
      nextStatus: "FAILED",
      requiresManualReview: true,
      reason: "PRECONDITION_STALE",
    });
  });

  it("keeps UNKNOWN while the provider read is unavailable", () => {
    expect(
      decideUnknownCommandReconciliation({
        observation: { kind: "PROVIDER_UNAVAILABLE" },
        preconditionState: "UNKNOWN",
      }),
    ).toMatchObject({
      action: "KEEP_UNKNOWN",
      nextStatus: "UNKNOWN",
      reason: "PROVIDER_READ_UNAVAILABLE",
    });
  });
});
