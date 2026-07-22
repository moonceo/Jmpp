import type { NaverCommandOrderItem } from "@/lib/server/commands/worker/types";

export type SalesOrderNormalizedStatus = NaverCommandOrderItem["internalWorkStatus"];

export function deriveOutboundSalesOrderStatus(
    itemStatuses: readonly SalesOrderNormalizedStatus[],
): SalesOrderNormalizedStatus {
    if (itemStatuses.length === 0) return "NEW";
    if (itemStatuses.some((status) => status === "ON_HOLD")) return "ON_HOLD";
    if (itemStatuses.every((status) => status === "CANCELED")) return "CANCELED";

    const allTerminal = itemStatuses.every(
        (status) => status === "CANCELED" || status === "DELIVERED",
    );
    if (allTerminal && itemStatuses.some((status) => status === "DELIVERED")) {
        return "DELIVERED";
    }
    if (itemStatuses.some((status) => status === "SHIPPING")) return "SHIPPING";
    if (itemStatuses.some((status) => status === "READY_TO_SHIP")) {
        return "READY_TO_SHIP";
    }
    if (itemStatuses.some((status) => status === "PREPARING")) return "PREPARING";
    return "NEW";
}

export function preserveTerminalSalesOrderStatus(
    current: SalesOrderNormalizedStatus,
    derived: SalesOrderNormalizedStatus,
): SalesOrderNormalizedStatus {
    return current === "CANCELED" || current === "DELIVERED"
        ? current
        : derived;
}
