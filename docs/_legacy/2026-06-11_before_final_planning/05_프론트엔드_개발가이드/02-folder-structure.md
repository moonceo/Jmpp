---
버전: v1.0
최종수정일: 2026-02-20
작성자/승인자: 기획팀 / 미상
상태: [Review]
---

# 폴더 및 파일 구조

## 전체 구조

```
jumunpangpang/
├── app/                    # Next.js App Router 페이지
│   ├── layout.tsx          # 루트 레이아웃
│   ├── page.tsx            # 홈 페이지 (→ /dashboard 리다이렉트)
│   ├── dashboard/          # 대시보드
│   ├── orders/             # 주문 관리
│   │   ├── page.tsx        # 전체 주문
│   │   ├── new/            # 신규 주문
│   │   ├── waiting/        # 발송 대기
│   │   ├── shipping/       # 배송중
│   │   └── claims/         # 클레임 관리
│   ├── inquiries/          # 문의 관리
│   └── me/                 # 내 정보
│       ├── layout.tsx      # 내 정보 레이아웃 (탭 네비게이션)
│       ├── profile/        # 프로필
│       ├── markets/        # 마켓 연동
│       ├── plan/           # 플랜 결제
│       ├── notifications/  # 알림 설정
│       └── ledger/         # 장부 관리
│
├── components/             # 재사용 컴포넌트
│   ├── ui/                 # Shadcn UI 기본 컴포넌트
│   ├── shared/             # 공통 컴포넌트
│   ├── orders/             # 주문 관련 컴포넌트
│   │   ├── modals/         # 주문 모달 (취소, 마진검토 등)
│   │   └── shared/         # 주문 테이블, 필터 등
│   ├── inquiries/          # 문의 관련 컴포넌트
│   ├── app-sidebar.tsx     # 메인 사이드바
│   └── providers.tsx       # 전역 프로바이더
│
├── hooks/                  # 커스텀 훅
│   ├── use-dashboard-data.ts
│   ├── use-orders.ts
│   └── use-mobile.ts
│
├── lib/                    # 유틸리티 및 설정
│   ├── utils.ts            # 공통 유틸리티 함수
│   ├── mock-data/          # Mock 데이터
│   │   ├── dashboard.ts
│   │   ├── orders.ts
│   │   └── inquiries.ts
│   └── stores/             # Zustand 스토어
│
├── types/                  # TypeScript 타입 정의
│   ├── order.ts
│   └── inquiry.ts
│
├── docs/                   # 개발 문서 (현재 폴더)
│
└── .agent/                 # AI 에이전트 설정
    ├── skills/             # 스킬 정의
    └── workflows/          # 워크플로우 정의
```

---

## 주요 폴더 설명

### `/app` - 페이지 라우팅

Next.js App Router 기반의 파일 시스템 라우팅을 사용합니다.

- `page.tsx`: 해당 경로의 메인 페이지
- `layout.tsx`: 해당 경로 및 하위 경로에 적용되는 레이아웃
- `loading.tsx`: 로딩 UI (선택)
- `error.tsx`: 에러 UI (선택)

### `/components` - 컴포넌트

| 폴더 | 설명 |
|------|------|
| `ui/` | Shadcn UI 기본 컴포넌트 (Button, Card, Dialog 등) |
| `shared/` | 여러 페이지에서 공유하는 컴포넌트 |
| `orders/` | 주문 관리 전용 컴포넌트 |
| `inquiries/` | 문의 관리 전용 컴포넌트 |

### `/hooks` - 커스텀 훅

React Query 기반의 데이터 페칭 훅과 유틸리티 훅을 포함합니다.

### `/lib` - 유틸리티

- `utils.ts`: `cn()` 함수 등 공통 유틸리티
- `mock-data/`: 개발용 Mock 데이터
- `stores/`: Zustand 상태 관리 스토어

### `/types` - 타입 정의

TypeScript 인터페이스 및 타입 정의 파일입니다. 백엔드 API 스키마와 동기화해야 합니다.

---

## 파일 명명 규칙

| 유형 | 규칙 | 예시 |
|------|------|------|
| 페이지 | `page.tsx` | `app/orders/page.tsx` |
| 레이아웃 | `layout.tsx` | `app/me/layout.tsx` |
| 컴포넌트 | kebab-case | `order-table.tsx` |
| 훅 | `use-` prefix | `use-orders.ts` |
| 타입 | 단수형 | `order.ts` |
| 유틸리티 | 기능명 | `utils.ts` |
