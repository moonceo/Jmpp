import { describe, expect, it } from "vitest";
import {
    buildClaimsUrl,
    claimEntryActionLabel,
    formatClaimDateTime,
    getBuyerClaimActions,
} from "@/components/claims/claims-page-client";
import { DEMO_BUYER_CLAIMS } from "@/lib/mock-data/claims";

describe("claims client query helpers", () => {
    it("keeps the signed-cursor filter tuple stable in the request URL", () => {
        const url = buildClaimsUrl({
            cursor: "signed-cursor",
            claimType: "RETURN",
            status: "APPROVED",
            requester: "CUSTOMER",
            deadlineBefore: "2026-07-12T00:00:00.000Z",
            activeOnly: true,
            search: "  ORDER-1  ",
        });
        const parsed = new URL(url, "https://example.test");

        expect(Object.fromEntries(parsed.searchParams)).toEqual({
            limit: "50",
            cursor: "signed-cursor",
            claimType: "RETURN",
            status: "APPROVED",
            requesterType: "CUSTOMER",
            deadlineBefore: "2026-07-12T00:00:00.000Z",
            activeOnly: "true",
            search: "ORDER-1",
        });
    });

    it("does not render invalid or absent timestamps as a real deadline", () => {
        expect(formatClaimDateTime(null)).toBe("-");
        expect(formatClaimDateTime("not-a-date")).toBe("-");
    });

    it("covers buyer-initiated Naver and Coupang cancel, return, and exchange paths", () => {
        expect(DEMO_BUYER_CLAIMS).toHaveLength(8);
        expect(DEMO_BUYER_CLAIMS.every((claim) => claim.requesterType === "CUSTOMER")).toBe(true);

        for (const marketCode of ["NAVER", "COUPANG"] as const) {
            for (const claimType of ["CANCEL", "RETURN", "EXCHANGE"] as const) {
                expect(DEMO_BUYER_CLAIMS.some((claim) => (
                    claim.marketCode === marketCode && claim.claimType === claimType
                ))).toBe(true);
            }
        }

        expect(DEMO_BUYER_CLAIMS.some((claim) => claim.deadlineOverdue)).toBe(true);
        expect(DEMO_BUYER_CLAIMS.every((claim) => getBuyerClaimActions(claim).length > 0)).toBe(true);
    });

    it("offers state-specific buttons for Naver and Coupang buyer claims", () => {
        expect(claimEntryActionLabel("CANCEL")).toBe("취소처리");
        expect(claimEntryActionLabel("RETURN")).toBe("반품처리");
        expect(claimEntryActionLabel("EXCHANGE")).toBe("교환처리");

        expect(getBuyerClaimActions({
            marketCode: "NAVER",
            claimType: "CANCEL",
            normalizedStatus: "APPROVAL_PENDING",
            marketStatusRaw: "CANCEL_REQUEST",
        }).map((action) => action.label)).toEqual(["취소 승인"]);

        expect(getBuyerClaimActions({
            marketCode: "COUPANG",
            claimType: "CANCEL",
            normalizedStatus: "UNDER_REVIEW",
            marketStatusRaw: "RELEASE_STOP_UNCHECKED",
        }).map((action) => action.label)).toEqual(["출고중지 완료", "이미출고 처리"]);

        expect(getBuyerClaimActions({
            marketCode: "COUPANG",
            claimType: "EXCHANGE",
            normalizedStatus: "REPLACEMENT_PENDING",
            marketStatusRaw: "REDELIVERY",
        }).map((action) => action.label)).toEqual(["교환 송장 등록"]);

        expect(getBuyerClaimActions({
            marketCode: "COUPANG",
            claimType: "RETURN",
            normalizedStatus: "ON_HOLD",
            marketStatusRaw: "RETURN_HOLDBACK",
        })).toEqual([]);

        expect(getBuyerClaimActions({
            marketCode: "COUPANG",
            claimType: "RETURN",
            normalizedStatus: "RECEIVED",
            marketStatusRaw: "RETURNS_UNCHECKED",
        }).map((action) => action.label)).toEqual(["반품 입고 확인"]);

        expect(getBuyerClaimActions({
            marketCode: "COUPANG",
            claimType: "RETURN",
            normalizedStatus: "RECEIVED",
            marketStatusRaw: "VENDOR_WAREHOUSE_CONFIRM",
        }).map((action) => action.label)).toEqual(["반품 승인"]);
    });
});
