import { describe, expect, it } from "vitest";
import { getDeliveryHistoryView } from "@/lib/delivery-history";

describe("delivery history", () => {
    it("keeps the full outbound timeline available after delivery", () => {
        const view = getDeliveryHistoryView({
            status: "DELIVERED",
            sourcingProgressStage: "DELIVERED",
            sourcingLifeSyncStatus: "INVOICE_RECEIVED",
            sourcingLifeOrderId: "SL-1",
        });

        expect(view).toMatchObject({ label: "배송완료", currentStepIndex: 4 });
        expect(view?.milestones.map((step) => step.label)).toEqual([
            "결제완료",
            "중국배송",
            "통관",
            "국내배송",
            "배송완료",
        ]);
        expect(view?.milestones.every((step) => step.state === "COMPLETED")).toBe(true);
    });

    it("adds the return journey after the completed outbound journey", () => {
        const view = getDeliveryHistoryView({
            status: "CLAIM",
            previousStatus: "DELIVERED",
            claimType: "RETURN",
            claimStatus: "반품완료",
            claimProcessedAt: "2026-08-20 12:00",
            sourcingProgressStage: "DELIVERED",
            sourcingLifeSyncStatus: "INVOICE_RECEIVED",
            sourcingLifeOrderId: "SL-2",
        });

        expect(view?.label).toBe("반품완료");
        expect(view?.milestones.map((step) => step.label)).toEqual([
            "결제완료",
            "중국배송",
            "통관",
            "국내배송",
            "배송완료",
            "반품회수",
            "반품완료",
        ]);
        expect(view?.milestones.every((step) => step.state === "COMPLETED")).toBe(true);
    });

    it("starts tracking at sourcing payment completion", () => {
        const view = getDeliveryHistoryView({
            status: "SHIPPING",
            sourcingProgressStage: "SOURCED",
            sourcingLifeSyncStatus: "PAID",
            sourcingLifeOrderId: "SL-3",
            sourcingLifeActualPayment: {
                amount: 42_000,
                currency: "KRW",
                paidAt: "2026-08-20T02:00:00.000Z",
            },
        });

        expect(view).toMatchObject({ label: "결제완료", currentStepIndex: 0 });
        expect(view?.events[0]).toMatchObject({ label: "소싱 결제완료" });
    });
});
