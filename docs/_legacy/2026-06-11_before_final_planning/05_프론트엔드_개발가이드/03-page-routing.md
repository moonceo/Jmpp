---
버전: v1.0
최종수정일: 2026-02-20
작성자/승인자: 기획팀 / 미상
상태: [Review]
---

# 페이지 라우팅 및 네비게이션

## 라우팅 구조

Next.js App Router를 사용하여 파일 시스템 기반 라우팅을 구현합니다.

```
URL 경로              →  파일 경로
/                     →  app/page.tsx (대시보드 메인)
/dashboard            →  app/dashboard/page.tsx (→ / 리다이렉트)
/orders               →  app/orders/page.tsx
/orders/new           →  app/orders/new/page.tsx
/orders/waiting       →  app/orders/waiting/page.tsx
/orders/shipping      →  app/orders/shipping/page.tsx
/orders/claims        →  app/orders/claims/page.tsx
/inquiries            →  app/inquiries/page.tsx
/me/profile           →  app/me/profile/page.tsx
/me/markets           →  app/me/markets/page.tsx
/me/plan              →  app/me/plan/page.tsx
/me/notifications     →  app/me/notifications/page.tsx
/me/ledger            →  app/me/ledger/page.tsx
```

---

## 네비게이션 구조

### 메인 사이드바 (`app-sidebar.tsx`)

```
대시보드
주문관리
  ├ 전체
  ├ 신규주문
  ├ 발송대기
  ├ 배송중
  └ 반품/교환/취소
문의관리
내정보 (기본: 플랜 관리)
  ※ 개별 설정은 '내정보' 레이아웃 내 상단 탭으로 전환
```

### 내 정보 탭 네비게이션 (`app/me/layout.tsx`)

내 정보 섹션은 이중 사이드바 문제를 피하기 위해 **상단 탭 네비게이션**을 사용합니다.

```tsx
<Tabs value={activeTab}>
  <TabsList>
    <TabsTrigger value="profile">프로필</TabsTrigger>
    <TabsTrigger value="markets">마켓 연동</TabsTrigger>
    <TabsTrigger value="plan">플랜 관리</TabsTrigger>
    <TabsTrigger value="notifications">알림 설정</TabsTrigger>
    <TabsTrigger value="ledger">장부 관리</TabsTrigger>
  </TabsList>
</Tabs>
```

### 헤더 네비게이션 (Breadcrumb)

헤더 영역에는 현재 페이지의 위계를 보여주는 브레드크럼이 표시됩니다. `DynamicBreadcrumb` 컴포넌트가 URL 경로를 기반으로 자동 생성합니다.

- 예: **주문팡팡** > **전체 주문**

---

## 레이아웃 계층

```
app/layout.tsx (루트)
├── SidebarProvider
├── AppSidebar (전역 사이드바)
└── {children}
    ├── app/dashboard/page.tsx
    ├── app/orders/*/page.tsx
    ├── app/inquiries/page.tsx
    └── app/me/layout.tsx (내 정보 레이아웃)
        └── 탭 네비게이션 + {children}
```

---

## 페이지별 설명

| 페이지 | 설명 | 주요 컴포넌트 |
|--------|------|---------------|
| `/` | 매출/주문 현황 대시보드 | KeyMetrics, SalesCalendar, PendingTasks |
| `/orders` | 전체 주문 목록 | OrderTable, OrderSearch |
| `/orders/new` | 신규 주문 (마진 검토) | OrderTable, MarginReviewModal |
| `/orders/waiting` | 발송 대기 (송장 입력) | OrderTable, ExpandableRowContent |
| `/orders/shipping` | 배송중 주문 | OrderTable, TrackingModal |
| `/orders/claims` | 클레임 관리 | OrderTable |
| `/inquiries` | 문의 통합 관리 | InquiryListItem, ReplyModal |
| `/me/*` | 사용자 설정 | 각 설정 페이지 |
