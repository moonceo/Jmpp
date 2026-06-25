---
버전: v1.0
최종수정일: 2026-06-19
작성자/승인자: 기획팀
상태: [Draft - 공식 문서 기반 연동 기준]
---

# 네이버 커머스API 연동 기준

## 1. 문서 목적

이 문서는 소싱라이프 내부 주문관리 MVP에서 스마트스토어 주문을 실제 네이버 커머스API와 연동할 때 필요한 기준을 정리한다.
현재 프론트 MVP는 mock data와 localStorage 기반으로 동작하므로, 이 문서는 구현 코드가 아니라 추후 백엔드/API 연동 설계 기준이다.

기준 문서는 네이버 커머스API 공식 문서다.
확인 기준 버전은 2026-06-19 현재 문서에 노출된 최신 버전 `2.80.0 (2026-06-10)`이다.

## 2. 공식 문서 기준

| 구분 | 공식 문서 |
|---|---|
| 소개 | https://apicenter.commerce.naver.com/docs/introduction |
| 최신 API 문서 | https://apicenter.commerce.naver.com/docs/commerce-api/current |
| LLM용 API 인덱스 | https://apicenter.commerce.naver.com/llms/llms.txt |
| AI 활용 가이드 | https://apicenter.commerce.naver.com/docs/ai-use-guide |
| 로컬 링크 인덱스 | `docs/04_시스템_아키텍처_및_API/네이버커머스API_공식링크/00_공식문서_전체링크_인덱스.md` |

네이버 커머스API 문서는 `인증`, `주문`, `판매자정보`, `문의`, `정산`, `상품`, `N배송` 등의 API 그룹을 제공한다.
주문관리 MVP의 1차 연동 범위는 `인증`, `주문`, `판매자정보`다.

## 2.1 기능별 공식 문서 확인 위치

실제 구현 시에는 아래 문서를 먼저 확인한다.

| 주문관리 기능 | 먼저 확인할 공식 문서 |
|---|---|
| 인증/토큰 발급 | `intro-인증.md`, `POST /v1/oauth2/token - 인증 토큰 발급 요청` |
| API 오류/호출 규격 | `intro-RESTful API.md`, `intro-문제 해결.md`, `intro-제약사항.md` |
| 주문 상태 매핑 | `[주문]-주문-상태-변경-흐름도` |
| 주문수집 | `GET /v1/pay-order/seller/product-orders/last-changed-statuses - 변경 상품 주문 내역 조회` |
| 주문 상세 조회 | `POST /v1/pay-order/seller/product-orders/query - 상품 주문 상세 내역 조회` |
| 주문확인 | `POST /v1/pay-order/seller/product-orders/confirm - 발주 확인 처리` |
| 배송중 처리 | `POST /v1/pay-order/seller/product-orders/dispatch - 발송 처리` |
| 판매자 주문취소 요청 | `POST /v1/pay-order/seller/product-orders/{productOrderId}/claim/cancel/request - 취소 요청` |
| 고객 취소요청 승인 | `POST /v1/pay-order/seller/product-orders/{productOrderId}/claim/cancel/approve - 취소 요청 승인` |
| 택배사/물류사 기준 | `GET /v1/logistics/logistics-companies - 물류사 연동 정보 조회`, 발송 처리 문서의 `deliveryCompanyCode` |
| 계정 검증 | `GET /v1/seller/account - 계정 정보 조회` |
| 채널/스토어 식별 | `GET /v1/seller/channels - 계정으로 채널 정보 조회` |

## 3. 현재 MVP와 연동 범위

| 주문관리 화면/기능 | 네이버 API 연동 필요성 | MVP 연동 기준 |
|---|---|---|
| 마켓연동 | 필요 | 스마트스토어 계정의 인증 정보 저장 및 토큰 발급 준비 |
| 주문수집 | 필요 | 변경 상품 주문 내역 조회 후 상세 조회 |
| 주문확인 | 필요 | 발주 확인 처리 |
| 매칭하기/소싱하기 | 직접 연동 없음 | 소싱라이프 내부 주문관리 흐름 |
| 발송대기 | 필요 | 국내송장 확보 후 발송 처리 |
| 배송중 | 조회 중심 | 네이버 송장 수정 전송과 변경된 송장번호 표시는 MVP 제외 |
| 배송완료 | 조회 중심 | 변경 피드 또는 상세 조회 결과를 내부 `DELIVERED`로 반영 |
| 취소/반품/교환 | 조회 및 일부 처리 | 취소 요청/승인 API는 후보, 반품/교환 처리는 MVP에서 조회 중심 |

## 4. 인증 기준

네이버 커머스API는 OAuth 2.0 Client Credentials 방식의 Bearer Token 인증을 사용한다.
공식 LLM용 문서 기준으로 API Base URL은 다음과 같이 관리한다.

```text
https://api.commerce.naver.com/external
```

마켓연동 화면의 스마트스토어 인증 정보는 현재 MVP 기준으로 다음 3개 항목을 받는다.

| 화면 필드 | API 연동 용도 |
|---|---|
| 연동용 판매자 ID | 토큰 발급 또는 판매자 계정 식별에 사용하는 계정 기준 값 |
| 클라이언트 아이디 | 커머스API 애플리케이션 Client ID |
| 클라이언트 시크릿 | 커머스API 애플리케이션 Secret |

토큰 발급은 서버에서만 처리한다.
클라이언트 화면에는 클라이언트 시크릿, 액세스 토큰, 전자서명 생성값을 노출하지 않는다.

### 4.1 토큰 발급 구현 기준

| 항목 | 기준 |
|---|---|
| Token URL | `POST https://api.commerce.naver.com/external/v1/oauth2/token` |
| 인증 방식 | OAuth 2.0 Client Credentials |
| `grant_type` | `client_credentials` |
| `client_id` | 네이버 커머스API 애플리케이션 ID |
| `timestamp` | 밀리초 단위 Unix 시간, 전자서명 생성 시 사용 |
| `client_secret_sign` | `client_id_timestamp` 값을 `client_secret`으로 bcrypt 처리 후 base64 인코딩한 전자서명 |
| `type` | `SELF` 또는 `SELLER` |
| `account_id` | `type=SELLER`인 경우 필요한 판매자 ID 또는 판매자 UID |

구현 주의사항:
- `timestamp`는 짧은 유효 시간을 가지므로 서버 시간을 NTP로 동기화한다.
- 액세스 토큰은 만료 전까지 서버 메모리 또는 안전한 캐시에 보관한다.
- 401 또는 게이트웨이 인증 오류가 발생하면 토큰 재발급 후 1회 재시도한다.
- 403은 권한, 약관 동의, 판매자 위임 상태 문제로 보고 사용자에게 재연동 또는 권한 확인을 안내한다.
- 토큰 발급 실패 시 마켓연동 화면의 해당 계정은 `연동 실패` 또는 `확인 필요` 상태로 표시한다.

## 5. 주문수집 기준

주문수집은 변경분 조회를 우선한다.
전체 기간 조건으로 모든 주문을 매번 가져오기보다, 변경 상품 주문 내역을 기준으로 누락 없이 동기화하는 구조가 적합하다.

| 목적 | API |
|---|---|
| 변경된 상품 주문 조회 | `GET /v1/pay-order/seller/product-orders/last-changed-statuses` |
| 상품 주문 상세 조회 | `POST /v1/pay-order/seller/product-orders/query` |
| 조건형 상품 주문 상세 조회 | `GET /v1/pay-order/seller/product-orders` |
| 주문 ID 기준 상품 주문 번호 조회 | `GET /v1/pay-order/seller/orders/{orderId}/product-order-ids` |

권장 흐름:

1. 마지막 수집 시각 이후 변경된 상품 주문 목록을 조회한다.
2. 응답의 상품 주문 번호를 모아 상세 조회를 호출한다.
3. 상세 응답을 내부 `Order` 모델로 변환한다.
4. 이미 존재하는 주문은 내부 주문 ID 또는 마켓 상품 주문 번호 기준으로 갱신한다.
5. 신규 주문은 내부 상태 `NEW` 또는 클레임 상태로 생성한다.

변경 상품 주문 내역 조회는 변경 일시 기준으로 동작한다.
공식 문서 기준으로 종료 일시를 생략하면 시작 일시 이후 24시간 범위를 조회하며, 요청 범위 내 결과가 많을 경우 `more` 값을 이용한 이어받기 조회가 필요하다.

### 5.1 변경 상품 주문 조회 구현 체크리스트

| 항목 | 기준 |
|---|---|
| 필수 파라미터 | `lastChangedFrom` |
| 선택 파라미터 | `lastChangedTo`, `lastChangedType`, `moreSequence`, `limitCount` |
| 기본/최대 응답 수 | 최대 300건 기준으로 설계 |
| 이어받기 | 응답의 `more.moreFrom`, `more.moreSequence`를 다음 요청에 사용 |
| 저장해야 할 기준값 | 마지막 성공 수집 시각, 이어받기 시퀀스, 마지막 성공 요청 범위 |
| 상세 조회 연결 | 응답의 상품 주문 번호를 `POST /product-orders/query`로 넘겨 상세 조회 |

구현 기준:
- 주문수집은 한 번의 대량 전체 조회보다 변경분 폴링 방식으로 구현한다.
- 같은 시각에 여러 변경 건이 있을 수 있으므로 `moreSequence`를 반드시 고려한다.
- 주문수집 실패 시 마지막 성공 수집 시각을 덮어쓰지 않는다.
- 재시도 시 같은 범위를 다시 조회해도 내부 저장은 상품 주문 번호 기준으로 멱등 처리한다.

### 5.2 상품 주문 상세 조회 구현 체크리스트

| 항목 | 기준 |
|---|---|
| API | `POST /v1/pay-order/seller/product-orders/query` |
| 필수 본문 | `productOrderIds` |
| 선택 본문 | `quantityClaimCompatibility` |
| 응답 주요 묶음 | `order`, `productOrder`, `delivery`, `currentClaim`, `beforeClaim`, `completedClaims` |

주문관리에서 반드시 추출할 정보:
- 주문 번호, 상품 주문 번호
- 주문일시, 결제일시
- 상품명, 옵션명, 수량, 결제금액
- 구매자 이름/연락처
- 수취인 이름/연락처/주소
- 개인통관부호가 제공되는 경우 해당 값
- 배송방법, 택배사, 송장번호
- 현재 클레임 타입과 클레임 상태

## 6. 내부 주문 상태 매핑

현재 주문관리 내부 상태는 다음과 같다.

| 내부 상태 | 화면 탭 | 네이버 연동 해석 |
|---|---|---|
| `NEW` | 신규주문 | 결제 완료 후 발주 확인 전 주문 |
| `PREPARING` | 상품준비 | 발주 확인 완료 후 소싱/구매 진행 중 |
| `READY_TO_SHIP` | 발송대기 | 국내송장 확보 또는 입력 대기 |
| `SHIPPING` | 배송중 | 네이버 발송 처리 완료 |
| `DELIVERED` | 배송완료 | 배송완료 또는 구매확정 계열 결과 |
| `CANCELED` | 취소 | 취소 완료 주문 |
| `CLAIM` | 취소/반품/교환 | 취소, 반품, 교환 클레임 주문 |

주의:
- 아래 매핑은 공식 상태 흐름 문서 기준의 구현 초안이다.
- 실제 저장 시에는 `productOrderStatus`, `lastChangedStatusCode`, `claimType`, `claimStatus`를 함께 보고 판단한다.

### 6.1 네이버 상태값 기준 매핑 초안

| 네이버 기준 | 내부 상태 | 처리 기준 |
|---|---|---|
| `productOrderStatus=PAYED`, 클레임 없음, 발주확인 전 | `NEW` | 신규주문 탭 |
| `productOrderStatus=PAYED`, 발주확인 완료 후 소싱/구매 진행 중 | `PREPARING` | 상품준비 탭 |
| `productOrderStatus=PAYED`, 내부 국내송장 확보 또는 입력 완료 전/후 | `READY_TO_SHIP` | 발송대기 탭 |
| `productOrderStatus=DELIVERING`, `lastChangedStatusCode=DISPATCHED` | `SHIPPING` | 배송중 탭 |
| `productOrderStatus=DELIVERED` 또는 `PURCHASE_DECIDED` | `DELIVERED` | 배송완료 탭 |
| `productOrderStatus=CANCELED` 또는 `claimStatus=CANCEL_DONE` | `CANCELED` | 취소 완료 |
| `claimType=CANCEL`, `RETURN`, `EXCHANGE` 중 진행 중 클레임 | `CLAIM` | 취소/반품/교환 화면 |

주의:
- 네이버 발주확인은 공식 상태 흐름상 상품주문상태를 별도 상태로 바꾸지 않을 수 있다. 주문관리는 내부 처리 단계 관리를 위해 발주확인 성공 후 `PREPARING`으로 이동한다.
- 네이버 발송처리는 배송중 전이를 일으키는 핵심 API다.
- 배송완료 이벤트는 별도 이벤트가 항상 제공되는 구조가 아닐 수 있으므로 변경분 조회와 상세 조회 결과를 함께 본다.

## 7. 주문확인 기준

주문관리의 `주문확인` 버튼은 네이버의 발주 확인 처리에 대응한다.

| 주문관리 액션 | 네이버 API |
|---|---|
| 주문확인 | `POST /v1/pay-order/seller/product-orders/confirm` |

공식 문서 기준으로 발주 확인 처리는 단수 또는 복수 상품 주문 번호를 처리할 수 있으며, 한 요청에서 처리 가능한 상품 주문 번호는 최대 30개다.

주문관리 적용 기준:
- 신규주문 탭의 개별 `주문확인`은 해당 상품 주문 1건을 처리한다.
- 상단 `주문확인`은 체크된 주문만 처리한다.
- 체크된 주문이 없으면 버튼은 비활성화한다.
- API 성공 시 내부 상태를 `PREPARING`으로 변경한다.
- 부분 실패가 발생하면 성공 건만 상태를 변경하고 실패 건은 현재 상태를 유지한다.

구현 체크리스트:
- 요청 전 내부 상태가 `NEW`인지 확인한다.
- 네이버 상품 주문 번호가 없는 건은 호출 대상에서 제외한다.
- 30건을 초과하면 30건 단위로 분할한다.
- 응답의 성공 상품 주문 번호만 `PREPARING`으로 이동한다.
- 실패 정보는 주문별 처리 결과 또는 토스트/로그에 남긴다.

## 8. 발송대기/배송중 처리 기준

주문관리의 `배송중 처리` 버튼은 네이버의 발송 처리에 대응한다.

| 주문관리 액션 | 네이버 API |
|---|---|
| 배송중 처리 | `POST /v1/pay-order/seller/product-orders/dispatch` |

공식 문서 기준으로 발송 처리는 단수 또는 복수 상품 주문을 처리할 수 있으며, 한 요청에서 처리 가능한 상품 주문 번호는 최대 30개다.
LLM용 공식 인덱스 기준으로 발송 처리에는 `deliveryMethod`, 택배사 코드, 송장번호가 실무상 필수다.

### 8.1 발송 처리 요청값 기준

| 요청 필드 | 주문관리 데이터 | 기준 |
|---|---|---|
| `dispatchProductOrders.productOrderId` | 네이버 상품 주문 번호 | 필수 취급 |
| `dispatchProductOrders.deliveryMethod` | 배송 방법 | 일반 택배는 `DELIVERY` 기준 |
| `dispatchProductOrders.deliveryCompanyCode` | 택배사 코드 | 주문관리 택배사 라벨을 네이버 코드로 변환 |
| `dispatchProductOrders.trackingNumber` | 송장번호 | 국내송장번호 |
| `dispatchProductOrders.dispatchDate` | 발송일시 | 배송중 처리 시각 또는 실제 발송일시 |

주요 택배사 코드 예시:

| 주문관리 라벨 | 네이버 코드 |
|---|---|
| CJ대한통운 | `CJGLS` |
| 한진택배 | `HANJIN` |
| 롯데택배 | `HYUNDAI` |
| 로젠택배 | `KGB` |
| 우체국택배 | `EPOST` |

실제 구현 전에는 발송 처리 공식 문서와 물류사 조회 API 기준으로 전체 택배사 코드 매핑 테이블을 별도 관리한다.

주문관리 적용 기준:
- 발송대기 탭에서 송장번호가 있는 주문만 배송중 처리 대상이다.
- 송장번호가 없으면 개별 `배송중 처리` 버튼은 비활성화한다.
- 상단 `배송중 처리`는 선택 여부와 관계없이 송장번호가 있는 주문만 처리한다.
- API 성공 시 내부 상태를 `SHIPPING`으로 변경한다.
- 배송중 상태에서는 네이버 송장 수정 API 전송 버튼을 제공하지 않는다.
- 배송중 이후 변경된 송장번호 항목은 내부 화면에 표시하지 않고, 실제 마켓 수정은 판매자센터에서 처리하는 기준으로 둔다.

응답 처리:
- `successProductOrderIds`에 포함된 주문만 `SHIPPING`으로 이동한다.
- `failProductOrderInfos`에 포함된 주문은 `READY_TO_SHIP` 상태를 유지한다.
- 실패 사유가 송장번호/택배사 코드 문제이면 배송정보 수정 또는 택배정보 입력 오류로 안내한다.
- 실패 사유가 상태 전이 문제이면 네이버 상세 조회 후 현재 상태를 다시 동기화한다.

## 9. 판매자 주문취소 기준

주문관리의 `주문취소`는 네이버의 판매자 직접 취소 요청 또는 고객 취소 요청 승인과 구분해서 설계한다.

| 상황 | 네이버 API | 주문관리 기준 |
|---|---|---|
| 판매자가 직접 취소 요청 | `POST /v1/pay-order/seller/product-orders/{productOrderId}/claim/cancel/request` | 신규주문, 상품준비, 발송대기에서 주문취소 후보 |
| 고객이 신청한 취소 승인 | `POST /v1/pay-order/seller/product-orders/{productOrderId}/claim/cancel/approve` | 클레임 화면의 취소처리 후보 |

적용 기준:
- 네이버가 허용하지 않는 상태에서는 API 실패로 처리하고 내부 상태를 변경하지 않는다.
- 취소 요청 성공 시 내부 주문은 클레임 화면에서 확인할 수 있도록 `CLAIM` 또는 `CANCELED` 계열로 매핑한다.
- 현재 프론트 MVP의 주문취소 확인 모달은 유지하되, 실제 API 연동 시 취소 사유 코드 입력이 필요할 수 있다.

### 9.1 판매자 취소 요청 구현 기준

판매자 직접 취소 요청은 아직 발송 처리되지 않은 상품 주문에 대해서만 후보로 본다.
공식 문서 기준으로 발송 처리 전 상태에서 사용하며, 이미 발송된 주문은 반품 흐름으로 처리한다.

| 요청 필드 | 기준 |
|---|---|
| `productOrderId` | path의 네이버 상품 주문 번호 |
| `cancelReason` | 필수 취소 사유 코드 |
| `cancelDetailedReason` | 선택, 상세 사유 |
| `cancelQuantity` | 선택, 미입력 시 전체 수량 취소 |

취소 사유 코드:

| 코드 | 의미 |
|---|---|
| `INTENT_CHANGED` | 구매 의사 취소 |
| `COLOR_AND_SIZE` | 색상 및 사이즈 변경 |
| `WRONG_ORDER` | 다른 상품 잘못 주문 |
| `PRODUCT_UNSATISFIED` | 서비스 불만족 |
| `DELAYED_DELIVERY` | 배송 지연 |
| `SOLD_OUT` | 상품 품절 |
| `INCORRECT_INFO` | 상품 정보 상이 |

주문관리 적용:
- 신규주문, 상품준비, 발송대기에서 주문취소 버튼을 노출할 수 있다.
- 네이버 API 호출 전에는 네이버 상세 조회로 현재 `productOrderStatus`와 클레임 상태를 확인한다.
- 취소 요청 성공 후에는 취소 승인 API가 필요한지 응답과 현재 클레임 상태를 기준으로 판단한다.
- API 실패 시 내부 상태를 `CANCELED`로 선반영하지 않는다.

## 10. 반품/교환 기준

네이버 주문 API에는 반품 승인, 반품 보류, 반품 보류 해제, 반품 거부, 반품 요청, 교환 수거 완료, 교환 재배송 처리, 교환 보류, 교환 보류 해제, 교환 거부 API가 존재한다.

현재 주문관리 MVP 기준:
- 취소/반품/교환 화면은 클레임 목록 확인과 기본 처리 버튼 중심이다.
- 반품/교환의 실제 승인, 회수, 재배송 API 자동화는 MVP 범위에서 보류한다.
- 추후 자동화 시 반품/교환은 별도 상세 정책 문서로 분리한다.

## 11. 판매자정보 기준

마켓연동 이후 계정 검증과 스토어 식별에는 판매자정보 API를 사용한다.

| 목적 | API |
|---|---|
| 계정 기본 정보 확인 | `GET /v1/seller/account` |
| 계정에 연결된 채널 정보 조회 | `GET /v1/seller/channels` |
| 발송 가능한 물류사/택배사 코드 확인 | `GET /v1/logistics/logistics-companies` |

주문관리 적용 기준:
- 마켓 추가 또는 수정 시 `테스트` 버튼은 토큰 발급과 계정/채널 조회 성공 여부를 확인하는 용도로 설계한다.
- 스토어명은 사용자가 구분하기 위한 표시명이며, 실제 채널 번호나 계정 식별자는 별도 내부 필드로 저장한다.
- 택배사 코드는 발송 처리 전에 네이버 코드와 주문관리 택배사 라벨 간 매핑 테이블을 별도로 관리한다.

계정/채널 조회 구현 기준:
- 마켓연동 `테스트`는 토큰 발급 후 `GET /v1/seller/account`와 `GET /v1/seller/channels` 호출 성공 여부를 확인한다.
- `channels` 응답의 채널 유형은 `STOREFARM`, `WINDOW`를 받을 수 있으므로 스마트스토어 채널만 주문수집 대상으로 선택한다.
- 403 계열 오류는 권한, 약관 동의, 연동 상태 오류로 사용자 안내 문구를 분리한다.
- 404 계열 오류는 채널/스토어/연동 정보가 끊긴 상태로 보고 재연동을 안내한다.

## 12. 내부 필드 매핑 초안

| 내부 필드 | 네이버 기준 후보 | 비고 |
|---|---|---|
| `marketOrderNo` | 주문 번호 또는 상품 주문 번호 | 화면에는 `마켓 주문번호 : 주문번호`로 표시 |
| `marketProductOrderNo` | 상품 주문 번호 | 목록 컬럼에서는 삭제했지만 데이터에는 유지 |
| `orderDate` | 주문일시/결제일시 | 필터 기준은 현재 주문일시 중심 |
| `productName` | 상품명 | 상품정보 컬럼 |
| `optionName` | 옵션명 | 상품정보 컬럼 |
| `quantity` | 수량 | 상품정보/상세 |
| `buyer` | 주문자 정보 | 자세히보기의 구매자 |
| `recipient` | 수취인 정보 | 배송정보 |
| `customsClearanceCode` | 개인통관부호 | 통관부호 일치/불일치 판단 |
| `carrier` | 택배사 코드/라벨 | 발송 처리 시 코드 매핑 필요 |
| `trackingNumber` | 송장번호 | 발송대기/배송중 처리 기준 |
| `claimType` | 취소/반품/교환 구분 | 클레임 화면 |

이 매핑은 현재 화면과 mock 모델 기준의 초안이다.
실제 API 연동 시 네이버 응답 스키마의 정확한 필드명을 기준으로 확정한다.

## 13. 구현 시 주의사항

- 네이버 API 호출은 백엔드에서만 수행한다.
- 클라이언트에는 Client Secret, access token, 전자서명 생성 재료를 노출하지 않는다.
- 주문수집은 변경분 조회와 상세 조회를 분리한다.
- 발주 확인과 발송 처리는 최대 처리 건수 제한을 고려해 30건 단위로 분할한다.
- 부분 성공/부분 실패 응답을 전제로 주문별 처리 결과를 저장한다.
- API 실패 시 내부 주문 상태를 임의로 다음 단계로 이동하지 않는다.
- 마켓 필터와 스토어 필터는 조회 조건이며, 현재 화면의 `주문수집` 버튼은 특정 마켓/스토어만 수집하는 기능으로 확정하지 않는다.
- 배송중 이후 송장 수정 전송은 현재 MVP에서 제공하지 않는다.

### 13.1 기능 구현 전 확인 순서

1. `00_공식문서_전체링크_인덱스.md`에서 해당 기능의 공식 문서 링크를 연다.
2. 요청 파라미터, 요청 본문, 응답 성공/실패 구조를 확인한다.
3. 내부 `Order` 모델에 필요한 필드가 있는지 확인한다.
4. 없으면 API 응답 원본 저장 영역 또는 확장 필드를 먼저 설계한다.
5. 부분 실패가 가능한 API는 성공/실패 주문 번호를 분리해 처리한다.
6. UI 상태 변경은 API 성공 건에만 적용한다.
7. 실패 건은 재시도 가능 여부와 사용자 안내 문구를 남긴다.

## 14. 현재 MVP 미구현/보류

- 실제 OAuth 토큰 발급
- 네이버 주문 변경분 수집
- 네이버 발주 확인 API 호출
- 네이버 발송 처리 API 호출
- 네이버 취소 요청/취소 승인 API 호출
- 반품/교환 자동 처리
- 네이버 배송중 송장 수정 전송
- 네이버 API 오류 코드별 UI 메시지 매핑
- 택배사 코드 매핑 테이블

## 15. 다음 확정 필요 항목

1. 네이버 응답 상태 enum과 주문관리 내부 `OrderStatus` 최종 매핑
2. 취소 가능 상태와 취소 사유 코드 정책
3. 택배사 라벨과 네이버 택배사 코드 매핑
4. 통관부호 필드 수집 가능 여부와 검증 주체
5. 부분 실패 처리 시 재시도 정책
6. 주문수집 기준 시각 저장 위치와 재수집 범위
7. API 호출 제한 대응 정책
