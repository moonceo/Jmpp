import { describe, expect, it } from "vitest";
import { createInquiryReplyDraft } from "@/lib/inquiry-ai-draft";
import type { Inquiry } from "@/types/inquiry";

function inquiry(overrides: Partial<Inquiry> = {}): Inquiry {
    return {
        id: "inq-1",
        marketType: "naver",
        status: "waiting",
        type: "배송문의",
        content: "언제 오나요?",
        writerId: "writer",
        createdAt: "2026-08-12 10:00",
        product: {
            name: "테스트 상품",
            thumbnail: "/placeholder.svg",
            marketLink: "https://example.com",
        },
        ...overrides,
    };
}

describe("createInquiryReplyDraft", () => {
    it("uses product context without inventing a delivery date", () => {
        const draft = createInquiryReplyDraft(inquiry());
        expect(draft).toContain("테스트 상품");
        expect(draft).toContain("배송 상태를 확인");
        expect(draft).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it("uses a safe exchange and return holding message", () => {
        const draft = createInquiryReplyDraft(inquiry({ type: "교환/반품" }));
        expect(draft).toContain("교환·반품 가능 여부");
        expect(draft).toContain("상태는 그대로 보관");
    });
});
