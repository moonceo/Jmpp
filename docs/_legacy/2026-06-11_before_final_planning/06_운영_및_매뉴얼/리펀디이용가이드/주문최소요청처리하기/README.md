---
버전: v1.0
최종수정일: 2026-02-20
작성자/승인자: 기획팀 / 미상
상태: [Review]
---

# Jumunpangpang OMS 프론트엔드 개발 문서

이 폴더에는 Jumunpangpang OMS(AI 주문처리 시스템) 프론트엔드 프로젝트의 개발 문서가 포함되어 있습니다.

## 문서 구성

| 파일 | 설명 |
|------|------|
| [01-project-overview.md](./01-project-overview.md) | 프로젝트 개요 및 기술 스택 |
| [02-folder-structure.md](./02-folder-structure.md) | 폴더 및 파일 구조 설명 |
| [03-page-routing.md](./03-page-routing.md) | 페이지 라우팅 및 네비게이션 |
| [04-components.md](./04-components.md) | 컴포넌트 설계 및 사용법 |
| [05-data-fetching.md](./05-data-fetching.md) | 데이터 페칭 및 상태 관리 |
| [06-api-integration.md](./06-api-integration.md) | 백엔드 API 연동 가이드 |
| [07-type-definitions.md](./07-type-definitions.md) | TypeScript 타입 정의 |
| [08-styling-guide.md](./08-styling-guide.md) | 스타일링 및 디자인 시스템 |

## 빠른 시작

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 프로덕션 빌드
npm run build
```

## 기술 스택 요약

- **프레임워크**: Next.js 16 (App Router)
- **언어**: TypeScript
- **UI 라이브러리**: Shadcn UI + Tailwind CSS
- **상태 관리**: React Query (TanStack Query)
- **아이콘**: Lucide React
