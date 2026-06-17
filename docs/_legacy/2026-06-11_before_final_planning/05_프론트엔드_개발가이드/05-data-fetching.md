---
버전: v1.0
최종수정일: 2026-02-20
작성자/승인자: 기획팀 / 미상
상태: [Review]
---

# 데이터 페칭 및 상태 관리

## 개요

프로젝트는 **React Query (TanStack Query)**를 사용하여 서버 데이터를 관리합니다. 현재는 Mock 데이터를 사용하며, 백엔드 연동 시 API 호출로 교체합니다.

---

## 데이터 페칭 훅

### 위치: `hooks/`

| 훅 | 용도 | 데이터 소스 |
|----|------|------------|
| `useDashboardMetrics()` | 대시보드 지표 | `lib/mock-data/dashboard.ts` |
| `useOrders()` | 주문 목록 | `lib/mock-data/orders.ts` |
| `useNotifications()` | 알림 목록 | `lib/mock-data/dashboard.ts` |

### 사용 예시

```tsx
// hooks/use-orders.ts
import { useQuery } from "@tanstack/react-query";
import { mockOrders } from "@/lib/mock-data/orders";

export function useOrders() {
  return useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      // 현재: Mock 데이터 반환
      return mockOrders;
      
      // 백엔드 연동 시:
      // const response = await fetch("/api/orders");
      // return response.json();
    },
  });
}
```

### 페이지에서 사용

```tsx
"use client";

import { useOrders } from "@/hooks/use-orders";

export default function OrdersPage() {
  const { data: orders, isLoading, error } = useOrders();

  if (isLoading) return <div>로딩중...</div>;
  if (error) return <div>에러 발생</div>;

  return <OrderTable data={orders} />;
}
```

---

## Mock 데이터 구조

### 위치: `lib/mock-data/`

| 파일 | 내용 |
|------|------|
| `dashboard.ts` | 대시보드 지표, 알림, 공지사항 |
| `orders.ts` | 주문 목록 |
| `inquiries.ts` | 문의 목록 |

### 예시: 주문 Mock 데이터

```typescript
// lib/mock-data/orders.ts
export const mockOrders: Order[] = [
  {
    id: "ORD-001",
    marketOrderId: "2024012300001",
    status: "신규 주문",
    orderDate: "2024-01-23",
    market: { name: "스마트스토어", icon: "/naver.svg" },
    product: {
      name: "원목 스툴",
      optionName: "블랙 / 원형",
      quantity: 1,
      thumbnail: "/product1.jpg",
    },
    buyer: {
      name: "김**",
      phone: "010-****-1234",
    },
    paymentPrice: 35000,
    platformFee: 3500,
    expectedSettlement: 31500,
    // ...
  },
];
```

---

## 상태 관리 (Zustand)

### 위치: `lib/stores/`

클라이언트 전용 상태는 Zustand를 사용합니다.

```typescript
// lib/stores/dashboard-store.ts
import { create } from "zustand";

interface DashboardStore {
  selectedMonth: Date;
  setSelectedMonth: (date: Date) => void;
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  selectedMonth: new Date(),
  setSelectedMonth: (date) => set({ selectedMonth: date }),
}));
```

---

## 백엔드 연동 시 변경 사항

### 1. 훅 수정

```typescript
// 변경 전 (Mock)
export function useOrders() {
  return useQuery({
    queryKey: ["orders"],
    queryFn: async () => mockOrders,
  });
}

// 변경 후 (API)
export function useOrders() {
  return useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const response = await fetch("/api/orders");
      if (!response.ok) throw new Error("Failed to fetch orders");
      return response.json();
    },
  });
}
```

### 2. Mutation 추가

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useUpdateOrder() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (order: Partial<Order>) => {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify(order),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
```

---

## React Query 설정

### 프로바이더 (`components/providers.tsx`)

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1분
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```
