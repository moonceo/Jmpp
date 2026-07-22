import { describe, expect, it } from "vitest";
import {
    deriveOutboundSalesOrderStatus,
    preserveTerminalSalesOrderStatus,
    type SalesOrderNormalizedStatus,
} from "@/lib/server/commands/worker/header-status";

describe("outbound sales order header projection", () => {
    it.each([
        [[], "NEW"],
        [["CANCELED", "CANCELED"], "CANCELED"],
        [["CANCELED", "DELIVERED"], "DELIVERED"],
        [["DELIVERED", "DELIVERED"], "DELIVERED"],
        [["NEW", "SHIPPING", "DELIVERED"], "SHIPPING"],
        [["NEW", "READY_TO_SHIP", "PREPARING"], "READY_TO_SHIP"],
        [["NEW", "PREPARING"], "PREPARING"],
        [["NEW", "DELIVERED"], "NEW"],
    ] as Array<[SalesOrderNormalizedStatus[], SalesOrderNormalizedStatus]>) (
        "%j derives %s",
        (statuses, expected) => {
            expect(deriveOutboundSalesOrderStatus(statuses)).toBe(expected);
        },
    );

    it("gives ON_HOLD priority over shipping progress", () => {
        expect(deriveOutboundSalesOrderStatus([
            "SHIPPING",
            "READY_TO_SHIP",
            "ON_HOLD",
        ])).toBe("ON_HOLD");
    });

    it.each(["CANCELED", "DELIVERED"] as const)(
        "never reopens a %s header",
        (terminal) => {
            expect(preserveTerminalSalesOrderStatus(terminal, "SHIPPING")).toBe(terminal);
        },
    );
});
