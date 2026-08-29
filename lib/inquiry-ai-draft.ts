import type { Inquiry } from "@/types/inquiry";

export function createInquiryReplyDraft(inquiry: Inquiry): string {
    const productName = inquiry.product?.name ? `「${inquiry.product.name}」` : "문의하신 상품";

    if (inquiry.type.includes("배송")) {
        return `안녕하세요, 고객님. ${productName}의 현재 배송 상태를 확인하고 있습니다. 정확한 출고일과 예상 도착일을 확인한 뒤 이 문의를 통해 다시 안내드리겠습니다. 조금만 기다려 주세요. 감사합니다.`;
    }

    if (inquiry.type.includes("교환") || inquiry.type.includes("반품")) {
        return `안녕하세요, 고객님. ${productName} 이용에 불편을 드려 죄송합니다. 보내주신 문의 내용을 확인했으며, 교환·반품 가능 여부와 필요한 절차를 확인한 뒤 안내드리겠습니다. 상품과 포장 상태는 그대로 보관해 주세요.`;
    }

    if (inquiry.type.includes("상품")) {
        return `안녕하세요, 고객님. ${productName}에 관심 가져주셔서 감사합니다. 문의하신 사양과 구성품을 판매 페이지 및 공급처 정보와 대조해 확인한 뒤 정확히 안내드리겠습니다.`;
    }

    return `안녕하세요, 고객님. ${productName} 관련 문의를 접수했습니다. 문의하신 내용을 확인한 뒤 정확한 답변을 이 문의를 통해 안내드리겠습니다. 감사합니다.`;
}
