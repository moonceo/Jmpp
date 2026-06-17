---
버전: v1.0
최종수정일: 2026-02-20
작성자/승인자: 기획팀 / 미상
상태: [Review]
---

# 컴포넌트 설계 및 사용법

## 컴포넌트 분류

### 1. UI 컴포넌트 (`components/ui/`)

Shadcn UI 기반의 기본 컴포넌트입니다. 직접 수정하지 않고 사용합니다.

| 컴포넌트 | 용도 |
|----------|------|
| Button | 버튼 |
| Card | 카드 컨테이너 |
| Dialog | 모달 다이얼로그 |
| Tabs | 탭 네비게이션 |
| Table | 테이블 |
| Badge | 상태 뱃지 |
| Input | 입력 필드 |
| Select | 셀렉트박스 |
| Popover | 팝오버 |
| ScrollArea | 스크롤 영역 |
| Accordion | 아코디언 |

### 2. 공유 컴포넌트 (`components/shared/`)

여러 페이지에서 재사용되는 컴포넌트입니다.

| 컴포넌트 | 용도 | 사용 위치 |
|----------|------|----------|
| DashboardHeader | 페이지 헤더 | 모든 페이지 |
| KeyMetrics | 핵심 지표 카드 | 대시보드 |
| SalesCalendar | 매출 캘린더 | 대시보드 |
| PendingTasks | 업무 현황 | 대시보드 |
| NotificationPopover | 알림 팝오버 | 헤더 |
| AnnouncementsWidget | 공지사항 | 대시보드 |

### 3. 도메인 컴포넌트

#### 주문 관련 (`components/orders/`)

| 컴포넌트 | 용도 |
|----------|------|
| `shared/order-table.tsx` | 주문 테이블 (TanStack Table) |
| `shared/columns.tsx` | 테이블 컬럼 정의 |
| `shared/order-search.tsx` | 주문 검색 |
| `shared/status-filter.tsx` | 상태 필터 |
| `shared/expandable-row-content.tsx` | 확장 행 (상세 정보) |
| `modals/order-cancel-modal.tsx` | 주문 취소 모달 |
| `modals/margin-review-modal.tsx` | 마진 검토 모달 |
| `modals/tracking-modal.tsx` | 배송 추적 모달 |
| `modals/warehouse-modal.tsx` | 배대지 관리 모달 |
| `modals/sourcing-management-modal.tsx` | 소싱 관리 모달 |
| `modals/order-history-modal.tsx` | 주문 히스토리 모달 |

#### 문의 관련 (`components/inquiries/`)

| 컴포넌트 | 용도 |
|----------|------|
| `inquiry-list-item.tsx` | 문의 목록 아이템 |
| `reply-modal.tsx` | 답변 모달 (2단계 확인) |

---

## 컴포넌트 사용 예시

### 모달 컴포넌트 패턴

```tsx
// 상태 관리
const [modalOpen, setModalOpen] = useState(false);
const [selectedItem, setSelectedItem] = useState<Order | null>(null);

// 열기
const handleOpenModal = (order: Order) => {
  setSelectedItem(order);
  setModalOpen(true);
};

// 렌더링
<SomeModal
  open={modalOpen}
  onOpenChange={setModalOpen}
  order={selectedItem}
/>
```

### 테이블 컴포넌트 사용

```tsx
import { OrderTable } from "@/components/orders/shared/order-table";
import { columns } from "@/components/orders/shared/columns";

// 페이지에서 사용
<OrderTable
  data={orders}
  columns={columns}
  onRowClick={handleRowClick}
  onExpandedChange={handleExpandedChange}
/>
```

---

## 컴포넌트 작성 규칙

### 1. Props 인터페이스

```tsx
interface ComponentNameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data?: SomeType;
}

export function ComponentName({ open, onOpenChange, data }: ComponentNameProps) {
  // ...
}
```

### 2. 모달 Props 표준

모든 모달은 다음 props를 사용합니다:

```tsx
interface ModalProps {
  open: boolean;                      // 모달 열림 상태
  onOpenChange: (open: boolean) => void;  // 상태 변경 핸들러
  // + 도메인별 추가 props
}
```

### 3. 스타일링

- Tailwind CSS 유틸리티 클래스 사용
- `cn()` 함수로 조건부 클래스 병합
- 색상은 디자인 시스템 토큰 사용 (`text-muted-foreground` 등)
