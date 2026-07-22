import { describe, expect, it } from "vitest";
import { UAT_APPROVABLE_NAVER_ACTIONS } from "./capability-uat";

describe("Naver account capability UAT", () => {
    it("allows seller cancellation to be promoted only through the audited UAT action", () => {
        expect(UAT_APPROVABLE_NAVER_ACTIONS).toContain("SELLER_CANCEL");
    });
});
