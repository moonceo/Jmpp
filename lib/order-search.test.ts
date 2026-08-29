import { describe, expect, it } from "vitest";
import { createMockOrders, mockOrders } from "@/lib/mock-data/orders";
import { filterOrders } from "@/lib/order-search";

const defaultFilters = {
    marketFilters: [],
    accountFilters: [],
    periodFilter: "7d" as const,
    referenceDate: new Date("2026-07-15T15:00:00"),
};

describe("filterOrders", () => {
    it("creates a deterministic server snapshot for hydration", () => {
        const referenceTime = "2026-08-18T15:15:42+09:00";
        const first = createMockOrders(referenceTime);
        const second = createMockOrders(referenceTime);

        expect(first).toEqual(second);
        expect(first[0].orderDate).toBe("2026-08-18 14:15");
    });

    it.each([
        ["ORD-20260618-0042", "ORD-20260618-0042"],
        ["소싱라이프 구매 수납", "ORD-20260618-0042"],
        ["강주원", "ORD-20260618-0042"],
        ["01042423333", "ORD-20260618-0042"],
    ])("finds an order with %s", (searchTerm, expectedId) => {
        const results = filterOrders(mockOrders, { ...defaultFilters, searchTerm });
        expect(results.some((order) => order.id === expectedId)).toBe(true);
    });

    it("includes orders from earlier today in the today period", () => {
        const order = { ...mockOrders[0], orderDate: "2026-08-18 09:00" };
        const results = filterOrders([order], {
            ...defaultFilters,
            periodFilter: "today",
            searchTerm: "",
            referenceDate: new Date("2026-08-18T15:00:00"),
        });

        expect(results).toHaveLength(1);
    });
});
