import { describe, expect, it } from "vitest";

import {
  advanceInternalWorkStatus,
  deriveSalesOrderNormalizedStatus,
  type HeaderItemStatus,
} from "@/lib/server/workers/naver-orders/header-status";

describe("deriveSalesOrderNormalizedStatus", () => {
  it.each([
    [["CANCELED", "CANCELED"], "CANCELED"],
    [["DELIVERED", "DELIVERED"], "DELIVERED"],
    [["NEW", "SHIPPING", "DELIVERED"], "SHIPPING"],
    [["NEW", "READY_TO_SHIP", "PREPARING"], "READY_TO_SHIP"],
    [["NEW", "PREPARING"], "PREPARING"],
    [["CANCELED", "DELIVERED"], "DELIVERED"],
    [[], "NEW"],
  ] as Array<[HeaderItemStatus[], HeaderItemStatus]>) (
    "%j derives %s",
    (statuses, expected) => {
      expect(deriveSalesOrderNormalizedStatus(statuses)).toBe(expected);
    },
  );

  it("lets an explicit hold dominate mixed progress states", () => {
    expect(
      deriveSalesOrderNormalizedStatus([
        "SHIPPING",
        "READY_TO_SHIP",
        "ON_HOLD",
      ]),
    ).toBe("ON_HOLD");
  });

  it("is independent of item order", () => {
    const statuses: HeaderItemStatus[] = [
      "NEW",
      "PREPARING",
      "READY_TO_SHIP",
      "SHIPPING",
      "DELIVERED",
    ];
    const expected = deriveSalesOrderNormalizedStatus(statuses);
    expect(deriveSalesOrderNormalizedStatus([...statuses].reverse())).toBe(
      expected,
    );
    expect(
      deriveSalesOrderNormalizedStatus([
        statuses[2],
        statuses[4],
        statuses[0],
        statuses[3],
        statuses[1],
      ]),
    ).toBe(expected);
  });
});

describe("advanceInternalWorkStatus", () => {
  it.each([
    ["NEW", "PREPARING", "PREPARING"],
    ["PREPARING", "READY_TO_SHIP", "READY_TO_SHIP"],
    ["READY_TO_SHIP", "SHIPPING", "SHIPPING"],
    ["SHIPPING", "DELIVERED", "DELIVERED"],
    ["READY_TO_SHIP", "PREPARING", "READY_TO_SHIP"],
    ["SHIPPING", "READY_TO_SHIP", "SHIPPING"],
    ["DELIVERED", "PREPARING", "DELIVERED"],
    ["CANCELED", "SHIPPING", "CANCELED"],
    ["PREPARING", "ON_HOLD", "ON_HOLD"],
    ["ON_HOLD", "SHIPPING", "ON_HOLD"],
    ["ON_HOLD", "CANCELED", "CANCELED"],
  ] as Array<[HeaderItemStatus, HeaderItemStatus, HeaderItemStatus]>) (
    "%s + %s advances to %s",
    (current, incoming, expected) => {
      expect(advanceInternalWorkStatus(current, incoming)).toBe(expected);
    },
  );
});
