import { describe, expect, it } from "vitest";

import {
  guardOrderItemTransition,
  validateOrderItemState,
  type DomesticInvoice,
  type OrderItemState,
} from "./order-item";

const timestamp = "2026-07-10T12:00:00.000Z";

const validInvoice: DomesticInvoice = {
  carrierCode: "CJ_LOGISTICS",
  trackingNumber: "123456789012",
  receivedAt: timestamp,
  source: "SOURCING_LIFE",
};

function createBaseState(): OrderItemState {
  return {
    id: "item-1",
    version: 1,
    internalWorkStatus: "NEW",
    market: {
      rawStatus: "PAYED",
      fulfillmentStatus: "PAID",
      deliveryMethod: "NONE",
      submission: { status: "NOT_SUBMITTED" },
    },
    purchase: {
      method: null,
      status: "NOT_STARTED",
      paidAt: null,
      purchasedAt: null,
    },
    shipment: {
      invoiceStatus: "NOT_RECEIVED",
      domesticStatus: "NOT_STARTED",
      invoice: null,
    },
    claim: {
      status: "NONE",
      activeClaimId: null,
      type: null,
    },
  };
}

function withCompletedPurchaseAndInvoice(
  state: OrderItemState,
): OrderItemState {
  return {
    ...state,
    purchase: {
      method: "SOURCING_LIFE",
      status: "PURCHASED",
      paidAt: timestamp,
      purchasedAt: timestamp,
    },
    shipment: {
      invoiceStatus: "INVOICE_RECEIVED",
      domesticStatus: "PREPARING",
      invoice: validInvoice,
    },
  };
}

describe("order item state invariants", () => {
  it("keeps PAID independent from INVOICE_RECEIVED", () => {
    const state: OrderItemState = {
      ...createBaseState(),
      internalWorkStatus: "PREPARING",
      purchase: {
        method: "SOURCING_LIFE",
        status: "PAID",
        paidAt: timestamp,
        purchasedAt: null,
      },
    };

    expect(state.purchase.status).toBe("PAID");
    expect(state.shipment.invoiceStatus).toBe("NOT_RECEIVED");
    expect(validateOrderItemState(state)).toEqual([]);
  });

  it("rejects READY_TO_SHIP when payment succeeded but purchase did not", () => {
    const state: OrderItemState = {
      ...createBaseState(),
      internalWorkStatus: "READY_TO_SHIP",
      purchase: {
        method: "SOURCING_LIFE",
        status: "PAID",
        paidAt: timestamp,
        purchasedAt: null,
      },
      shipment: {
        invoiceStatus: "INVOICE_RECEIVED",
        domesticStatus: "PREPARING",
        invoice: validInvoice,
      },
    };

    expect(validateOrderItemState(state).map(({ code }) => code)).toContain(
      "READY_TO_SHIP_REQUIRES_PURCHASE",
    );
  });

  it("allows READY_TO_SHIP with purchase and a valid invoice", () => {
    const state: OrderItemState = {
      ...withCompletedPurchaseAndInvoice(createBaseState()),
      internalWorkStatus: "READY_TO_SHIP",
    };

    expect(validateOrderItemState(state)).toEqual([]);
  });

  it("keeps a paid direct-delivery order in READY_TO_SHIP until internal shipping is completed", () => {
    const state: OrderItemState = {
      ...withCompletedPurchaseAndInvoice(createBaseState()),
      internalWorkStatus: "READY_TO_SHIP",
      market: {
        rawStatus: "DELIVERING",
        fulfillmentStatus: "SHIPPING",
        deliveryMethod: "DIRECT_DELIVERY",
        submission: {
          status: "SUBMITTED",
          succeededCommandId: "command-direct",
          submittedAt: timestamp,
        },
      },
    };

    expect(validateOrderItemState(state)).toEqual([]);
  });

  it("rejects internal SHIPPING before marketplace dispatch", () => {
    const state: OrderItemState = {
      ...withCompletedPurchaseAndInvoice(createBaseState()),
      internalWorkStatus: "SHIPPING",
      market: {
        rawStatus: "INSTRUCT",
        fulfillmentStatus: "ACKNOWLEDGED",
        deliveryMethod: "DELIVERY",
        submission: { status: "NOT_SUBMITTED" },
      },
    };

    expect(validateOrderItemState(state).map(({ code }) => code)).toContain("SHIPPING_REQUIRES_MARKET_SUBMISSION");
  });

  it("rejects internal SHIPPING when the marketplace method is not recorded", () => {
    const state: OrderItemState = {
      ...createBaseState(),
      internalWorkStatus: "SHIPPING",
      purchase: {
        method: "SOURCING_LIFE",
        status: "PURCHASED",
        paidAt: timestamp,
        purchasedAt: timestamp,
      },
    };

    expect(validateOrderItemState(state).map(({ code }) => code)).toEqual(expect.arrayContaining([
      "SHIPPING_REQUIRES_MARKET_SUBMISSION",
      "SHIPPING_REQUIRES_DELIVERY_METHOD",
    ]));
  });

  it("allows parcel SHIPPING after a successful invoice command", () => {
    const state: OrderItemState = {
      ...withCompletedPurchaseAndInvoice(createBaseState()),
      internalWorkStatus: "SHIPPING",
      market: {
        rawStatus: "DELIVERING",
        fulfillmentStatus: "SHIPPING",
        deliveryMethod: "DELIVERY",
        submission: {
          status: "SUBMITTED",
          succeededCommandId: "command-1",
          submittedAt: timestamp,
        },
      },
    };

    expect(validateOrderItemState(state)).toEqual([]);
  });

  it.each(["DELIVERY", "DIRECT_DELIVERY", "OVERSEAS_OTHER_DELIVERY"] as const)(
    "rejects pre-purchase %s marketplace submission",
    (deliveryMethod) => {
      const state: OrderItemState = {
        ...createBaseState(),
        internalWorkStatus: "PREPARING",
        market: {
          rawStatus: "DELIVERING",
          fulfillmentStatus: "SHIPPING",
          deliveryMethod,
          submission: {
            status: "SUBMITTED",
            succeededCommandId: `command-${deliveryMethod}`,
            submittedAt: timestamp,
          },
        },
      };

      expect(validateOrderItemState(state)).toContainEqual(expect.objectContaining({
        code: "MARKET_SUBMISSION_REQUIRES_PURCHASE",
      }));
    },
  );

  it("allows direct-delivery SHIPPING after purchase and invoice arrive", () => {
    const state: OrderItemState = {
      ...withCompletedPurchaseAndInvoice(createBaseState()),
      internalWorkStatus: "SHIPPING",
      market: {
        rawStatus: "DELIVERING",
        fulfillmentStatus: "SHIPPING",
        deliveryMethod: "DIRECT_DELIVERY",
        submission: {
          status: "SUBMITTED",
          succeededCommandId: "command-direct",
          submittedAt: timestamp,
        },
      },
    };

    expect(validateOrderItemState(state)).toEqual([]);
  });

  it("requires actual domestic delivery before DELIVERED", () => {
    const current: OrderItemState = {
      ...withCompletedPurchaseAndInvoice(createBaseState()),
      internalWorkStatus: "SHIPPING",
      market: {
        rawStatus: "DELIVERING",
        fulfillmentStatus: "SHIPPING",
        deliveryMethod: "DELIVERY",
        submission: {
          status: "SUBMITTED",
          succeededCommandId: "command-1",
          submittedAt: timestamp,
        },
      },
    };
    const next: OrderItemState = {
      ...current,
      version: 2,
      internalWorkStatus: "DELIVERED",
    };

    expect(guardOrderItemTransition(current, next).violations).toContainEqual(
      expect.objectContaining({
        code: "DELIVERED_REQUIRES_DOMESTIC_DELIVERY",
      }),
    );
  });

  it("blocks backward workflow transitions while claim stays independent", () => {
    const delivered: OrderItemState = {
      ...withCompletedPurchaseAndInvoice(createBaseState()),
      internalWorkStatus: "DELIVERED",
      shipment: {
        invoiceStatus: "INVOICE_RECEIVED",
        domesticStatus: "DELIVERED",
        invoice: validInvoice,
      },
      claim: {
        status: "REQUESTED",
        activeClaimId: "claim-1",
        type: "RETURN",
      },
    };
    const regressed: OrderItemState = {
      ...delivered,
      version: 2,
      internalWorkStatus: "SHIPPING",
    };

    const decision = guardOrderItemTransition(delivered, regressed);

    expect(decision.allowed).toBe(false);
    expect(decision.violations).toContainEqual(
      expect.objectContaining({ code: "ILLEGAL_WORK_STATUS_TRANSITION" }),
    );
    expect(delivered.claim.status).toBe("REQUESTED");
  });
});
