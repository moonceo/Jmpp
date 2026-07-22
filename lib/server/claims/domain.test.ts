import { describe, expect, it } from "vitest";
import {
    isClaimStatusAllowedForType,
    isClaimStatusTransitionAllowed,
    isResolutionCoherent,
    isTerminalClaimStatus,
    unavailableClaimActions,
} from "@/lib/server/claims/domain";
import { CLAIM_PROVIDER_ACTIONS } from "@/lib/server/claims/types";

describe("claim domain", () => {
    it("keeps cancellation out of return and replacement stages", () => {
        expect(isClaimStatusAllowedForType("CANCEL", "COLLECTION_PENDING")).toBe(false);
        expect(isClaimStatusAllowedForType("CANCEL", "REPLACEMENT_SHIPPED")).toBe(false);
        expect(isClaimStatusAllowedForType("CANCEL", "REFUNDED")).toBe(true);
    });

    it("allows forward provider jumps but rejects terminal regression", () => {
        expect(isClaimStatusTransitionAllowed("RETURN", "REQUESTED", "RECEIVED")).toBe(true);
        expect(isClaimStatusTransitionAllowed("EXCHANGE", "ON_HOLD", "REPLACEMENT_SHIPPED")).toBe(true);
        expect(isClaimStatusTransitionAllowed("RETURN", "COMPLETED", "REQUESTED")).toBe(false);
        expect(isTerminalClaimStatus("WITHDRAWN")).toBe(true);
    });

    it("keeps replacement resolution exclusive to exchanges", () => {
        expect(isResolutionCoherent("EXCHANGE", "REPLACEMENT", "PENDING")).toBe(true);
        expect(isResolutionCoherent("RETURN", "REPLACEMENT", "PENDING")).toBe(false);
        expect(isResolutionCoherent("RETURN", null, "UNDECIDED")).toBe(true);
        expect(isResolutionCoherent("RETURN", null, "PENDING")).toBe(false);
    });

    it("fails every provider write action closed", () => {
        const availability = unavailableClaimActions();
        expect(Object.keys(availability)).toHaveLength(CLAIM_PROVIDER_ACTIONS.length);
        for (const action of CLAIM_PROVIDER_ACTIONS) {
            expect(availability[action]).toEqual({
                available: false,
                execution: "UNAVAILABLE",
                reason: "CLAIM_PROVIDER_WRITES_NOT_IMPLEMENTED",
            });
        }
    });
});
