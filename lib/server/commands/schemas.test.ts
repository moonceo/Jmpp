import { describe, expect, it } from "vitest";
import { orderItemCommandRequestSchema } from "@/lib/server/commands/schemas";

describe("order item command request validation", () => {
    it.each([
        {
            type: "ORDER_CONFIRM",
            effectKey: "confirm-v1",
            expectedVersion: 1,
            payload: {},
        },
        {
            type: "INVOICE_SUBMIT",
            effectKey: "invoice-v1",
            expectedVersion: 2,
            payload: {
                carrierCode: "CJ",
                trackingNumber: "1234567890",
                dispatchAt: "2026-07-10T12:00:00+09:00",
            },
        },
        {
            type: "DIRECT_DELIVERY",
            effectKey: "direct-v1",
            expectedVersion: 3,
            payload: { dispatchAt: "2026-07-10T03:00:00Z" },
        },
        {
            type: "SHIPPING_PROCESS",
            effectKey: "shipping-process-direct-v3",
            expectedVersion: 3,
            payload: {
                requestedMethod: "DIRECT_DELIVERY",
                dispatchAt: "2026-07-10T03:00:00Z",
            },
        },
        {
            type: "SHIPPING_PROCESS",
            effectKey: "shipping-process-overseas-v3",
            expectedVersion: 3,
            payload: {
                requestedMethod: "OVERSEAS_OTHER_DELIVERY",
                carrierCode: "CH1",
                trackingNumber: "YT2607100001CN",
                dispatchAt: "2026-07-10T03:00:00Z",
            },
        },
        {
            type: "SELLER_CANCEL",
            effectKey: "cancel-v1",
            expectedVersion: 4,
            payload: { reasonCode: "SOLD_OUT", quantity: 1 },
        },
    ])("accepts the supported $type contract", (request) => {
        expect(orderItemCommandRequestSchema.safeParse(request).success).toBe(true);
    });

    it("rejects claim commands until their payload workflow is implemented", () => {
        const result = orderItemCommandRequestSchema.safeParse({
            type: "RETURN_APPROVE",
            effectKey: "return-v1",
            expectedVersion: 1,
            payload: {},
        });

        expect(result.success).toBe(false);
    });

    it("rejects overseas other delivery without an overseas tracking reference", () => {
        expect(orderItemCommandRequestSchema.safeParse({
            type: "SHIPPING_PROCESS",
            effectKey: "shipping-process-overseas-missing",
            expectedVersion: 3,
            payload: {
                requestedMethod: "OVERSEAS_OTHER_DELIVERY",
                dispatchAt: "2026-07-10T03:00:00Z",
            },
        }).success).toBe(false);
    });

    it("rejects seller-cancel reasons outside Naver's current official contract", () => {
        expect(orderItemCommandRequestSchema.safeParse({
            type: "SELLER_CANCEL",
            effectKey: "cancel-v1",
            expectedVersion: 1,
            payload: { reasonCode: "SELLER_REQUEST", quantity: 1 },
        }).success).toBe(false);
    });

    it("rejects incomplete or over-posted invoice payloads", () => {
        expect(orderItemCommandRequestSchema.safeParse({
            type: "INVOICE_SUBMIT",
            effectKey: "invoice-v1",
            expectedVersion: 1,
            payload: { carrierCode: "CJ", trackingNumber: "123" },
        }).success).toBe(false);

        expect(orderItemCommandRequestSchema.safeParse({
            type: "INVOICE_SUBMIT",
            effectKey: "invoice-v1",
            expectedVersion: 1,
            payload: {
                carrierCode: "CJ",
                trackingNumber: "123",
                dispatchAt: "2026-07-10T03:00:00Z",
                clientSecret: "must-not-be-accepted",
            },
        }).success).toBe(false);
    });
});
