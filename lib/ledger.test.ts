import { describe, expect, it } from "vitest";
import {
    LEDGER_HEADERS,
    filterLedgerOrders,
    getLedgerFilename,
    ledgerRowToValues,
    summarizeLedger,
    type LedgerFilter,
} from "@/lib/ledger";
import { LEDGER_MANUAL_FIELDS } from "@/lib/ledger-manual-entry";
import type { Order } from "@/types/order";

const baseOrder: Order = {
    id: "order-1",
    marketOrderId: "NAVER-1",
    marketType: "naver",
    storeName: "테스트 스토어",
    orderDate: "2026-08-20 12:00",
    status: "DELIVERED",
    buyerName: "구매자",
    buyerPhone: "010-0000-0000",
    recipient: { name: "수취인", phone: "010-0000-0000", address: "서울" },
    product: { id: "product-1", name: "상품", thumbnail: "", optionName: "옵션", quantity: 1, unitPrice: 10000 },
    paymentPrice: 10000,
    platformFee: 1000,
    expectedSettlement: 9000,
    expectedCost: 4000,
    sourcingLifeSyncStatus: "PAID",
    sourcingLifeActualPayment: { amount: 4000, currency: "KRW", paidAt: "2026-08-20 13:00" },
};

const filter: LedgerFilter = {
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    market: "all",
    onlyConfirmed: true,
    excludeCanceledReturns: true,
    includeManualEntries: true,
};

describe("ledger", () => {
    it("allows manual input only for margin calculation costs", () => {
        expect(LEDGER_MANUAL_FIELDS.map((field) => field.label)).toEqual([
            "구매금액(원화)",
            "국제배송비",
            "화물택배비",
            "관부가세",
        ]);
    });

    it("keeps the provided workbook's 38 headers in the original order", () => {
        expect(LEDGER_HEADERS).toHaveLength(38);
        expect(LEDGER_HEADERS.slice(0, 5)).toEqual(["주문일", "주문플랫폼", "주문번호", "상품번호", "상품명"]);
        expect(LEDGER_HEADERS.slice(-3)).toEqual(["수익금", "수익률", "비고"]);
    });

    it("excludes cancellations and returns but keeps exchanges", () => {
        const canceled = { ...baseOrder, id: "cancel", claimType: "CANCEL" as const };
        const returned = { ...baseOrder, id: "return", claimType: "RETURN" as const };
        const exchanged = { ...baseOrder, id: "exchange", claimType: "EXCHANGE" as const };

        const rows = filterLedgerOrders([canceled, returned, exchanged], filter);

        expect(rows.map((row) => row.order.id)).toEqual(["exchange"]);
    });

    it("uses the same sales basis for total profit and margin rate", () => {
        const rows = filterLedgerOrders([baseOrder], filter);

        expect(summarizeLedger(rows)).toEqual({
            totalOrders: 1,
            totalSales: 10000,
            totalProfit: 5000,
            marginRate: 50,
        });
    });

    it("adds customer-paid shipping after deducting the 3.3 percent fee", () => {
        const paidShippingOrder: Order = {
            ...baseOrder,
            paymentShippingFee: 3000,
        };

        const [row] = filterLedgerOrders([paidShippingOrder], filter);
        const values = ledgerRowToValues(row);

        expect(values[17]).toBe(3000);
        expect(row.profit).toBe(7901);
        expect(row.profitRate).toBeCloseTo(0.7901);
    });

    it("fills blank ledger fields and deducts manually entered costs", () => {
        const orderWithoutCost: Order = {
            ...baseOrder,
            id: "manual-cost-order",
            expectedCost: undefined,
            sourcingLifeActualPayment: undefined,
        };
        const manualEntries = [
            {
                id: "manual-cost-order:purchaseCostKrw",
                orderId: "manual-cost-order",
                field: "purchaseCostKrw" as const,
                value: 4500,
                updatedAt: "2026-08-26T00:00:00.000Z",
            },
            {
                id: "manual-cost-order:internationalShippingFee",
                orderId: "manual-cost-order",
                field: "internationalShippingFee" as const,
                value: 500,
                updatedAt: "2026-08-26T00:00:00.000Z",
            },
        ];

        const rows = filterLedgerOrders([orderWithoutCost], filter, manualEntries);
        const values = ledgerRowToValues(rows[0]);

        expect(rows).toHaveLength(1);
        expect(values[26]).toBe(4500);
        expect(values[30]).toBe(500);
        expect(values[35]).toBe(4000);
        expect(summarizeLedger(rows).totalProfit).toBe(4000);

        const rowsWithoutManualEntries = filterLedgerOrders(
            [orderWithoutCost],
            { ...filter, includeManualEntries: false },
            manualEntries,
        );
        expect(rowsWithoutManualEntries).toHaveLength(0);
    });

    it("allows an unpaid purchase cost to override the estimated cost", () => {
        const unpaidOrder: Order = {
            ...baseOrder,
            id: "unpaid-order",
            sourcingLifeActualPayment: undefined,
            expectedCost: 4000,
        };
        const manualEntries = [{
            id: "unpaid-order:purchaseCostKrw",
            orderId: "unpaid-order",
            field: "purchaseCostKrw" as const,
            value: 5200,
            updatedAt: "2026-08-26T00:00:00.000Z",
        }];

        const [row] = filterLedgerOrders([unpaidOrder], filter, manualEntries);

        expect(row.purchaseCost).toBe(5200);
        expect(row.profit).toBe(3800);
    });

    it("keeps the completed sourcing payment authoritative", () => {
        const manualEntries = [{
            id: "order-1:purchaseCostKrw",
            orderId: "order-1",
            field: "purchaseCostKrw" as const,
            value: 5200,
            updatedAt: "2026-08-26T00:00:00.000Z",
        }];

        const [row] = filterLedgerOrders([baseOrder], filter, manualEntries);

        expect(row.purchaseCost).toBe(4000);
        expect(row.profit).toBe(5000);
    });

    it("creates monthly and date-range filenames", () => {
        expect(getLedgerFilename(filter, true)).toBe("commerce-life_ledger_202608.xlsx");
        expect(getLedgerFilename(filter)).toBe("commerce-life_ledger_20260801-20260831.xlsx");
    });
});
