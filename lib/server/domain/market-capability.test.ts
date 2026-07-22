import { describe, expect, it } from "vitest";

import {
  decideCapabilityExecution,
  type MarketCapability,
} from "./market-capability";

function capability(mode: MarketCapability["mode"]): MarketCapability {
  return {
    action: "DIRECT_DELIVERY",
    mode,
    officialDocumentReviewedAt: "2026-07-10",
    uatStatus: "NOT_RUN",
    note: null,
  };
}

describe("market capability", () => {
  it("fails closed when capability data is missing", () => {
    expect(decideCapabilityExecution(undefined)).toEqual({
      execution: "UNSUPPORTED",
      reason: "CAPABILITY_NOT_CONFIGURED",
    });
  });

  it.each([
    ["API", "API", "API_CAPABILITY_CONFIRMED"],
    ["MANUAL_FALLBACK", "MANUAL_FALLBACK", "MANUAL_PROCESS_REQUIRED"],
    ["UNSUPPORTED", "UNSUPPORTED", "EXPLICITLY_UNSUPPORTED"],
  ] as const)("maps %s without upgrading support", (mode, execution, reason) => {
    expect(decideCapabilityExecution(capability(mode))).toEqual({
      execution,
      reason,
    });
  });
});
