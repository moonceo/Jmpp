import { MARKET_LABELS, ORDER_STATUS_LABELS } from "@/lib/constants/orders";
import {
    getLedgerManualField,
    isLedgerManualCostField,
    type LedgerManualEntry,
    type LedgerManualField,
} from "@/lib/ledger-manual-entry";
import type { MarketType, Order } from "@/types/order";

export const LEDGER_HEADERS = [
    "주문일",
    "주문플랫폼",
    "주문번호",
    "상품번호",
    "상품명",
    "옵션",
    "수량",
    "상품URL",
    "구매자명",
    "구매자연락처",
    "수취인명",
    "수취인연락처",
    "통관번호",
    "우편번호",
    "주소",
    "배송메세지",
    "상품결제금액",
    "결제배송비",
    "정산예정금액",
    "발주일자",
    "해외구매처",
    "해외주문번호",
    "해외송장번호",
    "소싱URL",
    "결제카드",
    "결제금액",
    "구매금액(원화)",
    "배송대행지",
    "국내택배사",
    "국내운송장번호",
    "국제배송비",
    "화물택배사",
    "화물운송장번호",
    "화물택배비",
    "관부가세",
    "수익금",
    "수익률",
    "비고",
] as const;

export type LedgerMarket = MarketType | "all";

export interface LedgerFilter {
    startDate: string;
    endDate: string;
    market: LedgerMarket;
    onlyConfirmed: boolean;
    excludeCanceledReturns: boolean;
    includeManualEntries: boolean;
}

export interface LedgerRow {
    order: Order;
    purchaseCost: number | null;
    manualCostTotal: number;
    profit: number | null;
    profitRate: number | null;
    manualEntries: LedgerManualEntry[];
}

export interface LedgerSummary {
    totalOrders: number;
    totalSales: number;
    totalProfit: number;
    marginRate: number;
}

export const LEDGER_PAYMENT_SHIPPING_FEE_RATE = 0.033;

function parseOrderDate(value: string): Date {
    return new Date(value.includes("T") ? value : value.replace(" ", "T"));
}

export function formatLedgerDate(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function getRecentLedgerRange(referenceDate: Date): Pick<LedgerFilter, "startDate" | "endDate"> {
    const end = new Date(referenceDate);
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 89);

    return {
        startDate: formatLedgerDate(start),
        endDate: formatLedgerDate(end),
    };
}

export function getMonthLedgerRange(year: number, month: number): Pick<LedgerFilter, "startDate" | "endDate"> {
    return {
        startDate: formatLedgerDate(new Date(year, month - 1, 1)),
        endDate: formatLedgerDate(new Date(year, month, 0)),
    };
}

function manualNumber(entries: readonly LedgerManualEntry[], field: LedgerManualField): number | null {
    const entry = entries.find((item) => item.field === field);
    return typeof entry?.value === "number" ? entry.value : null;
}

export function isLedgerMarginConfirmed(order: Order, manualEntries: readonly LedgerManualEntry[] = []): boolean {
    return Boolean(order.sourcingLifeActualPayment) || manualNumber(manualEntries, "purchaseCostKrw") !== null;
}

function isCanceledOrReturned(order: Order): boolean {
    return order.status === "CANCELED"
        || Boolean(order.sellerCanceledAt)
        || order.claimType === "CANCEL"
        || order.claimType === "RETURN";
}

export function getLedgerPurchaseCost(order: Order): number | null {
    return order.sourcingLifeActualPayment?.amount
        ?? order.expectedCost
        ?? order.sourcingLifeMatch?.estimatedCost
        ?? null;
}

export function getLedgerPaymentShippingFee(order: Order): number {
    return typeof order.paymentShippingFee === "number" && Number.isFinite(order.paymentShippingFee)
        ? Math.max(0, order.paymentShippingFee)
        : 0;
}

export function getLedgerNetPaymentShippingIncome(order: Order): number {
    const shippingFee = getLedgerPaymentShippingFee(order);
    return shippingFee - (shippingFee * LEDGER_PAYMENT_SHIPPING_FEE_RATE);
}

export function toLedgerRow(order: Order, entries: readonly LedgerManualEntry[] = []): LedgerRow {
    const manualEntries = entries.filter((entry) => entry.orderId === order.id);
    const purchaseCost = order.sourcingLifeActualPayment?.amount
        ?? manualNumber(manualEntries, "purchaseCostKrw")
        ?? order.expectedCost
        ?? order.sourcingLifeMatch?.estimatedCost
        ?? null;
    const manualCostTotal = manualEntries.reduce((sum, entry) => {
        if (!isLedgerManualCostField(entry.field) || entry.field === "purchaseCostKrw") return sum;
        return sum + (typeof entry.value === "number" ? entry.value : 0);
    }, 0);
    const profit = purchaseCost === null
        ? null
        : order.expectedSettlement + getLedgerNetPaymentShippingIncome(order) - purchaseCost - manualCostTotal;
    const profitRate = profit === null || order.paymentPrice === 0
        ? null
        : profit / order.paymentPrice;

    return { order, purchaseCost, manualCostTotal, profit, profitRate, manualEntries };
}

export function filterLedgerOrders(
    orders: readonly Order[],
    filter: LedgerFilter,
    manualEntries: readonly LedgerManualEntry[] = [],
): LedgerRow[] {
    const effectiveManualEntries = filter.includeManualEntries ? manualEntries : [];
    const start = new Date(`${filter.startDate}T00:00:00`);
    const end = new Date(`${filter.endDate}T23:59:59.999`);

    return orders
        .filter((order) => {
            const orderedAt = parseOrderDate(order.orderDate);
            if (Number.isNaN(orderedAt.getTime()) || orderedAt < start || orderedAt > end) return false;
            if (filter.market !== "all" && order.marketType !== filter.market) return false;
            const orderManualEntries = effectiveManualEntries.filter((entry) => entry.orderId === order.id);
            if (filter.onlyConfirmed && !isLedgerMarginConfirmed(order, orderManualEntries)) return false;
            if (filter.excludeCanceledReturns && isCanceledOrReturned(order)) return false;
            return true;
        })
        .map((order) => toLedgerRow(order, effectiveManualEntries));
}

export function summarizeLedger(rows: readonly LedgerRow[]): LedgerSummary {
    const totalSales = rows.reduce((sum, row) => sum + row.order.paymentPrice, 0);
    const totalProfit = rows.reduce((sum, row) => sum + (row.profit ?? 0), 0);

    return {
        totalOrders: rows.length,
        totalSales,
        totalProfit,
        marginRate: totalSales === 0 ? 0 : (totalProfit / totalSales) * 100,
    };
}

export function ledgerRowToValues(row: LedgerRow): Array<string | number | Date | null> {
    const { order, purchaseCost, profit, profitRate } = row;
    const orderDate = parseOrderDate(order.orderDate);
    const placedAt = order.sourcingPaymentRequestedAt
        ?? order.sourcingLifeActualPayment?.paidAt
        ?? order.sourcingLifeSyncedAt;
    const address = [order.recipient.address, order.recipient.detailAddress].filter(Boolean).join(" ");

    const values: Array<string | number | Date | null> = [
        Number.isNaN(orderDate.getTime()) ? order.orderDate : orderDate,
        MARKET_LABELS[order.marketType],
        order.marketOrderId,
        order.product.productOrderId ?? order.product.id,
        order.product.name,
        order.product.optionName,
        order.product.quantity,
        order.product.marketLink ?? null,
        order.buyerName,
        order.buyerPhone,
        order.recipient.name,
        order.recipient.phone,
        order.recipient.personalCustomsCode ?? null,
        order.recipient.zipCode ?? null,
        address,
        order.recipient.deliveryMessage ?? null,
        order.paymentPrice,
        getLedgerPaymentShippingFee(order),
        order.expectedSettlement,
        placedAt ? parseOrderDate(placedAt) : null,
        order.sourcingLifeMatch ? "소싱라이프" : null,
        order.taoWorldPurchase?.purchaseOrderId ?? order.sourcingLifeOrderId ?? null,
        order.chinaInvoice?.trackingNumber ?? null,
        order.sourcingLifeMatch?.paymentUrl ?? null,
        null,
        order.taoWorldPurchase?.paidAmountCny ?? null,
        purchaseCost,
        order.sourcingForwarder?.name ?? null,
        order.domesticInvoice?.carrier ?? null,
        order.domesticInvoice?.trackingNumber ?? null,
        null,
        null,
        null,
        null,
        null,
        profit,
        profitRate,
        ORDER_STATUS_LABELS[order.status],
    ];

    row.manualEntries.forEach((entry) => {
        const definition = getLedgerManualField(entry.field);
        if (values[definition.columnIndex] !== null && values[definition.columnIndex] !== "") return;

        values[definition.columnIndex] = entry.value;
    });

    return values;
}

export function getLedgerFilename(filter: LedgerFilter, monthly = false): string {
    if (monthly && filter.startDate.slice(0, 7) === filter.endDate.slice(0, 7)) {
        return `commerce-life_ledger_${filter.startDate.slice(0, 7).replace("-", "")}.xlsx`;
    }

    return `commerce-life_ledger_${filter.startDate.replaceAll("-", "")}-${filter.endDate.replaceAll("-", "")}.xlsx`;
}
