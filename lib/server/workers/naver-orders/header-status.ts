import type { MappedNaverOrder } from "@/lib/server/workers/naver-orders/types";

export type HeaderItemStatus = MappedNaverOrder["normalizedStatus"];

/**
 * Order headers are a deterministic projection of every current item. Terminal
 * states require unanimity; an explicit hold dominates all mixed progress
 * states so an operator-visible exception is never hidden by shipping progress.
 */
export function deriveSalesOrderNormalizedStatus(
  itemStatuses: readonly HeaderItemStatus[],
): HeaderItemStatus {
  if (itemStatuses.length === 0) return "NEW";
  if (itemStatuses.every((status) => status === "CANCELED")) {
    return "CANCELED";
  }
  if (
    itemStatuses.every(
      (status) => status === "CANCELED" || status === "DELIVERED",
    ) &&
    itemStatuses.some((status) => status === "DELIVERED")
  ) {
    return "DELIVERED";
  }
  if (itemStatuses.some((status) => status === "ON_HOLD")) return "ON_HOLD";
  if (itemStatuses.some((status) => status === "SHIPPING")) return "SHIPPING";
  if (itemStatuses.some((status) => status === "READY_TO_SHIP")) {
    return "READY_TO_SHIP";
  }
  if (itemStatuses.some((status) => status === "PREPARING")) {
    return "PREPARING";
  }
  return "NEW";
}

/**
 * Projects a newer marketplace observation onto the internal work queue.
 * Terminal work never reopens, holds are sticky until a terminal observation,
 * and ordinary fulfillment states can only move forward.
 */
export function advanceInternalWorkStatus(
  current: HeaderItemStatus,
  incoming: HeaderItemStatus,
): HeaderItemStatus {
  if (current === "DELIVERED" || current === "CANCELED") return current;
  if (incoming === "DELIVERED" || incoming === "CANCELED") return incoming;
  if (incoming === "ON_HOLD") return "ON_HOLD";
  if (current === "ON_HOLD") return current;
  if (incoming === "SHIPPING") return "SHIPPING";
  if (
    incoming === "READY_TO_SHIP" &&
    (current === "NEW" || current === "PREPARING")
  ) {
    return "READY_TO_SHIP";
  }
  if (incoming === "PREPARING" && current === "NEW") return "PREPARING";
  return current;
}
