---
버전: v1.0
최종수정일: 2026-02-20
작성자/승인자: 기획팀 / 미상
상태: [Review]
---

# 백엔드 API 연동 가이드

## 개요

이 문서는 프론트엔드와 백엔드 API를 연동하기 위한 가이드입니다. 현재 프론트엔드는 Mock 데이터를 사용하고 있으며, 백엔드 API가 준비되면 간단한 수정으로 연동할 수 있습니다.

---

## 필요한 API 목록

### 1. 대시보드

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/api/dashboard/metrics` | 대시보드 핵심 지표 |
| GET | `/api/dashboard/tasks` | 업무 현황 (신규주문, 발송대기 등) |
| GET | `/api/dashboard/calendar` | 월별 매출 데이터 |

### 2. 주문 관리

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/api/orders` | 주문 목록 조회 |
| GET | `/api/orders/:id` | 주문 상세 조회 |
| PATCH | `/api/orders/:id` | 주문 정보 수정 |
| POST | `/api/orders/:id/cancel` | 주문 취소 |
| POST | `/api/orders/:id/tracking` | 송장 번호 등록 |

#### 쿼리 파라미터 (GET /api/orders)

```
?status=신규주문,발송대기     # 상태 필터 (콤마 구분)
?search=검색어               # 주문번호, 상품명, 구매자명 검색
?startDate=2024-01-01        # 시작일
?endDate=2024-01-31          # 종료일
?page=1&limit=20             # 페이지네이션
```

### 3. 문의 관리

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/api/inquiries` | 문의 목록 조회 |
| GET | `/api/inquiries/:id` | 문의 상세 조회 |
| POST | `/api/inquiries/:id/reply` | 문의 답변 등록 |

### 4. 마켓 연동

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/api/markets` | 연동된 마켓 목록 |
| POST | `/api/markets/connect` | 마켓 API 연동 |
| DELETE | `/api/markets/:id` | 마켓 연동 해제 |
| POST | `/api/markets/:id/sync` | 마켓 데이터 동기화 |

### 5. 사용자 설정

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/api/me/profile` | 프로필 조회 |
| PATCH | `/api/me/profile` | 프로필 수정 |
| GET | `/api/me/notifications/settings` | 알림 설정 조회 |
| PATCH | `/api/me/notifications/settings` | 알림 설정 수정 |

---

## API 응답 형식

### 성공 응답

```json
{
  "success": true,
  "data": { ... }
}
```

### 목록 응답 (페이지네이션)

```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### 에러 응답

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "주문번호는 필수입니다."
  }
}
```

---

## 프론트엔드 연동 방법

### 1. 환경 변수 설정

```env
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

### 2. API 클라이언트 생성

```typescript
// lib/api-client.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function apiClient<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      // Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}
```

### 3. 훅 수정

```typescript
// hooks/use-orders.ts
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Order } from "@/types/order";

export function useOrders(filters?: OrderFilters) {
  return useQuery({
    queryKey: ["orders", filters],
    queryFn: () => apiClient<Order[]>("/orders", {
      method: "GET",
    }),
  });
}
```

---

## 인증 연동 (추후 구현)

### 필요한 API

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/logout` | 로그아웃 |
| POST | `/api/auth/refresh` | 토큰 갱신 |
| GET | `/api/auth/me` | 현재 사용자 정보 |

### 프론트엔드 구현 예정

1. 로그인 페이지 (`/login`)
2. 인증 미들웨어 (로그인 필요 페이지 보호)
3. 토큰 저장 및 자동 갱신
4. 로그아웃 처리

---

## 연동 체크리스트

- [ ] API URL 환경 변수 설정
- [ ] API 클라이언트 구현
- [ ] 훅 수정 (Mock → API)
- [ ] 에러 핸들링 추가
- [ ] 로딩 상태 UI 개선
- [ ] 인증 연동
- [ ] 권한 체크 미들웨어
