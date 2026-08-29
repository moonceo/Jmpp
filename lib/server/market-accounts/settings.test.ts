import { describe, expect, it } from "vitest";
import {
    marketAccountSettingsSchema,
    resolveShippingProcessPreference,
} from "@/lib/server/market-accounts/settings";

describe("marketAccountSettingsSchema", () => {
    it("accepts only documented non-secret settings", () => {
        expect(marketAccountSettingsSchema.parse({
            businessNumber: "123-45-67890",
            feeRate: 3.6,
            autoSyncEnabled: true,
            syncIntervalMinutes: 5,
            shippingProcessPreference: "DIRECT_DELIVERY",
        })).toEqual({
            businessNumber: "123-45-67890",
            feeRate: 3.6,
            autoSyncEnabled: true,
            syncIntervalMinutes: 5,
            shippingProcessPreference: "DIRECT_DELIVERY",
        });
    });

    it("allows direct delivery only for SmartStore and 11st accounts", () => {
        const settings = { shippingProcessPreference: "DIRECT_DELIVERY" };

        expect(resolveShippingProcessPreference("NAVER", settings)).toBe("DIRECT_DELIVERY");
        expect(resolveShippingProcessPreference("ELEVEN_STREET", settings)).toBe("DIRECT_DELIVERY");
        expect(resolveShippingProcessPreference("COUPANG", settings)).toBe("DELIVERY");
        expect(resolveShippingProcessPreference("GMARKET", settings)).toBe("DELIVERY");
        expect(resolveShippingProcessPreference("AUCTION", settings)).toBe("DELIVERY");
    });

    it("allows overseas other delivery only for SmartStore accounts", () => {
        const settings = { shippingProcessPreference: "OVERSEAS_OTHER_DELIVERY" };

        expect(marketAccountSettingsSchema.parse(settings)).toEqual(settings);
        expect(resolveShippingProcessPreference("NAVER", settings)).toBe("OVERSEAS_OTHER_DELIVERY");
        expect(resolveShippingProcessPreference("ELEVEN_STREET", settings)).toBe("DELIVERY");
        expect(resolveShippingProcessPreference("COUPANG", settings)).toBe("DELIVERY");
        expect(resolveShippingProcessPreference("GMARKET", settings)).toBe("DELIVERY");
        expect(resolveShippingProcessPreference("AUCTION", settings)).toBe("DELIVERY");
    });

    it("falls back to invoice delivery for missing and legacy per-order settings", () => {
        expect(resolveShippingProcessPreference("NAVER", {})).toBe("DELIVERY");
        expect(resolveShippingProcessPreference("NAVER", { shippingProcessPreference: "ASK_EACH_TIME" })).toBe("DELIVERY");
    });

    it("rejects accidental secrets and arbitrary PII keys", () => {
        expect(marketAccountSettingsSchema.safeParse({ apiSecret: "plain-text" }).success).toBe(false);
        expect(marketAccountSettingsSchema.safeParse({ recipientPhone: "01012345678" }).success).toBe(false);
    });
});
