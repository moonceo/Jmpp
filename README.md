# Jumunpangpang OMS

주문팡팡은 국내 오픈마켓 주문과 타오바오·소싱라이프 상품/옵션을 한 업무 흐름으로 연결하는 것을 목표로 하는 멀티테넌트 OMS입니다.

## 현재 구현 상태 (2026-07-13)

- 스마트스토어: 계정·자격증명 원장, 자동 예약 기반 변경 주문/상세/클레임 수집 워커, 주문확인·송장·직접전달·판매자 취소 명령 코어가 구현되어 있습니다. 판매자 취소 화면은 공식 7개 사유와 부분수량을 검증하고 접수 성공 주문을 `ON_HOLD / CANCEL_REQUESTED`로 보존합니다. 실제 판매자 계정 UAT 전에는 모든 쓰기 capability가 차단되며, 인과 기준선이 없는 판매자 취소 `UNKNOWN`은 자동 재호출하지 않고 수동 대사로 남깁니다.
- 클레임: 취소·반품·교환 case/line/event 원장, 네이버 `currentClaim`·`completedClaims` 수집, 검색·기한·상세 이력 UI가 구현되어 있습니다. 마켓 승인·거절·회수·재배송은 아직 조회 전용입니다.
- 타오바오 매칭: 정확 SKU·옵션·가격·재고 스냅샷과 구매 전 비용 검증, 수동 매핑 UI가 있습니다. 수동 입력은 검증대기이며 실제 소싱라이프 구매신청·결제는 차단되어 있습니다.
- 쿠팡: 서명·읽기 전용 발주서 코어만 비활성 상태로 존재합니다. 11번가·G마켓·옥션 런타임 어댑터는 아직 없습니다.
- PostgreSQL migration, RLS, 브라우저 로그인·세션, CSRF, 감사로그, 재시도·UNKNOWN 대사 코어는 코드와 단위/계약 테스트 수준입니다. PGlite 런타임 검증과 별개로 native PostgreSQL 16·판매자센터·배포환경 UAT가 필요합니다.

출시 완료 기준과 미구현 범위는 [`docs/00_문서맵/02_실서비스_완성목표_및_로드맵.md`](./docs/00_문서맵/02_실서비스_완성목표_및_로드맵.md)를 기준으로 판단합니다.

## 목표 기능

- 대시보드: 매출 차트, 캐시백, 통합 알림
- 주문관리: 스마트스토어·쿠팡·11번가·G마켓·옥션 주문 수집, 상태 관리, 배송 추적
- 소싱: 마켓 상품/옵션과 타오바오·소싱라이프 SKU 매칭 및 구매 연결
- 출고: 국내송장 저장, 마켓 송장 제출, 마켓별 직접전달
- 클레임: 취소·반품·교환의 공통 작업함과 마켓별 처리
- 문의관리: CS 통합 관리 (마켓별 제약 사항 포함)
- 내정보: 멤버십 결제, 마켓 API 연동, 알림톡 설정

## 기술 스택

| 영역 | 기술 |
|------|------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database | PostgreSQL 16 |
| UI | Shadcn UI, Tailwind CSS 4 |
| State | React Query (Server), Zustand (Client) |
| Chart | Recharts |
| Icons | Lucide React |

## 시작하기

### 1. 저장소 클론

```bash
git clone [레포지토리 주소]
cd jumunpangpang
```

### 2. PostgreSQL 실행

로컬 Docker를 사용한다면 다음 명령으로 개발 DB를 실행할 수 있습니다.

```bash
docker compose up -d postgres
```

### 3. 환경변수 설정

```bash
cp .env.example .env.local
```

`.env.local` 파일을 열어 필요한 값을 설정하세요.

다음 명령을 각각 실행해 `DATA_ENCRYPTION_KEY`, `INTERNAL_AUTH_SHARED_SECRET`, `SESSION_SIGNING_SECRET`, `CURSOR_SIGNING_SECRET`에 서로 다른 값을 넣으세요.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

마켓 API 비밀정보와 서버 서명키는 환경마다 분리하고 저장소에 커밋하지 마세요. 로컬 구성도 migration owner, RLS 적용 app role, global queue용 worker role을 서로 다른 DB URL로 사용합니다. 운영에서는 `.env.example`의 로컬 비밀번호를 절대 재사용하지 않습니다.

### 4. 패키지 설치

```bash
npm install
```

### 5. DB 마이그레이션

```bash
npm run db:migrate
npm run db:seed:dev
```

운영 또는 스테이징의 첫 OWNER는 `.env.local`에 `BOOTSTRAP_TENANT_*`, `BOOTSTRAP_OWNER_*` 값을 임시로 설정한 뒤 다음 명령으로 생성합니다. 실행 직후 `BOOTSTRAP_OWNER_PASSWORD`를 환경에서 제거하세요.

```bash
npm run db:bootstrap-owner -- --confirm
```

브라우저 로그인은 `/login`에서 워크스페이스 slug, 이메일, 비밀번호를 사용합니다. 세션은 HttpOnly·SameSite=Strict 쿠키와 별도 CSRF 토큰으로 보호되고 DB에서 폐기할 수 있습니다. 외부 인증 프록시를 사용하는 배포는 기존 단기 HMAC `x-internal-auth-context`도 계속 사용할 수 있습니다.

### 6. 개발 서버와 워커 실행

```bash
npm run dev
```

다른 터미널에서 현재 활성화된 스마트스토어 자동 수집 예약·수집·쓰기 명령 워커를 실행합니다.

```bash
npm run worker
```

워커는 전용 `WORKER_DATABASE_URL`이 없거나 해당 DB 역할이 non-superuser `BYPASSRLS`가 아니면 즉시 종료합니다. 마켓 쓰기는 계정별 실계정 UAT capability가 승인된 작업만 실행합니다.

[http://localhost:3000](http://localhost:3000)에서 확인하세요.

## 스크립트

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 |
| `npm run start` | 빌드 후 서버 실행 |
| `npm run lint` | ESLint 코드 검사 |
| `npm run test` | Vitest 전체 테스트 |
| `npm run test -- path/to/file.test.ts` | 단일 테스트 파일 실행 |
| `npm run db:migrate` | PostgreSQL 마이그레이션 적용 |
| `npm run db:seed:dev` | 로컬 개발용 테넌트·OWNER 생성 |
| `npm run db:bootstrap-owner -- --confirm` | 운영/스테이징 최초 OWNER 생성 또는 비밀번호 회전 |
| `npm run worker` | 수집·외부쓰기 워커 실행 |

## 문서

자세한 개발 문서는 [docs/](./docs/) 폴더를 참조하세요.

## 라이선스

Private
