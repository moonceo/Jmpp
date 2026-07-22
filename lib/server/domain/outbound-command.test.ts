import { describe, expect, it } from "vitest";

import {
  createOutboundCommandIdempotencyKey,
  isOutboundCommandStatusTransitionAllowed,
} from "./outbound-command";

const baseInput = {
  tenantId: "tenant-1",
  aggregateType: "ORDER_ITEM",
  aggregateId: "item-1",
  commandType: "INVOICE_SUBMIT",
  effectKey: "invoice-revision-1",
} as const;

describe("outbound command domain", () => {
  it("creates a deterministic idempotency key for the same business effect", () => {
    const first = createOutboundCommandIdempotencyKey(baseInput);
    const second = createOutboundCommandIdempotencyKey({ ...baseInput });

    expect(first).toBe(second);
    expect(first).toMatch(/^outbound:v1:[a-f0-9]{64}$/);
  });

  it("changes the key when the effect version changes", () => {
    expect(createOutboundCommandIdempotencyKey(baseInput)).not.toBe(
      createOutboundCommandIdempotencyKey({
        ...baseInput,
        effectKey: "invoice-revision-2",
      }),
    );
  });

  it("rejects an ambiguous blank effect key", () => {
    expect(() =>
      createOutboundCommandIdempotencyKey({ ...baseInput, effectKey: "  " }),
    ).toThrow(RangeError);
  });

  it("allows UNKNOWN to reconcile or retry but keeps success terminal", () => {
    expect(isOutboundCommandStatusTransitionAllowed("UNKNOWN", "LEASED")).toBe(
      true,
    );
    expect(
      isOutboundCommandStatusTransitionAllowed("UNKNOWN", "SUCCEEDED"),
    ).toBe(true);
    expect(isOutboundCommandStatusTransitionAllowed("UNKNOWN", "RETRY")).toBe(
      true,
    );
    expect(isOutboundCommandStatusTransitionAllowed("SUCCEEDED", "LEASED")).toBe(
      false,
    );
    expect(isOutboundCommandStatusTransitionAllowed("FAILED", "UNKNOWN")).toBe(
      true,
    );
  });

  it("cancels only commands that have not produced an ambiguous write", () => {
    expect(
      isOutboundCommandStatusTransitionAllowed("PENDING", "CANCELED"),
    ).toBe(true);
    expect(isOutboundCommandStatusTransitionAllowed("RETRY", "CANCELED")).toBe(
      true,
    );
    expect(
      isOutboundCommandStatusTransitionAllowed("UNKNOWN", "CANCELED"),
    ).toBe(false);
    expect(
      isOutboundCommandStatusTransitionAllowed("LEASED", "CANCELED"),
    ).toBe(false);
  });
});
