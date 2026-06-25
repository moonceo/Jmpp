---
버전: v1.3
최종수정일: 2026-06-18
작성자/승인자: 기획팀
상태: [Draft - 현재 프론트 구현 기준]
---

# 공통 주문 모델, 마켓 API, 소싱라이프 연동 기준

## 1. 문서 목적

이 문서는 현재 프론트 MVP에 구현된 주문관리 데이터 구조와 추후 API 연동 기준을 분리해 정의한다.
현재 구현은 백엔드 없이 mock data, React state, localStorage를 사용한다.
따라서 이 문서의 1차 기준은 `types/order.ts`, `lib/constants/orders.ts`, `lib/mock-data/`, `app/orders/page.tsx`, `components/orders/`의 현재 구현이다.

## 2. 현재 MVP 데이터 흐름

| 영역 | 현재 구현 |
|---|---|
| 주문 원천 | 마켓에서 수집된 주문을 가정한 `lib/mock-data/orders.ts`의 mock 주문 |
| 주문 상태 변경 | `components/orders/orders-page-client.tsx`의 클라이언트 상태 업데이트 |
| 소싱 매칭 저장 | `jumunpangpang.sourcingMatches` localStorage |
| 소싱 결제 가정 저장 | `jumunpangpang.sourcingPayments` localStorage |
| 송장 저장/배송중 처리 | `jumunpangpang.syncedInvoices` localStorage |
| 데이터 초기화 | 주문 화면 진입 시 mock 재구성, 좌측 `데이터 초기화` 버튼 |
| 서버 API | 현재 주문 MVP에서는 미구현 |
| React Query | 의존성은 있으나 주문 MVP 핵심 흐름에는 사용하지 않음 |
| Zustand | 현재 대시보드 store 중심 |

주문관리는 소싱라이프 내부 기능이지만 주문수집의 원천은 마켓 주문이다.
소싱라이프에서 직접 생성하거나 주문한 내역은 주문관리의 주문수집 목록에 포함하지 않는다.
소싱라이프의 구매, 검수, 입고, 물류 상세 처리는 소싱라이프 기존 기능에서 진행하며 주문관리 데이터 모델로 흡수하지 않는다.

## 3. 마켓 범위

| 마켓 코드 | 화면 라벨 | 현재 MVP 기준 |
|---|---|---|
| `naver` | 스마트스토어 | mock 계정/주문, 추후 API 연동 대상 |
| `coupang` | 쿠팡 | mock 계정/주문, 추후 API 연동 대상 |
| `11st` | 11번가 | mock 계정/주문, 추후 API 연동 대상 |
| `gmarket` | G마켓 | mock 계정/주문, 추후 API 연동 대상 |
| `auction` | 옥션 | mock 계정/주문, 추후 API 연동 대상 |

마켓/스토어 필터는 주문 조회 조건이다.
주문수집 버튼은 현재 화면에서 특정 마켓 또는 특정 스토어만 수집하는 범위 제한 기능으로 동작하지 않는다.

## 4. 마켓 계정 모델

마켓연동 화면은 `/me/markets`이며 현재 목록 컬럼은 `마켓`, `스토어명`, `연동상태`, `활성`, `관리`다.

현재 화면에서 사용하는 주요 계정 정보:

| 필드 | 설명 |
|---|---|
| `id` | 내부 계정 ID |
| `market` | 스마트스토어, 쿠팡, 11번가, G마켓, 옥션 |
| `storeName` | 사용자가 구분하기 위해 입력하는 스토어명 |
| `authStatus` | 연동상태 |
| `isActive` | 활성 여부 |
| `credentials` | 마켓별 인증 정보 |

마켓별 인증 정보:

| 마켓 | 인증 정보 |
|---|---|
| 스마트스토어 | 연동용 판매자 ID, 클라이언트 아이디, 클라이언트 시크릿 |
| 쿠팡 | 쿠팡 업체코드(Vendor ID), Access Key, Secret Key, 쿠팡 윙 로그인 ID |
| 11번가 | API Key |
| G마켓 | Master ID, Seller ID |
| 옥션 | Master ID, Seller ID |

현재 MVP 화면에서 플랫폼 수수료율, 마지막 수집, 결과, 결제카드, 마켓 로그인 ID/비밀번호, CS 전화번호는 제공하지 않는다.

## 5. 주문 상태 모델

현재 타입 기준 주문 상태는 다음과 같다.

| 코드 | 라벨 | 정의 |
|---|---|---|
| `NEW` | 신규주문 | 마켓 결제완료 주문 수집 후 주문확인 전 |
| `PREPARING` | 상품준비 | 주문확인 후 소싱라이프 소싱/결제 또는 직접 구매 진행 |
| `READY_TO_SHIP` | 발송대기 | 국내송장 입력, 확인, 배송중 처리 대기 |
| `SHIPPING` | 배송중 | 배송중 처리 완료 |
| `DELIVERED` | 배송완료 | 배송완료 또는 구매확정 |
| `CANCELED` | 판매자취소 | 판매자 직접 주문취소 처리 |
| `CLAIM` | 취소/반품/교환 | 구매자 요청 또는 마켓 클레임 수집 |

현재 화면 흐름:

```text
NEW
→ 주문확인 또는 매칭하기
→ PREPARING
→ 소싱하기 또는 직접 구매 처리
→ READY_TO_SHIP
→ 국내송장 입력/수집
→ 배송중 처리
→ SHIPPING
→ DELIVERED
```

구매자 요청 취소/반품/교환은 `CLAIM`으로 분리한다.
판매자 직접 취소는 `CANCELED`로 마감한다.
`ORDER_STATUSES.ALL`과 `OrdersView`의 `all` 값은 구현 내부에 남아 있지만, 현재 라우트와 탭 UI에서는 별도 `전체` 주문수집 화면으로 노출하지 않는다.

## 6. 소싱라이프 상태 모델

현재 타입 기준 소싱라이프 동기화 상태는 다음과 같다.

| 코드 | 의미 |
|---|---|
| `NOT_LINKED` | 소싱라이프 연결 전 |
| `MATCHING` | 매칭 진행 중 |
| `MATCH_SAVED` | 매칭 저장 완료 |
| `PAYMENT_READY` | 결제 가능 |
| `PAID` | 소싱라이프 결제 완료 |
| `INVOICE_RECEIVED` | 국내송장 수신 |
| `HOLD` | 처리 보류 |

주문 목록의 `소싱` 컬럼은 전체 상태를 모두 노출하지 않는다.
현재 표시는 `-`, `매칭완료`, 주문내역 아이콘 링크 중 하나다.

## 7. 공통 주문 모델

현재 mock/type 기준 주요 주문 필드는 다음과 같다.

| 구분 | 필드 예시 | 현재 활용 |
|---|---|---|
| 식별 | `id`, `marketOrderId`, `product.id`, `product.productOrderId` | 검색, 상품정보 표시, 상세 표시 |
| 마켓 | `marketType`, `storeName` | 판매처 컬럼, 필터 |
| 상태 | `status`, `sourcingLifeSyncStatus` | 탭, 액션 제어, 소싱 컬럼 |
| 일시 | `orderDate`, `marketPaidAt` | 주문일시, 기간 필터 |
| 상품 | `product.name`, `product.optionName`, `product.quantity`, `product.thumbnail`, `product.marketLink` | 상품정보, 상세 주문상품 |
| 금액 | `product.unitPrice`, `paymentPrice`, `expectedCost`, `sourcingLifeActualPayment.amount` | 상세/계산 원천 데이터 |
| 구매자 | `buyerName`, `buyerPhone`, `buyerId` | 검색, 상세 구매자 |
| 배송 | `recipient.name`, `recipient.phone`, `recipient.address`, `recipient.personalCustomsCode` | 배송정보 컬럼/상세/수정 |
| 택배 | `domesticInvoice.carrier`, `domesticInvoice.trackingNumber` | 택배정보 컬럼 |
| 소싱 | `sourcingLifeOrderId`, `sourcingLifeMatch.productName`, `sourcingLifeMatch.optionName`, `sourcingLifeActualPayment.amount` | 소싱 컬럼/상세 |
| 클레임 | `claimType`, `claimStatus`, `claimReason`, `previousStatus` | 취소/반품/교환 화면 |

목록에서 숨긴 필드도 원천 데이터와 검색/상세/추후 API 매핑에는 유지한다.

## 8. 주문 액션 기준

| 액션 | 대상 | 현재 결과 |
|---|---|---|
| `주문확인` | `NEW` | `PREPARING`으로 이동 |
| `매칭하기` | `NEW` | 소싱 매칭 저장 + 주문확인 처리 후 `PREPARING` 이동 |
| `소싱하기` | `PREPARING` | 후보/옵션/수량 선택 후 모달 내 구매대행 신청/결제 화면 |
| `직접 구매 처리` | `PREPARING` | 발송대기 처리 또는 배송중 처리 |
| `배송중 처리` | `READY_TO_SHIP` 중 송장 있음 | `SHIPPING`으로 이동 |
| `주문취소` | 일반 주문 | 확인 모달 후 `CANCELED` 처리 |
| `취소처리` | 취소 클레임 | 취소승인 또는 취소거부 처리 후 클레임 처리값 저장 |
| `반품처리` | 반품 클레임 | 사유와 진행단계 조회 중심 화면 |
| `교환처리` | 교환 클레임 | 사유와 진행단계 조회 중심 화면 |

배송중 상태에서 송장 수정 API 전송 버튼은 현재 제공하지 않는다.
변경된 송장번호 항목은 목록과 상세에 표시하지 않는다.

취소 클레임 승인/거부는 현재 프론트 MVP에서 `claimStatus`, `claimProcessedAt`, `failureReason`, `sourcingLifeSyncStatus: HOLD`를 갱신하는 mock 처리로 구현되어 있다.
반품/교환 클레임은 현재 MVP에서 승인, 회수, 재발송 API를 호출하지 않고 조회 중심 화면으로 제공한다.

## 9. 소싱라이프 연동 기준

신규주문:

- `매칭하기`는 match-only 모드다.
- 후보/옵션 선택 후 매칭 정보를 저장한다.
- 저장과 동시에 주문확인을 처리해 상품준비로 이동한다.

상품준비:

- `소싱하기`는 payment 모드다.
- 추천 소싱 상품, 옵션, 수량을 선택한다.
- 후보는 한국어 상품명, 중국어 상품명, 판매처, 원화/위안 상품원가를 표시한다.
- 옵션은 한국어 옵션명 아래 중국어 옵션명을 표시한다.
- 품절 옵션은 결제 버튼을 비활성화한다.
- `소싱라이프 결제 하기`를 누르면 모달 안에서 구매대행 신청 화면으로 이동한다.
- 다음 단계에서 약관 동의와 결제 정보 입력 화면을 표시한다.

추후 실제 API 연동 시에는 소싱라이프 주문번호, 결제 상태, 국내송장 수신 여부를 주문에 반영한다.

## 10. 국내송장/배송 처리 기준

발송대기 화면:

- 송장 필터는 드롭다운으로 `전체`, `송장 있음`, `송장 없음`을 제공한다.
- 별도 `소싱라이프 송장 수집` 버튼은 제공하지 않는다.
- `자동 배송중 처리`는 송장이 입력되었을 때 배송중 처리를 자동 시도하는 토글이다.
- `배송중 처리`는 송장번호가 있는 주문만 대상으로 한다.
- 체크된 주문이 있으면 전역 액션은 체크된 주문을 우선 대상으로 하고, 없으면 현재 필터로 보이는 발송대기 주문을 대상으로 한다.
- 조건에 맞지 않는 주문은 체크되어 있어도 배송중 처리 대상에서 제외한다.

국내송장 입력:

- 발송대기 행에서 택배사와 송장번호를 입력할 수 있다.
- 송장번호 입력값은 자동 저장된다.
- 송장번호가 없으면 행의 `배송중 처리` 버튼은 비활성화한다.
- 송장번호가 있으면 `배송중 처리` 버튼을 활성화한다.

배송중 화면:

- 택배사와 송장번호를 조회 전용으로 표시한다.
- 송장 수정 전송 버튼은 제공하지 않는다.

## 11. 마켓 API 매핑 기준

현재는 실제 API 호출 없이 mock으로 동작한다.
추후 API 연동 시 마켓별 응답은 내부 상태로 변환한다.

| 마켓 이벤트 | 내부 처리 |
|---|---|
| 결제완료 주문 수집 | 신규 주문이면 `NEW` 생성 |
| 주문확인 성공 | `PREPARING`으로 변경 |
| 소싱라이프 결제 완료 반영 | `READY_TO_SHIP`으로 변경 |
| 국내송장 배송중 처리 성공 | `SHIPPING`으로 변경 |
| 배송완료 또는 구매확정 수집 | `DELIVERED`로 변경 |
| 구매자 취소/반품/교환 요청 수집 | `CLAIM`으로 변경 |
| 판매자 직접 주문취소 성공 | `CANCELED`로 변경 |

## 12. MVP 범위 제외

다음 항목은 현재 구현과 문서에서 제외한다.

- 타오바오 직접 결제
- 내부 배대지/창고 관리
- 배송중 송장 수정 API 전송
- 플랫폼 수수료율 설정 화면
- 마지막 수집/결과 컬럼
- 별도 계정설정 페이지

