import type { MarketType } from "@/types/order";

export interface MockLinkedStore {
    marketType: MarketType;
    storeName: string;
}

export const mockLinkedStores: readonly MockLinkedStore[] = [
    { marketType: "naver", storeName: "리빙온마켓" },
    { marketType: "naver", storeName: "홈데코랩" },
    { marketType: "coupang", storeName: "쿠팡라이프샵" },
    { marketType: "coupang", storeName: "스마트홈셀러" },
    { marketType: "11st", storeName: "글로벌픽스토어" },
    { marketType: "11st", storeName: "홈앤키친11" },
    { marketType: "gmarket", storeName: "지마켓리빙박스" },
    { marketType: "gmarket", storeName: "데일리홈마켓" },
    { marketType: "auction", storeName: "옥션리빙셀렉트" },
    { marketType: "auction", storeName: "하우스웨어옥션" },
];
