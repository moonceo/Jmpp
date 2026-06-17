---
버전: v1.0
최종수정일: 2026-02-20
작성자/승인자: 기획팀 / 미상
상태: [Review]
---

# 스타일링 및 디자인 시스템

## 개요

프로젝트는 **Tailwind CSS**와 **Shadcn UI**를 기반으로 일관된 디자인 시스템을 구축합니다.

---

## 색상 시스템

### CSS 변수 (`globals.css`)

```css
:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 10% 3.9%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --secondary: 240 4.8% 95.9%;
  --secondary-foreground: 240 5.9% 10%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --ring: 240 5.9% 10%;
  --sidebar-background: 0 0% 98%;
  --sidebar-foreground: 240 5.3% 26.1%;
}

.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  /* ... dark mode colors */
}
```

### 사용법

```tsx
// Tailwind 클래스로 사용
<div className="bg-background text-foreground" />
<div className="bg-muted text-muted-foreground" />
<div className="bg-primary text-primary-foreground" />
<div className="text-destructive" />
```

---

## 타이포그래피

### 텍스트 크기

| 클래스 | 크기 | 용도 |
|--------|------|------|
| `text-xs` | 12px | 보조 텍스트, 레이블 |
| `text-sm` | 14px | 본문, 테이블 |
| `text-base` | 16px | 기본 본문 |
| `text-lg` | 18px | 소제목 |
| `text-xl` | 20px | 제목 |
| `text-2xl` | 24px | 페이지 타이틀 |

### 폰트 두께

| 클래스 | 두께 | 용도 |
|--------|------|------|
| `font-normal` | 400 | 본문 |
| `font-medium` | 500 | 강조 텍스트 |
| `font-semibold` | 600 | 소제목 |
| `font-bold` | 700 | 제목 |

---

## 간격 시스템

### 기본 간격 (4px 단위)

| 클래스 | 크기 | 예시 |
|--------|------|------|
| `p-1` / `m-1` | 4px | 아이콘 주변 |
| `p-2` / `m-2` | 8px | 작은 버튼 |
| `p-3` / `m-3` | 12px | 카드 내부 |
| `p-4` / `m-4` | 16px | 기본 패딩 |
| `p-6` / `m-6` | 24px | 섹션 패딩 |
| `p-8` / `m-8` | 32px | 페이지 패딩 |

### 갭 (Flexbox/Grid)

```tsx
<div className="flex gap-2" />  // 8px 간격
<div className="flex gap-4" />  // 16px 간격
<div className="grid gap-6" />  // 24px 간격
```

---

## 컴포넌트 스타일 패턴

### 카드

```tsx
<Card>
  <CardHeader>
    <CardTitle>제목</CardTitle>
    <CardDescription>설명</CardDescription>
  </CardHeader>
  <CardContent>
    내용
  </CardContent>
</Card>
```

### 버튼 변형

```tsx
<Button variant="default">기본</Button>
<Button variant="secondary">보조</Button>
<Button variant="outline">외곽선</Button>
<Button variant="ghost">고스트</Button>
<Button variant="destructive">삭제</Button>
<Button variant="link">링크</Button>
```

### 뱃지 변형

```tsx
<Badge variant="default">기본</Badge>
<Badge variant="secondary">보조</Badge>
<Badge variant="outline">외곽선</Badge>
<Badge variant="destructive">경고</Badge>
```

### 상태별 색상 패턴

```tsx
// 주문 상태별 색상
const getStatusColor = (status: string) => {
  if (status === "신규 주문") return "bg-blue-100 text-blue-800";
  if (status.includes("취소")) return "bg-red-100 text-red-800";
  if (status === "배송완료") return "bg-green-100 text-green-800";
  return "bg-gray-100 text-gray-800";
};
```

---

## 레이아웃 패턴

### 페이지 레이아웃

```tsx
<div className="flex flex-col gap-6 p-6">
  <DashboardHeader title="페이지 제목" />
  <div className="grid gap-6">
    {/* 콘텐츠 */}
  </div>
</div>
```

### 그리드 레이아웃

```tsx
// 반응형 카드 그리드
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  <Card />
  <Card />
  <Card />
  <Card />
</div>
```

### 2컬럼 레이아웃

```tsx
<div className="grid grid-cols-1 md:grid-cols-12 gap-6">
  <div className="md:col-span-8">{/* 메인 콘텐츠 */}</div>
  <div className="md:col-span-4">{/* 사이드 */}</div>
</div>
```

---

## 유틸리티 함수

### cn() 함수

조건부 클래스 병합에 사용합니다.

```tsx
import { cn } from "@/lib/utils";

<div className={cn(
  "base-class",
  isActive && "active-class",
  variant === "primary" ? "primary-class" : "secondary-class"
)} />
```

---

## 다크 모드

Tailwind의 `dark:` 접두사를 사용합니다.

```tsx
<div className="bg-white dark:bg-zinc-900" />
<div className="text-gray-900 dark:text-gray-100" />
<div className="border-gray-200 dark:border-gray-800" />
```

---

## 주의사항

1. **디자인 토큰 사용**: 하드코딩된 색상 대신 CSS 변수 사용
2. **반응형 디자인**: `sm:`, `md:`, `lg:` 접두사로 브레이크포인트 처리
3. **다크 모드 지원**: 새 컴포넌트 작성 시 `dark:` 변형 추가
4. **일관성 유지**: Shadcn UI 컴포넌트 스타일 패턴 따르기
