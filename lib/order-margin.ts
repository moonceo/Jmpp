import type { Order } from "@/types/order";

export type OrderMarginCostBasis = "ACTUAL_PAYMENT" | "MATCHED_PRICE" | "DIRECT_PURCHASE";

export interface OrderMarginSummary {
    paymentAmount: number;
    sourcingCost: number;
    marginAmount: number;
    marginRate: number;
    costBasis: OrderMarginCostBasis;
}

type MarginOrder = Pick<
    Order,
    "paymentPrice" | "product" | "sourcingLifeActualPayment" | "sourcingLifeMatch" | "sourcingProgressStage" | "expectedCost"
>;

function resolveSourcingCost(order: MarginOrder): { amount: number; basis: OrderMarginCostBasis } | undefined {
    if (typeof order.sourcingLifeActualPayment?.amount === "number") {
        return { amount: order.sourcingLifeActualPayment.amount, basis: "ACTUAL_PAYMENT" };
    }

    if (order.sourcingProgressStage === "EXTERNAL_PURCHASE" && typeof order.expectedCost === "number") {
        return { amount: order.expectedCost, basis: "DIRECT_PURCHASE" };
    }

    if (order.sourcingLifeMatch) {
        if (typeof order.sourcingLifeMatch.estimatedCost === "number") {
            const quantity = Math.max(1, order.sourcingLifeMatch.quantity ?? order.product.quantity);
            return { amount: order.sourcingLifeMatch.estimatedCost * quantity, basis: "MATCHED_PRICE" };
        }
        if (typeof order.expectedCost === "number") {
            return { amount: order.expectedCost, basis: "MATCHED_PRICE" };
        }
    }

    return undefined;
}

export function calculateOrderMargin(order: MarginOrder): OrderMarginSummary | undefined {
    const cost = resolveSourcingCost(order);
    if (!cost) return undefined;

    const paymentAmount = order.paymentPrice;
    const marginAmount = paymentAmount - cost.amount;
    const marginRate = paymentAmount > 0 ? (marginAmount / paymentAmount) * 100 : 0;

    return {
        paymentAmount,
        sourcingCost: cost.amount,
        marginAmount,
        marginRate,
        costBasis: cost.basis,
    };
}
