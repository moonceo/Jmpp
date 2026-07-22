import { mockOrders } from "@/lib/mock-data/orders";

export interface SourcingOption {
    id: string;
    label: string;
    labelZh: string;
    priceCny: number;
    priceKrw: number;
    stock: number;
}

export interface SourcingMatchCandidate {
    id: string;
    productId: string;
    productName: string;
    productNameZh: string;
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
            productNameZh: "北欧客厅电视柜 2000mm",
            sellerName: "Foshan Furniture",
            thumbnail: "/images/dummy/tv-stand.png",
            deliveryDays: "3-5일",
            options: [
                { id: "white-2000", label: "화이트 / 2000mm", labelZh: "白色 / 2000mm", priceCny: 520, priceKrw: 98280, stock: 32 },
                { id: "oak-2000", label: "오크 / 2000mm", labelZh: "橡木色 / 2000mm", priceCny: 545, priceKrw: 103005, stock: 18 },
                { id: "walnut-1800", label: "월넛 / 1800mm", labelZh: "胡桃木色 / 1800mm", priceCny: 498, priceKrw: 94122, stock: 24 },
                { id: "black-1600", label: "블랙 / 1600mm", labelZh: "黑色 / 1600mm", priceCny: 475, priceKrw: 89775, stock: 11 },
            ],
        },
    ],
    "ORD-20260610-0002": [
        {
            productName: "X10 Plus 스마트 로봇청소기 물걸레 세트",
            productNameZh: "X10 Plus 智能扫地机器人拖布套装",
            sellerName: "Shenzhen CleanTech",
            thumbnail: "/images/dummy/robot-vacuum.png",
            deliveryDays: "2-3일",
            options: [
                { id: "white-basic", label: "화이트 / 기본형", labelZh: "白色 / 基础款", priceCny: 828, priceKrw: 156492, stock: 58 },
                { id: "white-plus", label: "화이트 / 걸레패드 추가", labelZh: "白色 / 增配拖布", priceCny: 858, priceKrw: 162162, stock: 21 },
                { id: "black-basic", label: "블랙 / 기본형", labelZh: "黑色 / 基础款", priceCny: 836, priceKrw: 158004, stock: 33 },
                { id: "silver-soldout", label: "실버 / 품절 예시", labelZh: "银色 / 缺货示例", priceCny: 812, priceKrw: 153468, stock: 0 },
            ],
        },
        {
            productName: "가정용 자동 물걸레 로봇청소기",
            productNameZh: "家用自动拖地扫地机器人",
            sellerName: "Yiwu Home Appliance",
            thumbnail: "/images/dummy/robot-vacuum.png",
            deliveryDays: "3-5일",
            options: [
                { id: "white-standard", label: "화이트 / 스탠다드", labelZh: "白色 / 标准款", priceCny: 790, priceKrw: 149310, stock: 42 },
                { id: "white-kit", label: "화이트 / 소모품 세트", labelZh: "白色 / 耗材套装", priceCny: 832, priceKrw: 157248, stock: 16 },
            ],
        },
    ],
    "ORD-20260609-0003": [
        {
            productName: "캠핑 접이식 경량 체어 1+1",
            productNameZh: "户外露营折叠轻便椅 1+1",
            sellerName: "Ningbo Outdoor",
            thumbnail: "/images/dummy/camping-chair.png",
            deliveryDays: "1-2일",
            options: [
                { id: "green-2p", label: "그린 / 2개 세트", labelZh: "绿色 / 2件套", priceCny: 232, priceKrw: 43848, stock: 75 },
                { id: "black-2p", label: "블랙 / 2개 세트", labelZh: "黑色 / 2件套", priceCny: 232, priceKrw: 43848, stock: 61 },
                { id: "tan-2p", label: "탄 / 2개 세트", labelZh: "卡其色 / 2件套", priceCny: 238, priceKrw: 44982, stock: 28 },
            ],
        },
        {
            productName: "초경량 아웃도어 캠핑 의자",
            productNameZh: "超轻户外露营折叠椅",
            sellerName: "Guangzhou Camp Base",
            thumbnail: "/images/dummy/camping-chair.png",
            deliveryDays: "2-4일",
            options: [
                { id: "green-single", label: "그린 / 단품", labelZh: "绿色 / 单件", priceCny: 109, priceKrw: 20601, stock: 99 },
                { id: "green-set", label: "그린 / 2개", labelZh: "绿色 / 2件", priceCny: 218, priceKrw: 41202, stock: 44 },
            ],
        },
    ],
    "ORD-20260608-0004": [
        {
            productName: "일본 직수입 아보카도 그린 6~10인치 생일 케이크 보온 보냉 가방 (배달용/두꺼운 소재)",
            productNameZh: "日本进口牛油果绿色6到10寸生日蛋糕保温袋外卖专用保冷冷藏袋加厚",
            sellerName: "Guangzhou Cold Chain Pack",
            thumbnail: "/images/product-placeholder.svg",
            deliveryDays: "2-4일",
            options: [
                {
                    id: "avocado-green-zip-5-waterproof",
                    label: "지퍼형【아보카도 그린】5인치 방수",
                    labelZh: "拉链【牛油果绿】5寸防水",
                    priceCny: 51.25,
                    priceKrw: 11250,
                    stock: 68,
                },
            ],
        },
        {
            productName: "빈티지 글라스 무드 조명",
            productNameZh: "复古玻璃氛围台灯",
            sellerName: "Foshan Lighting",
            thumbnail: "/images/dummy/vintage-lamp.png",
            deliveryDays: "1-2일",
            options: [
                { id: "amber-b", label: "앰버 브라운 / Type B", labelZh: "琥珀棕 / Type B", priceCny: 96, priceKrw: 18144, stock: 82 },
                { id: "clear-a", label: "클리어 / Type A", labelZh: "透明 / Type A", priceCny: 92, priceKrw: 17388, stock: 37 },
                { id: "smoke-c", label: "스모크 / Type C", labelZh: "烟灰色 / Type C", priceCny: 101, priceKrw: 19089, stock: 18 },
            ],
        },
        {
            productName: "감성 테이블 글라스 램프",
            productNameZh: "创意桌面玻璃小夜灯",
            sellerName: "Zhongshan Light Shop",
            thumbnail: "/images/dummy/vintage-lamp.png",
            deliveryDays: "2-3일",
            options: [
                { id: "amber", label: "앰버 / 기본형", labelZh: "琥珀色 / 基础款", priceCny: 103, priceKrw: 19467, stock: 54 },
                { id: "brown", label: "브라운 / 기본형", labelZh: "棕色 / 基础款", priceCny: 103, priceKrw: 19467, stock: 47 },
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
            productNameZh: index < source.length ? base.productNameZh : `${base.productNameZh} 相似款 ${index + 1}`,
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
                stock: option.stock === 0 ? 0 : Math.max(5, option.stock - index),
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

export const forwarderProfiles: ForwarderProfile[] = [
    defaultForwarderProfile,
    {
        code: "sl-weihai-a",
        name: "소싱라이프 위해 A센터",
        receiverName: "SL-A센터",
        phone: "18663144075",
        country: "중국",
        province: "산동성 웨이하이시 환취구",
        address1: "경제기술개발구 해빈남로 28호 A동",
        address2: "SLA-22018",
        postalCode: "264205",
    },
    {
        code: "sl-qingdao-b",
        name: "소싱라이프 청도 B센터",
        receiverName: "SL-B센터",
        phone: "18553264076",
        country: "중국",
        province: "산동성 칭다오시 청양구",
        address1: "류팅가도 항안로 16호 B창고",
        address2: "SLB-10427",
        postalCode: "266108",
    },
];

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
