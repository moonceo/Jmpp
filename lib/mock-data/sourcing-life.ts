import { mockOrders } from "@/lib/mock-data/orders";

export interface SourcingOption {
    id: string;
    label: string;
    priceCny: number;
    priceKrw: number;
    stock: number;
}

export interface SourcingMatchCandidate {
    id: string;
    productId: string;
    productName: string;
    sellerName: string;
    thumbnail: string;
    matchRate: number;
    priceCny: number;
    priceKrw: number;
    salesCount: number;
    deliveryDays: string;
    options: SourcingOption[];
}

export interface ForwarderProfile {
    code: string;
    name: string;
    receiverName: string;
    phone: string;
    country: string;
    province: string;
    address1: string;
    address2: string;
    postalCode: string;
}

const baseCandidates: Record<string, Omit<SourcingMatchCandidate, "id" | "productId" | "matchRate" | "priceCny" | "priceKrw" | "salesCount">[]> = {
    "ORD-20260610-0001": [
        {
            productName: "북유럽 인테리어 TV 거실장 2000",
            sellerName: "Foshan Furniture",
            thumbnail: "/images/dummy/tv-stand.png",
            deliveryDays: "3-5일",
            options: [
                { id: "white-2000", label: "화이트 / 2000mm", priceCny: 520, priceKrw: 98280, stock: 32 },
                { id: "oak-2000", label: "오크 / 2000mm", priceCny: 545, priceKrw: 103005, stock: 18 },
                { id: "walnut-1800", label: "월넛 / 1800mm", priceCny: 498, priceKrw: 94122, stock: 24 },
            ],
        },
    ],
    "ORD-20260610-0002": [
        {
            productName: "X10 Plus 스마트 로봇청소기 물걸레 세트",
            sellerName: "Shenzhen CleanTech",
            thumbnail: "/images/dummy/robot-vacuum.png",
            deliveryDays: "2-3일",
            options: [
                { id: "white-basic", label: "화이트 / 기본형", priceCny: 828, priceKrw: 156492, stock: 58 },
                { id: "white-plus", label: "화이트 / 걸레패드 추가", priceCny: 858, priceKrw: 162162, stock: 21 },
                { id: "black-basic", label: "블랙 / 기본형", priceCny: 836, priceKrw: 158004, stock: 33 },
            ],
        },
        {
            productName: "가정용 자동 물걸레 로봇청소기",
            sellerName: "Yiwu Home Appliance",
            thumbnail: "/images/dummy/robot-vacuum.png",
            deliveryDays: "3-5일",
            options: [
                { id: "white-standard", label: "화이트 / 스탠다드", priceCny: 790, priceKrw: 149310, stock: 42 },
                { id: "white-kit", label: "화이트 / 소모품 세트", priceCny: 832, priceKrw: 157248, stock: 16 },
            ],
        },
    ],
    "ORD-20260609-0003": [
        {
            productName: "캠핑 접이식 경량 체어 1+1",
            sellerName: "Ningbo Outdoor",
            thumbnail: "/images/dummy/camping-chair.png",
            deliveryDays: "1-2일",
            options: [
                { id: "green-2p", label: "그린 / 2개 세트", priceCny: 232, priceKrw: 43848, stock: 75 },
                { id: "black-2p", label: "블랙 / 2개 세트", priceCny: 232, priceKrw: 43848, stock: 61 },
                { id: "tan-2p", label: "탄 / 2개 세트", priceCny: 238, priceKrw: 44982, stock: 28 },
            ],
        },
        {
            productName: "초경량 아웃도어 캠핑 의자",
            sellerName: "Guangzhou Camp Base",
            thumbnail: "/images/dummy/camping-chair.png",
            deliveryDays: "2-4일",
            options: [
                { id: "green-single", label: "그린 / 단품", priceCny: 109, priceKrw: 20601, stock: 99 },
                { id: "green-set", label: "그린 / 2개", priceCny: 218, priceKrw: 41202, stock: 44 },
            ],
        },
    ],
    "ORD-20260608-0004": [
        {
            productName: "빈티지 글라스 무드 조명",
            sellerName: "Foshan Lighting",
            thumbnail: "/images/dummy/vintage-lamp.png",
            deliveryDays: "1-2일",
            options: [
                { id: "amber-b", label: "앰버 브라운 / Type B", priceCny: 96, priceKrw: 18144, stock: 82 },
                { id: "clear-a", label: "클리어 / Type A", priceCny: 92, priceKrw: 17388, stock: 37 },
                { id: "smoke-c", label: "스모크 / Type C", priceCny: 101, priceKrw: 19089, stock: 18 },
            ],
        },
        {
            productName: "감성 테이블 글라스 램프",
            sellerName: "Zhongshan Light Shop",
            thumbnail: "/images/dummy/vintage-lamp.png",
            deliveryDays: "2-3일",
            options: [
                { id: "amber", label: "앰버 / 기본형", priceCny: 103, priceKrw: 19467, stock: 54 },
                { id: "brown", label: "브라운 / 기본형", priceCny: 103, priceKrw: 19467, stock: 47 },
            ],
        },
    ],
};

function buildCandidates(orderId: string): SourcingMatchCandidate[] {
    const source = baseCandidates[orderId] ?? baseCandidates["ORD-20260608-0004"];

    return Array.from({ length: 20 }, (_, index) => {
        const base = source[index % source.length];
        const optionBase = base.options[0];
        const variation = index * 3;
        const matchRate = Math.max(72, 99 - index);
        const priceCny = optionBase.priceCny + variation;
        const priceKrw = optionBase.priceKrw + variation * 189;

        return {
            ...base,
            id: `${orderId}-MATCH-${String(index + 1).padStart(2, "0")}`,
            productId: `SL-P-${orderId.slice(-4)}-${String(index + 1).padStart(2, "0")}`,
            productName: index < source.length ? base.productName : `${base.productName} 유사상품 ${index + 1}`,
            sellerName: index < source.length ? base.sellerName : `${base.sellerName} ${index + 1}호점`,
            matchRate,
            priceCny,
            priceKrw,
            salesCount: 2460 - index * 87,
            options: base.options.map((option, optionIndex) => ({
                ...option,
                id: `${option.id}-${index + 1}`,
                priceCny: option.priceCny + variation + optionIndex * 2,
                priceKrw: option.priceKrw + variation * 189 + optionIndex * 378,
                stock: Math.max(5, option.stock - index),
            })),
        };
    });
}

export const sourcingMatchCandidates: Record<string, SourcingMatchCandidate[]> = {
    "ORD-20260610-0001": buildCandidates("ORD-20260610-0001"),
    "ORD-20260610-0002": buildCandidates("ORD-20260610-0002"),
    "ORD-20260609-0003": buildCandidates("ORD-20260609-0003"),
    "ORD-20260608-0004": buildCandidates("ORD-20260608-0004"),
};

export const defaultForwarderProfile: ForwarderProfile = {
    code: "hwan875",
    name: "타배",
    receiverName: "타배",
    phone: "18563144074",
    country: "중국",
    province: "산동성 웨이하이시 환취구",
    address1: "봉림가도 오동로 500미터 광화원 2호 창고",
    address2: "TB41192",
    postalCode: "264205",
};

export function getSourcingCandidates(orderId: string) {
    return sourcingMatchCandidates[orderId] ?? sourcingMatchCandidates["ORD-20260608-0004"];
}

export function getOrderForSourcing(orderId?: string | null) {
    return mockOrders.find((order) => order.id === orderId) ?? mockOrders[3];
}

export function getSelectedSourcingCandidate(orderId?: string | null, matchId?: string | null) {
    const candidates = getSourcingCandidates(orderId ?? "");
    return candidates.find((candidate) => candidate.id === matchId) ?? candidates[0];
}

export function getSelectedSourcingOption(candidate: SourcingMatchCandidate, optionId?: string | null) {
    return candidate.options.find((option) => option.id === optionId) ?? candidate.options[0];
}
