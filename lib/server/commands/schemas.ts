import { z } from "zod";
import { NAVER_SELLER_CANCEL_REASONS } from "@/lib/server/integrations/naver/types";

const nonControlText = (maximumLength: number) => z.string()
    .trim()
    .min(1)
    .max(maximumLength)
    .regex(/^[^\u0000-\u001f\u007f]+$/, "Control characters are not allowed.");

const commandBase = {
    effectKey: nonControlText(200),
    expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
};

export const orderConfirmPayloadSchema = z.object({}).strict();

export const invoiceSubmitPayloadSchema = z.object({
    carrierCode: nonControlText(50),
    trackingNumber: nonControlText(100),
    dispatchAt: z.iso.datetime({ offset: true }),
}).strict();

export const directDeliveryPayloadSchema = z.object({
    dispatchAt: z.iso.datetime({ offset: true }),
}).strict();

export const shippingProcessPayloadSchema = z.object({
    requestedMethod: z.enum(["DELIVERY", "DIRECT_DELIVERY", "OVERSEAS_OTHER_DELIVERY"]),
    dispatchAt: z.iso.datetime({ offset: true }),
    carrierCode: nonControlText(50).optional(),
    trackingNumber: nonControlText(100).optional(),
}).strict().superRefine((value, context) => {
    if (value.requestedMethod !== "OVERSEAS_OTHER_DELIVERY") return;
    if (!value.carrierCode || !value.trackingNumber) {
        context.addIssue({
            code: "custom",
            message: "Overseas other delivery requires carrierCode and trackingNumber.",
            path: ["trackingNumber"],
        });
    }
});

export const sellerCancelPayloadSchema = z.object({
    reasonCode: z.enum(NAVER_SELLER_CANCEL_REASONS),
    reasonDetail: nonControlText(500).optional(),
    quantity: z.number().int().positive().max(100_000).optional(),
}).strict();

/**
 * This endpoint intentionally exposes only commands whose worker contracts are
 * defined. Claim commands and every other domain command fail validation until
 * their market-specific payload and transition rules are implemented.
 */
export const orderItemCommandRequestSchema = z.discriminatedUnion("type", [
    z.object({
        ...commandBase,
        type: z.literal("ORDER_CONFIRM"),
        payload: orderConfirmPayloadSchema,
    }).strict(),
    z.object({
        ...commandBase,
        type: z.literal("INVOICE_SUBMIT"),
        payload: invoiceSubmitPayloadSchema,
    }).strict(),
    z.object({
        ...commandBase,
        type: z.literal("DIRECT_DELIVERY"),
        payload: directDeliveryPayloadSchema,
    }).strict(),
    z.object({
        ...commandBase,
        type: z.literal("SHIPPING_PROCESS"),
        payload: shippingProcessPayloadSchema,
    }).strict(),
    z.object({
        ...commandBase,
        type: z.literal("SELLER_CANCEL"),
        payload: sellerCancelPayloadSchema,
    }).strict(),
]);

export type OrderItemCommandRequest = z.infer<typeof orderItemCommandRequestSchema>;
export type SupportedOrderItemCommandType = OrderItemCommandRequest["type"];
export type SupportedOrderItemCommandPayload = OrderItemCommandRequest["payload"];
