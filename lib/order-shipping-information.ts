import type { Order } from "@/types/order";

type ShippingInformationOrder = Pick<Order, "domesticInvoice" | "chinaInvoice" | "marketDeliveryMethod">;

export interface OrderShippingInformation {
    domesticCarrier?: string;
    domesticTrackingNumber?: string;
    isDirectDelivery: boolean;
    directDeliveryLabel?: "직접전달";
    marketProcessingLabel?: "직접전달" | "해외기타배송";
    chinaCarrier?: string;
    chinaTrackingNumber?: string;
}

export function getOrderShippingInformation(order: ShippingInformationOrder): OrderShippingInformation {
    const isDirectDelivery = order.marketDeliveryMethod === "DIRECT_DELIVERY";
    const isOverseasOtherDelivery = order.marketDeliveryMethod === "OVERSEAS_OTHER_DELIVERY";

    return {
        domesticCarrier: order.domesticInvoice?.carrier,
        domesticTrackingNumber: order.domesticInvoice?.trackingNumber,
        isDirectDelivery,
        ...(isDirectDelivery ? { directDeliveryLabel: "직접전달" as const } : {}),
        ...(isDirectDelivery ? { marketProcessingLabel: "직접전달" as const } : {}),
        ...(isOverseasOtherDelivery ? { marketProcessingLabel: "해외기타배송" as const } : {}),
        chinaCarrier: order.chinaInvoice?.carrier,
        chinaTrackingNumber: order.chinaInvoice?.trackingNumber,
    };
}
