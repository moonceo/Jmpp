import { z } from "zod";

export type ShippingProcessPreference = "DELIVERY" | "DIRECT_DELIVERY" | "OVERSEAS_OTHER_DELIVERY";

export const marketAccountSettingsSchema = z.object({
    businessNumber: z.string().trim().min(1).max(20).regex(/^[0-9-]+$/).optional(),
    feeRate: z.number().min(0).max(100).optional(),
    autoSyncEnabled: z.boolean().optional(),
    syncIntervalMinutes: z.number().int().min(1).max(1_440).optional(),
    automaticInvoiceSubmission: z.boolean().optional(),
    directDeliveryEnabled: z.boolean().optional(),
    shippingProcessPreference: z.enum(["DELIVERY", "DIRECT_DELIVERY", "OVERSEAS_OTHER_DELIVERY"]).optional(),
    priceChangeTolerancePercent: z.number().min(0).max(100).optional(),
    maxPurchaseAmountKrw: z.number().int().min(0).max(1_000_000_000).optional(),
}).strict();

export type MarketAccountSettings = z.infer<typeof marketAccountSettingsSchema>;

export function resolveShippingProcessPreference(
    marketCode: string,
    settings: unknown,
): ShippingProcessPreference {
    const parsed = marketAccountSettingsSchema.safeParse(settings);
    if (!parsed.success) return "DELIVERY";

    const preference = parsed.data.shippingProcessPreference;
    if (preference === "OVERSEAS_OTHER_DELIVERY") {
        return marketCode === "NAVER" ? preference : "DELIVERY";
    }
    if (preference === "DIRECT_DELIVERY") {
        return marketCode === "NAVER" || marketCode === "ELEVEN_STREET"
            ? preference
            : "DELIVERY";
    }
    return "DELIVERY";
}
