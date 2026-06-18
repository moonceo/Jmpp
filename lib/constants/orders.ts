import { ClaimType, OrderStatus, SourcingLifeSyncStatus } from "@/types/order";

export const ORDER_STATUSES = {
    ALL: ["NEW", "PREPARING", "READY_TO_SHIP", "SHIPPING", "DELIVERED", "CANCELED"] as OrderStatus[],
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
    CLAIM: "취소/반품/교환",
};

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
    CANCEL: "취소",
    RETURN: "반품",
    EXCHANGE: "교환",
};

export const SOURCING_LIFE_STATUS_LABELS: Record<SourcingLifeSyncStatus, string> = {
    NOT_LINKED: "소싱 전",
    MATCHING: "이미지 매칭 중",
    MATCH_SAVED: "매칭 저장",
    PAYMENT_READY: "결제 가능",
    PAID: "소싱라이프 결제완료",
    INVOICE_RECEIVED: "국내송장 수신",
    HOLD: "처리 보류",
};

export const MARKET_LABELS = {
    naver: "스마트스토어",
    coupang: "쿠팡",
    "11st": "11번가",
    gmarket: "G마켓",
    auction: "옥션",
} as const;
