---
버전: v1.5
최종수정일: 2026-08-21
작성자/승인자: 기획팀
상태: [Draft - 공식 문서 기반 연동 기준]
---

# 네이버 커머스API 연동 기준

## 1. 문서 목적

이 문서는 독립 주문관리 서비스 커머스라이프에서 스마트스토어 주문을 실제 네이버 커머스API와 연동할 때 필요한 기준을 정리한다.
현재 스마트스토어 주문·클레임 읽기와 주문확인·발송 command 코어는 서버에 구현되어 있다. 이 문서는 구현 계약과 아직 실계정 UAT가 필요한 쓰기 capability를 함께 관리한다.

기준 문서는 네이버 커머스API 공식 문서다.
확인 기준 버전은 2026-07-10 현재 문서에 노출된 최신 버전 `2.82.0 (2026-07-07)`이다.

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
| 호출 제한 | https://apicenter.commerce.naver.com/docs/restriction |
| 주문 상태 매핑 | `[주문]-주문-상태-변경-흐름도` |
| 주문수집 | `GET /v1/pay-order/seller/product-orders/last-changed-statuses - 변경 상품 주문 내역 조회` |
| 주문 상세 조회 | `POST /v1/pay-order/seller/product-orders/query - 상품 주문 상세 내역 조회` |
| 주문확인 | `POST /v1/pay-order/seller/product-orders/confirm - 발주 확인 처리` |
| 배송중 처리 | `POST /v1/pay-order/seller/product-orders/dispatch - 발송 처리` |
| 직접전달 | 발송 처리의 `deliveryMethod: DIRECT_DELIVERY` |
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
| 소싱하기 | 직접 연동 없음 | 신규주문 매칭과 상품준비 구매대행을 상태별로 처리하는 커머스라이프 주문관리 흐름 |
| 발송대기 | 필요 | 구매·국내송장 저장 완료 후 발송 처리 |
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
| `READY_TO_SHIP` | 발송대기 | 구매·국내송장 저장 완료 후 네이버 발송 처리 대기 |
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
| `productOrderStatus=PAYED`, 내부 구매·국내송장 저장 완료, 네이버 발송 처리 전 | `READY_TO_SHIP` | 발송대기 탭 |
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
- 발송대기 탭에서 구매 완료와 송장번호가 확인된 주문만 배송중 처리 대상이다.
- 정상 발송대기 주문은 송장을 보유한다. 송장이 누락된 비정상 데이터는 `배송중 처리`를 비활성화하고 오류로 분류한다.
- 상단 일괄, 행, 상세는 모두 `배송중 처리`를 사용한다. 미발송 주문은 마켓 계정에 저장된 `DELIVERY` 또는 `DIRECT_DELIVERY` 기본값을 확인만 한다.
- 서버는 클라이언트가 보낸 방식보다 마켓 계정 설정을 우선해 `SHIPPING_PROCESS` 명령을 확정하고 provider 상태를 먼저 조회한다. 이미 발송됐다면 provider의 실제 방식을 반영하고 dispatch API를 다시 호출하지 않는다.
- 미발송일 때만 계정 기본 방식에 해당하는 `INVOICE_SUBMIT` 또는 `DIRECT_DELIVERY` capability와 사전조건을 검증해 dispatch API를 호출한다.
- `배송중 처리` 명령을 접수한 순간부터 내부 국내송장 수정을 잠근다. 명령이 실행·재시도·결과확인 중이거나 성공한 뒤에도 수정 요청을 거부한다.
- 전송 후에는 네이버 송장·발송 방식 수정 API 버튼을 제공하지 않는다.
- 발송 완료 주문에는 판매자센터 이동, 수정내역 불러오기, 정정 명령 재호출 기능을 제공하지 않는다. 이후 마켓 상태는 일반 주문수집 결과로만 반영한다.

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
- 판매자 취소 요청 접수 성공은 최종 취소가 아니므로 내부 주문을 `ON_HOLD`, 마켓 처리 상태를 `CANCEL_REQUESTED`로 보존한다. 이후 수집에서 상품주문 최종 `CANCELED`가 확인될 때만 종료 상태로 전환한다.
- 주문취소 모달은 공식 7개 사유 코드와 상세 사유·부분수량을 입력하며, 서버 command schema와 같은 허용목록을 계약 테스트로 대조한다.

### 9.1 판매자 취소 요청 구현 기준

판매자 직접 취소 요청은 아직 발송 처리되지 않은 상품 주문에 대해서만 후보로 본다.
공식 문서 기준으로 발송 처리 전 상태에서 사용하며, 이미 발송된 주문은 반품 흐름으로 처리한다.

| 요청 필드 | 기준 |
|---|---|
| `productOrderId` | path의 네이버 상품 주문 번호 |
| `cancelReason` | 필수 취소 사유 코드 |
| `cancelDetailedReason` | 선택, 상세 사유 |
| `cancelQuantity` | 선택. 전체 취소는 필드를 전송하지 않으며 provider의 현재 `remainQuantity` 전체로 해석한다. 명시한 부분수량은 `remainQuantity` 이하여야 한다. |

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
- 판매자 취소 요청과 구매자가 신청한 취소승인은 별도 흐름이다. 판매자 취소 응답이나 인과가 불명확한 claim을 근거로 구매자 취소승인 API를 연쇄 호출하지 않는다.
- API 실패 시 내부 상태를 `CANCELED`로 선반영하지 않는다.

현재 구현(2026-07-13):
- 단건 공식 endpoint와 공통 성공·실패 응답 파싱, `quantityClaimCompatibility=true` 상세 선조회, 로컬 수량과 provider `initialQuantity` 일치, 명시적 부분취소 수량과 `remainQuantity` 상한, 기존 클레임·배송상태 충돌 검사를 구현했다.
- 주문 화면은 위 7개 공식 사유와 2~500자 상세 사유를 요구하며 단건 부분수량과 일괄 주문별 전체수량을 검증한다. 비공식 사유는 브라우저와 서버 양쪽에서 거부한다.
- 최종 `productOrderStatus=CANCELED`만 적용 완료로 판정한다. 현재·deprecated·완료 `CANCEL/ADMIN_CANCEL` 흔적은 명령과의 인과가 증명되기 전 `INDETERMINATE`이며, `CANCEL_REJECT`도 미적용이나 재실행 가능 근거로 사용하지 않는다. 반품·교환 흔적은 충돌로 처리한다.
- 네이버 판매자 취소 쓰기는 provider 멱등키가 없으므로 causal baseline과 request channel allowlist가 구현되기 전 모든 `SELLER_CANCEL UNKNOWN`을 수동 대사로 유지하고 절대 자동 재호출하지 않는다. 접수 성공은 내부 상품 `ON_HOLD`, 마켓 처리 상태 `CANCEL_REQUESTED`로 기록하고 주문확인·매칭·소싱·외부구매·직접전달·발송·재취소를 차단한다.
- 기본 capability는 `MANUAL_FALLBACK`이다. OWNER/ADMIN이 실계정 UAT 증빙을 승인해 계정별 `SELLER_CANCEL = API / PASSED`가 된 경우에만 명령 접수와 worker 실행이 모두 허용된다.
- 아직 실계정 UAT를 수행하지 않았으므로 운영 API 호출이 가능하다고 판정하지 않는다. 구매자 취소요청 승인과 반품·교환 쓰기도 계속 조회 전용이다.

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
- 네이버 자동 주문 변경분 수집의 실계정 대사·장시간 운전 UAT
- 네이버 발주 확인·발송 처리 API의 실계정 UAT와 계정별 capability 승격
- 네이버 판매자 취소 요청 API의 실계정 UAT, causal baseline, request channel allowlist
- 구매자 취소 요청 승인 API 호출
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

## 16. 2026-07-10 실서비스 추가 기준

### 16-1. 직접전달

네이버 공식 발송 처리 API는 배송방법으로 `DIRECT_DELIVERY`를 제공한다.

- 공식 문서: https://apicenter.commerce.naver.com/docs/commerce-api/current/seller-dispatch-product-orders-pay-order-seller
- 요청 단위는 상품주문 ID다.
- 일반 택배의 국내송장과 직접전달용 마켓 제출값은 별도 모델로 저장한다.
- API 성공 전 내부 마켓 상태를 배송중으로 변경하지 않는다.
- 직접전달이 먼저 성공했어도 소싱 구매와 실제 국내배송이 남아 있으면 내부 작업단계는 상품준비를 유지한다.
- 직접전달 선처리 후 구매와 국내송장이 확보되면 내부 작업단계는 발송대기로 이동하고, 동일한 `배송중 처리`를 다시 실행하기 전까지 자동으로 배송중이 되지 않는다.
- 발송대기에서 직접전달을 선택한 경우에는 API 성공과 함께 내부 작업단계도 배송중으로 변경한다.
- 마켓 수집에서 직접전달 배송중을 확인해도 그 사실만으로 내부 작업단계를 배송중으로 올리지 않는다.
- 직접전달과 실제 국내송장 추적 결과를 같은 상태로 덮어쓰지 않는다.

### 16-2. 호출 제한

호출 제한은 단일 고정 숫자로 가정하지 않는다. API, 애플리케이션, 판매자 규모에 따라 달라질 수 있으므로 다음을 적용한다.

- 응답 헤더와 429를 기준으로 계정·API별 적응형 rate limiter를 사용한다.
- 429는 지수 backoff와 jitter 후 재시도한다.
- 변경분 조회 결과는 최대 응답 건수와 cursor를 기준으로 끝까지 페이지 처리한다.
- cursor는 주문 upsert가 성공한 트랜잭션에서만 전진한다.
- 수동 주문수집도 예약 수집과 동일한 계정별 제한기를 사용한다.

### 16-3. 솔루션 온보딩

개별 자체개발 연결과 다수 셀러에게 제공하는 솔루션 연동은 심사·동의 방식이 다를 수 있다.

- 공식 입점 절차: https://apicenter.commerce.naver.com/docs/solution-doc/1000/%EB%A7%88%EC%BC%93-%EC%9E%85%EC%A0%90-%ED%94%84%EB%A1%9C%EC%84%B8%EC%8A%A4
- 소싱라이프가 제3자 셀러용 SaaS로 운영될 때 필요한 솔루션마켓 입점과 API 그룹 권한을 출시 전 확인한다.
- 개인사업자 셀러의 동의·연결 방식은 실계정 온보딩 테스트로 확정한다.

### 16-4. 클레임 capability

공식 API에는 취소 승인·요청, 반품 승인·보류·보류해제·거부·요청, 교환 수거완료·재배송·보류·보류해제·거부가 존재한다.

실서비스 UI는 현재 상품주문 상태와 claim 상태를 조회한 뒤 실행 가능한 액션만 표시한다. 반품·교환을 조회 전용으로 남겨둔 현재 mock 범위는 실서비스 완료 기준을 충족하지 않는다.

현재 수집 구현(2026-07-12):

- 상품주문 상세 조회 본문에 `quantityClaimCompatibility=true`를 명시한다.
- `currentClaim.cancel|return|exchange`와 `completedClaims[]`를 공통 claim case/line/event로 변환한다. deprecated 최상위 `cancel|return|exchange`는 `currentClaim`이 없을 때만 호환 입력으로 읽는다.
- `PURCHASE_DECISION_HOLDBACK`은 취소·반품·교환 원장에 넣지 않는다. `ADMIN_CANCEL`은 마켓 요청 취소로 구분해 수집한다.
- `requestQuantity`가 상품주문 수량을 초과하거나 `claimId`가 없으면 임의 보정·임시 ID 생성 없이 `CLAIM_INBOUND_SKIPPED` 감사와 PARTIAL 결과로 격리한다.
- 자유서술 사유는 claim 전용 암호화 context로 저장하고 API에는 `[PROTECTED]`만 노출한다. 수거지 주소·전화번호는 정규화 payload와 감사 metadata에 넣지 않는다.
- 수집 worker는 주문 sync lease의 tenant/account를 주입하며 provider 응답의 tenant 식별값을 신뢰하지 않는다.
- 구매자 클레임의 승인·거절·보류·회수·재배송 쓰기 capability는 실계정 UAT 전까지 `UNSUPPORTED/UNAVAILABLE`이다. 판매자 취소는 별도 outbound command이며 현재 `MANUAL_FALLBACK`이다.

### 16-5. 자동 주문수집 scheduler

현재 구현(2026-07-12)은 전용 `WORKER_DATABASE_URL` 역할 검증 후 inbound·scheduler·outbound loop를 병렬 실행한다.

- `is_active=true`, `auth_status=CONNECTED`인 네이버 계정만 `SCHEDULED / ORDERS` 실행 대상으로 삼는다.
- 마지막 terminal 실행(`SUCCEEDED`, `PARTIAL`, `FAILED`, `CANCELED`, `DEAD`) 종료 후 설정 간격이 지난 계정만 예약한다.
- `sync_runs_one_active_stream_uidx`와 같은 partial conflict 조건으로 계정·stream별 `PENDING/RUNNING/RETRY` 중복 실행을 차단한다.
- 실행 생성 시 `window_end`를 고정하고, 기존 cursor watermark와 overlap 또는 초기 lookback으로 `window_start`를 정한다. 재시도도 같은 실행의 고정 구간을 사용한다.
- 예약 실행과 `SYSTEM / SYNC_RUN_SCHEDULED` 감사로그는 같은 DB 트랜잭션에서 생성한다.
- 주기·간격·배치·최대 시도는 `NAVER_SYNC_SCHEDULER_POLL_INTERVAL_MS`, `NAVER_ORDER_SYNC_INTERVAL_MS`, `NAVER_SYNC_SCHEDULER_BATCH_SIZE`, `NAVER_SCHEDULED_SYNC_MAX_ATTEMPTS`로 설정한다.

이는 코드·단위·SQL 계약 테스트 기준 구현 상태다. 실제 네이버 판매자 계정의 누락률·호출 제한·장시간 운전 UAT는 완료되지 않았으며, 쿠팡·11번가·ESM에는 자동 수집 scheduler와 생산 adapter가 아직 구현되지 않았다.
