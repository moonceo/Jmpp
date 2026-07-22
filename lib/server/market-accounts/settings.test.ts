import { describe, expect, it } from "vitest";
import { marketAccountSettingsSchema } from "@/lib/server/market-accounts/settings";

describe("marketAccountSettingsSchema", () => {
    it("accepts only documented non-secret settings", () => {
        expect(marketAccountSettingsSchema.parse({
            businessNumber: "123-45-67890",
            feeRate: 3.6,
            autoSyncEnabled: true,
            syncIntervalMinutes: 5,
        })).toEqual({
            businessNumber: "123-45-67890",
            feeRate: 3.6,
            autoSyncEnabled: true,
            syncIntervalMinutes: 5,
        });
    });

    it("rejects accidental secrets and arbitrary PII keys", () => {
        expect(marketAccountSettingsSchema.safeParse({ apiSecret: "plain-text" }).success).toBe(false);
        expect(marketAccountSettingsSchema.safeParse({ recipientPhone: "01012345678" }).success).toBe(false);
    });
});
