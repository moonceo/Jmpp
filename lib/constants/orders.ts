import { ClaimType, MarketType, OrderStatus, SourcingLifeSyncStatus } from "@/types/order";

export const ORDER_STATUSES = {
    ALL: ["NEW", "PREPARING", "READY_TO_SHIP", "SHIPPING", "DELIVERED", "CANCELED", "ON_HOLD"] as OrderStatus[],
    NEW: ["NEW"] as OrderStatus[],
    PREPARING: ["PREPARING"] as OrderStatus[],
    WAITING: ["READY_TO_SHIP"] as OrderStatus[],
    SHIPPING: ["SHIPPING"] as OrderStatus[],
    DELIVERED: ["DELIVERED"] as OrderStatus[],
    CLAIMS: ["CLAIM"] as OrderStatus[],
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
    NEW: "신규주문",
    PREPARING: "상품준비",
    READY_TO_SHIP: "발송대기",
    SHIPPING: "배송중",
    DELIVERED: "배송완료",
    CANCELED: "판매자취소",
    ON_HOLD: "처리보류",
    CLAIM: "취소/반품/교환",
};

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
    CANCEL: "취소",
    RETURN: "반품",
    EXCHANGE: "교환",
};

export const SOURCING_LIFE_STATUS_LABELS: Record<SourcingLifeSyncStatus, string> = {
    NOT_LINKED: "소싱 전",
    MATCHING: "소싱 중",
    MATCH_SAVED: "소싱완료",
    PAYMENT_READY: "결제 가능",
    PAID: "결제완료",
    INVOICE_RECEIVED: "국내송장 수신",
    HOLD: "소싱 처리보류",
};

export const MARKET_LABELS = {
    naver: "스마트스토어",
    coupang: "쿠팡",
    "11st": "11번가",
    gmarket: "G마켓",
    auction: "옥션",
} as const;

export const MARKET_ABBREVIATIONS: Record<MarketType, string> = {
    naver: "N",
    coupang: "C",
    "11st": "11",
    gmarket: "G",
    auction: "A",
};

export const MARKET_BADGE_CLASSES: Record<MarketType, string> = {
    naver: "border-transparent bg-[#03C75A] text-white",
    coupang: "border-transparent bg-[#E94B22] text-white",
    "11st": "border-transparent bg-[#E60012] text-white",
    gmarket: "border-transparent bg-[#00C01E] text-white",
    auction: "border-transparent bg-[#EF3E2E] text-white",
};

export const MARKET_OUTLINE_BADGE_CLASSES: Record<MarketType, string> = {
    naver: "border-[#03C75A]/30 bg-[#03C75A]/10 text-[#03853D]",
    coupang: "border-[#E94B22]/30 bg-[#E94B22]/10 text-[#B83216]",
    "11st": "border-[#E60012]/30 bg-[#E60012]/10 text-[#B8000E]",
    gmarket: "border-[#00C01E]/30 bg-[#00C01E]/10 text-[#006E11]",
    auction: "border-[#EF3E2E]/30 bg-[#EF3E2E]/10 text-[#B82318]",
};
