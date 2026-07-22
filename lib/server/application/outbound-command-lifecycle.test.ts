import { describe, expect, it } from "vitest";

import {
  createPendingOutboundCommand,
  leaseOutboundCommand,
  recordOutboundCommandStatus,
} from "./outbound-command-lifecycle";

function createCommand() {
  return createPendingOutboundCommand({
    id: "command-1",
    tenantId: "tenant-1",
    aggregate: {
      type: "ORDER_ITEM",
      id: "item-1",
      expectedVersion: 3,
    },
    type: "INVOICE_SUBMIT",
    effectKey: "invoice-revision-1",
    payload: { carrierCode: "CJ", trackingNumber: "123456" },
    requestedBy: "user-1",
    correlationId: "correlation-1",
    createdAt: "2026-07-10T12:00:00.000Z",
  });
}

describe("outbound command lifecycle", () => {
  it("creates PENDING user intent and leases it as the first attempt", () => {
    const pending = createCommand();
    const leased = leaseOutboundCommand(pending, {
      leaseOwner: "worker-1",
      leaseUntil: "2026-07-10T12:01:00.000Z",
    });

    expect(pending).toMatchObject({ status: "PENDING", attemptCount: 0 });
    expect(leased).toMatchObject({
      status: "LEASED",
      attemptCount: 1,
      leaseOwner: "worker-1",
    });
  });

  it("moves a timed-out attempt to UNKNOWN without scheduling a retry", () => {
    const leased = leaseOutboundCommand(createCommand(), {
      leaseOwner: "worker-1",
      leaseUntil: "2026-07-10T12:01:00.000Z",
    });
    const unknown = recordOutboundCommandStatus(leased, {
      status: "UNKNOWN",
      errorCode: "TIMEOUT",
    });

    expect(unknown).toMatchObject({
      status: "UNKNOWN",
      nextAttemptAt: null,
      leaseOwner: null,
      lastErrorCode: "TIMEOUT",
    });
  });

  it("requires a schedule when reconciliation permits RETRY", () => {
    const leased = leaseOutboundCommand(createCommand(), {
      leaseOwner: "worker-1",
      leaseUntil: "2026-07-10T12:01:00.000Z",
    });
    const unknown = recordOutboundCommandStatus(leased, {
      status: "UNKNOWN",
    });

    expect(() =>
      recordOutboundCommandStatus(unknown, { status: "RETRY" }),
    ).toThrow("RETRY requires nextAttemptAt");
  });

  it("rejects aggregate version zero", () => {
    expect(() =>
      createPendingOutboundCommand({
        id: "command-zero",
        tenantId: "tenant-1",
        aggregate: {
          type: "ORDER_ITEM",
          id: "item-1",
          expectedVersion: 0,
        },
        type: "ORDER_CONFIRM",
        effectKey: "confirm-v0",
        payload: {},
        requestedBy: "user-1",
        correlationId: "correlation-1",
        createdAt: "2026-07-10T12:00:00.000Z",
      }),
    ).toThrow("aggregate.expectedVersion must be a positive integer");
  });

  it("does not let a second worker lease an already leased command", () => {
    const leased = leaseOutboundCommand(createCommand(), {
      leaseOwner: "worker-1",
      leaseUntil: "2026-07-10T12:01:00.000Z",
    });

    expect(() =>
      leaseOutboundCommand(leased, {
        leaseOwner: "worker-2",
        leaseUntil: "2026-07-10T12:02:00.000Z",
      }),
    ).toThrow("Cannot lease a command in LEASED status");
  });
});
