import { describe, expect, it } from "vitest";
import type { NaverChangedProductOrder, NaverProductOrderDetail } from "@/lib/server/integrations/naver";
import { mapNaverClaimSnapshots } from "@/lib/server/workers/naver-orders/claim-mapper";

const changed: NaverChangedProductOrder = {
  productOrderStatus: "PAYED",
  productOrderId: "PRODUCT-ORDER-1",
  orderId: "ORDER-1",
  lastChangedDate: "2026-07-12T10:00:00+09:00",
  lastChangedType: "CLAIM_REQUESTED",
  claimType: "RETURN",
  claimStatus: "RETURN_REQUEST",
};

function detail(values: Record<string, unknown>): NaverProductOrderDetail {
  return {
    order: { orderId: "ORDER-1" },
    productOrder: {
      productOrderId: "PRODUCT-ORDER-1",
      orderId: "ORDER-1",
      quantity: 3,
      claimType: "RETURN",
      claimStatus: "RETURN_REQUEST",
    },
    ...values,
  };
}

function map(values: Record<string, unknown>) {
  return mapNaverClaimSnapshots({
    change: changed,
    detail: detail(values),
    externalOrderId: "ORDER-1",
    externalOrderItemId: "PRODUCT-ORDER-1",
    orderQuantity: 3,
    sourceUpdatedAt: "2026-07-12T01:00:00.000Z",
  });
}

describe("Naver claim mapper", () => {
  it("maps an official currentClaim partial return without exposing collection-address fields", () => {
    const result = map({
      currentClaim: {
        return: {
          claimId: "CLAIM-1",
          claimStatus: "RETURN_REQUEST",
          requestQuantity: 2,
          claimRequestDate: "2026-07-12T09:55:00+09:00",
          returnReason: "SIMPLE_INTENT_CHANGED",
          returnDetailedReason: "연락처가 포함될 수 있는 상세 사유",
          requestChannel: "PURCHASER",
          collectAddress: { name: "민감정보", tel1: "010-0000-0000" },
        },
      },
    });

    expect(result.issues).toEqual([]);
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]).toMatchObject({
      externalClaimId: "CLAIM-1",
      claimType: "RETURN",
      requesterType: "CUSTOMER",
      faultType: "CUSTOMER",
      normalizedStatus: "REQUESTED",
      resolutionType: "REFUND",
      resolutionStatus: "PENDING",
    });
    expect(result.snapshots[0].lines[0].requestedQuantity).toBe(2);
    expect(JSON.stringify(result.snapshots[0])).not.toContain("010-0000-0000");
  });

  it("maps completed exchange history to a terminal replacement resolution", () => {
    const result = map({
      completedClaims: [{
        claimType: "EXCHANGE",
        claimId: "CLAIM-2",
        claimStatus: "EXCHANGE_DONE",
        claimRequestDate: "2026-07-11T09:00:00+09:00",
        exchangeReason: "WRONG_OPTION",
        requestQuantity: 1,
      }],
    });

    expect(result.snapshots[0]).toMatchObject({
      claimType: "EXCHANGE",
      normalizedStatus: "COMPLETED",
      resolutionType: "REPLACEMENT",
      resolutionStatus: "SUCCEEDED",
    });
    expect(result.snapshots[0].lines[0]).toMatchObject({
      normalizedStatus: "COMPLETED",
      resolutionStatus: "SUCCEEDED",
    });
  });

  it("quarantines impossible quantities instead of silently clamping them", () => {
    const result = map({
      currentClaim: {
        return: {
          claimId: "CLAIM-3",
          claimStatus: "RETURN_REQUEST",
          requestQuantity: 4,
        },
      },
    });

    expect(result.snapshots).toEqual([]);
    expect(result.issues).toEqual([expect.objectContaining({ code: "INVALID_REQUEST_QUANTITY" })]);
  });

  it.each([0, -1, 1.5, "not-a-number", true])(
    "quarantines an explicitly invalid request quantity (%s)",
    (requestQuantity) => {
      const result = map({
        currentClaim: {
          return: {
            claimId: "CLAIM-INVALID-QUANTITY",
            claimStatus: "RETURN_REQUEST",
            requestQuantity,
          },
        },
      });

      expect(result.snapshots).toEqual([]);
      expect(result.issues).toEqual([expect.objectContaining({ code: "INVALID_REQUEST_QUANTITY" })]);
    },
  );

  it.each(["absent", "null"] as const)(
    "falls back to the order quantity only when requestQuantity is %s",
    (mode) => {
      const claim: Record<string, unknown> = {
        claimId: `CLAIM-QUANTITY-${mode}`,
        claimStatus: "RETURN_REQUEST",
      };
      if (mode === "null") claim.requestQuantity = null;
      const result = map({ currentClaim: { return: claim } });

      expect(result.issues).toEqual([]);
      expect(result.snapshots[0].lines[0].requestedQuantity).toBe(3);
    },
  );

  it("does not treat purchase-decision holdback as cancel, return, or exchange", () => {
    const result = map({
      completedClaims: [{
        claimType: "PURCHASE_DECISION_HOLDBACK",
        claimId: "HOLD-1",
        claimStatus: "PURCHASE_DECISION_HOLDBACK_RELEASE",
      }],
    });
    expect(result).toEqual({ snapshots: [], issues: [] });
  });
});
