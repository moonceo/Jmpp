---
버전: v1.0
최종수정일: 2026-02-20
작성자/승인자: 기획팀 / 미상
상태: [Review]
---

# TypeScript 타입 정의

## 개요

프로젝트의 타입 정의는 `types/` 폴더에 위치합니다. 백엔드 API 스키마와 동기화되어야 합니다.

---

## 주문 타입 (`types/order.ts`)

```typescript
export type OrderStatus =
  | "신규 주문"
  | "마진검토중"
  | "소싱중"
  | "발송대기"
  | "배송중"
  | "배송완료"
  | "구매확정"
  | "교환요청"
  | "반품요청"
  | "취소요청"
  | "취소완료";

export interface Order {
  id: string;                    // 시스템 주문 ID
  marketOrderId: string;         // 마켓 주문번호
  status: OrderStatus;           // 주문 상태
  orderDate: string;             // 주문일시 (ISO 8601)
  
  // 마켓 정보
  market: {
    name: string;                // "스마트스토어", "쿠팡" 등
    icon: string;                // 마켓 아이콘 경로
  };
  
  // 상품 정보
  product: {
    name: string;                // 상품명
    optionName: string;          // 옵션명
    quantity: number;            // 수량
    thumbnail: string;           // 썸네일 이미지 URL
  };
  
  // 구매자 정보
  buyer: {
    name: string;                // 구매자명 (마스킹)
    phone: string;               // 연락처 (마스킹)
    address?: string;            // 배송지
    pccc?: string;               // 개인통관고유부호
    pcccValid?: boolean;         // PCCC 유효성
  };
  
  // 금액 정보
  paymentPrice: number;          // 결제금액
  platformFee: number;           // 마켓 수수료
  expectedSettlement: number;    // 정산예정금액
  
  // 소싱 정보 (선택)
  sourcing?: {
    productName: string;         // 소싱 상품명
    priceCNY: number;            // 위안화 가격
    priceKRW: number;            // 원화 환산 가격
    matchingRate: number;        // AI 매칭률 (%)
    thumbnail: string;           // 소싱 상품 이미지
  };
  
  // 배송 정보 (선택)
  shipping?: {
    carrier: string;             // 택배사
    trackingNumber: string;      // 송장번호
    shippedAt?: string;          // 발송일시
    deliveredAt?: string;        // 배송완료일시
  };
  
  // 배대지 정보 (선택)
  warehouse?: {
    warehouseId: string;         // 배대지 ID
    status: string;              // 배대지 상태
    weight?: number;             // 무게 (kg)
    inspectionPhotos?: string[]; // 검수 사진 URL 배열
  };
}
```

---

## 문의 타입 (`types/inquiry.ts`)

```typescript
export type InquiryType = "상품문의" | "배송문의" | "교환/반품" | "기타문의";

export interface Inquiry {
  id: string;                    // 문의 ID
  type: InquiryType;             // 문의 유형
  content: string;               // 문의 내용
  createdAt: string;             // 문의 일시
  
  // 작성자 정보
  writerId: string;              // 작성자 ID (마스킹)
  
  // 상품 정보
  product?: {
    name: string;
    optionName: string;
    thumbnail: string;
  };
  
  // 마켓 정보
  market: {
    name: string;
    icon: string;
  };
  
  // 답변 정보
  reply?: {
    content: string;
    repliedAt: string;
  };
  
  // 상태
  isAnswered: boolean;
}
```

---

## 대시보드 타입

```typescript
export interface DashboardMetrics {
  totalSales: number;            // 총 매출
  expectedSettlement: number;    // 정산예정금
  totalCost: number;             // 총 비용
  expectedMargin: number;        // 예상마진
  cashback: number;              // 캐시백
  orderCount: number;            // 주문건수
}

export interface PendingTask {
  label: string;                 // 업무명
  count: number;                 // 건수
  href: string;                  // 링크
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  isRead: boolean;
}
```

---

## 마켓 타입

```typescript
export type MarketType = "naver" | "coupang" | "11st" | "gmarket";

export interface Market {
  id: string;
  type: MarketType;
  name: string;                  // 스토어명
  isConnected: boolean;
  lastSyncAt?: string;
  credentials?: {
    apiKey?: string;
    secretKey?: string;
    // 마켓별 추가 필드
  };
}
```

---

## 유틸리티 타입

```typescript
// API 응답 래퍼
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

// 페이지네이션
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// 페이지네이션 포함 응답
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: Pagination;
}
```

---

## 타입 동기화 주의사항

1. **백엔드와 동기화**: API 스키마 변경 시 타입도 함께 수정
2. **Optional 필드**: 백엔드에서 null/undefined 가능한 필드는 `?` 표시
3. **Enum vs Union**: 상태값은 Union 타입 사용 (`type OrderStatus = "..." | "..."`)
4. **날짜 형식**: ISO 8601 문자열 사용 (`string`)
