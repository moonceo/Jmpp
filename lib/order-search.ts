import type { MarketType, Order } from "@/types/order";

export type OrderPeriodFilter = "today" | "3d" | "7d" | "1m" | "custom";

interface OrderSearchFilters {
    searchTerm: string;
    marketFilters: MarketType[];
    accountFilters: string[];
    periodFilter: OrderPeriodFilter;
    startDate?: string;
    endDate?: string;
    referenceDate?: Date;
}

export function getOrderAccountKey(order: Pick<Order, "marketType" | "storeName">): string {
    return `${order.marketType}:${order.storeName}`;
}

function startOfDay(value: Date): Date {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
}

function parseOrderDate(value: string): Date {
    return new Date(value.replace(/-/g, "/"));
}

export function filterOrders(orders: Order[], filters: OrderSearchFilters): Order[] {
    const term = filters.searchTerm.trim().toLowerCase();
    const normalizedPhoneTerm = term.replace(/\D/g, "");
    const referenceDate = filters.referenceDate ?? new Date();
    const periodDays = filters.periodFilter === "today"
        ? 0
        : filters.periodFilter === "3d"
            ? 3
            : filters.periodFilter === "7d"
                ? 7
                : filters.periodFilter === "1m"
                    ? 30
                    : undefined;
    const cutoff = periodDays === undefined
        ? undefined
        : (() => {
            const date = startOfDay(referenceDate);
            date.setDate(date.getDate() - periodDays);
            return date;
        })();
    const start = filters.periodFilter === "custom" && filters.startDate
        ? new Date(`${filters.startDate}T00:00:00`)
        : undefined;
    const end = filters.periodFilter === "custom" && filters.endDate
        ? new Date(`${filters.endDate}T23:59:59`)
        : undefined;

    return orders.filter((order) => {
        const textTargets = [
            order.product.name,
            order.product.optionName,
            order.marketOrderId,
            order.product.productOrderId,
            order.product.id,
            order.id,
            order.buyerName,
            order.buyerId,
            order.recipient.name,
            order.recipient.deliveryMessage,
            order.recipient.personalCustomsCode,
            order.storeName,
        ];
        const phoneTargets = [order.buyerPhone, order.recipient.phone]
            .map((value) => value.replace(/\D/g, ""));
        const matchesSearch = !term
            || textTargets.some((value) => value?.toLowerCase().includes(term))
            || Boolean(normalizedPhoneTerm && phoneTargets.some((phone) => phone.includes(normalizedPhoneTerm)));
        const matchesMarket = filters.marketFilters.length === 0 || filters.marketFilters.includes(order.marketType);
        const matchesAccount = filters.accountFilters.length === 0 || filters.accountFilters.includes(getOrderAccountKey(order));
        const orderDate = parseOrderDate(order.orderDate);
        const matchesPeriod = (!cutoff || orderDate >= cutoff)
            && (!start || orderDate >= start)
            && (!end || orderDate <= end);

        return matchesSearch && matchesMarket && matchesAccount && matchesPeriod;
    });
}
