---
버전: v1.0
최종수정일: 2026-07-10
상태: [Active - 공식 공개문서 조사]
---

# 마켓별 API 기능지원 및 검증 매트릭스

## 1. 판정 기준

| 판정 | 의미 |
|---|---|
| 확인 | 공식 공개문서에서 기능과 요청방식을 확인 |
| 조건부 | API는 있으나 상태·계약·승인·운영정책 검증 필요 |
| 확인 필요 | 로그인 문서 또는 실계정 테스트가 필요 |
| 미지원 | 공식적으로 불가하거나 대체 흐름만 제공 |

이 표는 2026-07-10 공개문서 조사 결과다. 실제 출시 capability는 공식문서 버전, 마켓 승인, 실계정 UAT가 모두 연결된 경우에만 API로 활성화한다.

## 2. 기능 매트릭스

| 기능 | 스마트스토어 | 쿠팡 | 11번가 | G마켓/옥션 ESM |
|---|---|---|---|---|
| 주문 목록·상세 | 확인 | 확인 | 확인 | 확인 |
| 변경분/증분 수집 | 확인 | 기간 폴링 | 기간 폴링 | 기간 폴링 |
| 주문확인 | 확인 | 확인 | 확인 | 확인 |
| 일반 송장 발송 | 확인 | 확인 | 확인 | 확인 |
| 송장 정정 | 공식 API 확인 필요 항목 보강 | 확인 | 확인 필요 | 공식 가이드 확인 필요 |
| 직접전달 | DIRECT_DELIVERY 확인 | DIRECT 조건부 | 확인 필요 | 확인 필요 |
| 판매자 주문취소 | 확인 | 확인 | 조건부 | 조건부 |
| 구매자 취소 승인·거부 | 확인 | 취소·반품 API 조건부 | 조건부 | 조건부 |
| 반품 조회 | 확인 | 확인 | 확인 | 확인 |
| 반품 승인·거부·보류 | 확인 | 일부 API 확인 | 조건부 | 조건부 |
| 교환 조회 | 확인 | 확인 | 확인 | 확인 |
| 교환 회수·재배송 | 확인 | 확인 | 조건부 | 조건부 |
| 구매확정 조회 | 확인 | 주문 상태 확인 | 확인 필요 | 확인 |
| 개인통관고유부호 | 응답 실계정 확인 필요 | personalCustomsClearanceCode 확인 | 확인 필요 | InfoCin 확인 |
| 테스트 서버 | 공개문서 기준 별도 확인 | 없음 | 없음으로 조사 | 개발·운영 승인 절차 확인 필요 |

공통 UI는 표의 차이를 숨기지 않는다. 액션 capability가 확인되지 않으면 MANUAL_FALLBACK 또는 UNSUPPORTED로 표시한다.

## 3. 스마트스토어

### 3-1. 인증과 운영

- OAuth2 client_credentials 방식으로 액세스 토큰을 발급한다.
- 토큰은 서버에서만 사용하고 만료 전에 갱신한다.
- 변경 상품 주문 조회와 상세 조회를 조합한다.
- 대량 주문확인·발송은 공식 최대 처리 건수에 맞춰 분할한다.
- 호출 제한은 고정 숫자가 아니라 응답과 429에 맞춘 적응형 제한기로 처리한다.
- 다수 셀러 SaaS 운영에는 솔루션마켓 입점·API 그룹 심사·판매자 동의 절차를 확인한다.

### 3-2. 확인된 주문 기능

- 상품 주문 목록·상세·변경분 조회
- 발주 확인
- 발송 처리
- 발송 지연
- 판매자 취소 요청과 구매자 취소 승인
- 반품 승인·요청·보류·해제·거부
- 교환 수거완료·재배송·보류·해제·거부
- DIRECT_DELIVERY

### 3-3. 공식 링크

- 소개: https://apicenter.commerce.naver.com/docs/introduction
- 최신 API: https://apicenter.commerce.naver.com/docs/commerce-api/current
- 인증: https://apicenter.commerce.naver.com/docs/commerce-api/current/exchange-sellers-auth
- 호출 제한: https://apicenter.commerce.naver.com/docs/restriction
- 주문 조회: https://apicenter.commerce.naver.com/docs/commerce-api/current/%EC%A3%BC%EB%AC%B8-%EC%A1%B0%ED%9A%8C
- 발주·발송: https://apicenter.commerce.naver.com/docs/commerce-api/current/%EB%B0%9C%EC%A3%BC-%EB%B0%9C%EC%86%A1-%EC%B2%98%EB%A6%AC
- 취소: https://apicenter.commerce.naver.com/docs/commerce-api/current/%EC%B7%A8%EC%86%8C
- 반품: https://apicenter.commerce.naver.com/docs/commerce-api/current/%EB%B0%98%ED%92%88
- 교환: https://apicenter.commerce.naver.com/docs/commerce-api/current/%EA%B5%90%ED%99%98
- 솔루션 입점: https://apicenter.commerce.naver.com/docs/solution-doc/1000/%EB%A7%88%EC%BC%93-%EC%9E%85%EC%A0%90-%ED%94%84%EB%A1%9C%EC%84%B8%EC%8A%A4

## 4. 쿠팡

### 4-1. 인증·승인 제약

- Vendor ID, Access Key, Secret Key로 HMAC 서명을 생성한다.
- 사업자 인증이 끝난 WING 판매자만 키를 발급할 수 있다.
- 판매자 ID별 Open API 키는 1개이며 연동업체 또는 자체개발 중 하나를 선택한다.
- 키 유효기간은 180일이다.
- 재발급 시 이전 키는 즉시 사용할 수 없으므로 무중단 교체 절차가 필요하다.
- 등록 정보 반영에 시간이 걸릴 수 있으며, 키·IP 변경을 반복하는 운영을 피한다.
- 공개문서 기준 테스트 환경이 없으므로 제한된 실제 주문 UAT 절차가 필요하다.
- 호출 빈도는 일부 API 기준 초당 5회로 조정됐다. account+API 제한기를 둔다.

### 4-2. 수집 주의사항

- 일/분 단위 주문 목록과 단건 조회를 조합한다.
- 구매자는 상품준비중 처리 전 주소를 변경할 수 있으므로 주문확인 성공 후 상세를 다시 읽는다.
- 일반 주문 목록만으로 취소·반품·교환을 완전히 수집한다고 가정하지 않는다.
- 반품/취소와 교환 API를 별도 주기 조회한다.
- 부분 성공 응답을 shipmentBox/item별로 저장한다.

### 4-3. 발송과 DIRECT

- 일반 송장 업로드와 송장 업데이트 API가 있다.
- DIRECT는 숫자로 된 송장값을 요구하고 배송추적을 지원하지 않는다.
- DIRECT 주문은 분할배송 제약이 있다.
- DIRECT를 해외구매대행의 일반 직접전달로 사용하는 정책은 운영 승인과 실계정 검증 후 활성화한다.
- 마켓에 보낸 DIRECT 숫자와 실제 국내송장을 별도 필드에 저장한다.

### 4-4. 클레임

- 반품·취소 요청 목록과 단건 조회
- 반품 접수 확인, 승인, 회수송장
- 교환 목록, 회수 확인, 거부, 교환품 송장
- 판매자 주문취소

실행 전 각 API가 요구하는 최신 접수·회수·출고 상태를 확인한다.

### 4-5. 공식 링크

- 포털: https://developers.coupangcorp.com/hc/ko
- 키 발급: https://developers.coupangcorp.com/hc/ko/articles/20288952179993-OpenAPI-Key-%EB%B0%9C%EA%B8%89%EB%B0%9B%EA%B8%B0
- HMAC: https://developers.coupangcorp.com/hc/ko/articles/360033461914-HMAC-Signature-%EC%83%9D%EC%84%B1
- 속도 제한: https://developers.coupangcorp.com/hc/ko/articles/20414599556889-Open-API-%EC%86%8D%EB%8F%84%EC%A0%9C%ED%95%9C-%EC%A0%95%EC%B1%85-%EB%8F%84%EC%9E%85-%EC%95%88%EB%82%B4
- 주문 목록: https://developers.coupangcorp.com/hc/ko/articles/360033919573-%EB%B0%9C%EC%A3%BC%EC%84%9C-%EB%AA%A9%EB%A1%9D-%EC%A1%B0%ED%9A%8C-%EC%9D%BC%EB%8B%A8%EC%9C%84-%ED%8E%98%EC%9D%B4%EC%A7%95
- 상품준비: https://developers.coupangcorp.com/hc/ko/articles/360033792994-%EC%83%81%ED%92%88%EC%A4%80%EB%B9%84%EC%A4%91-%EC%B2%98%EB%A6%AC
- 송장: https://developers.coupangcorp.com/hc/ko/articles/360033793014-%EC%86%A1%EC%9E%A5%EC%97%85%EB%A1%9C%EB%93%9C-%EC%B2%98%EB%A6%AC
- 반품·취소: https://developers.coupangcorp.com/hc/ko/articles/360033919613-%EB%B0%98%ED%92%88-%EC%B7%A8%EC%86%8C-%EC%9A%94%EC%B2%AD-%EB%AA%A9%EB%A1%9D-%EC%A1%B0%ED%9A%8C
- 판매자 취소: https://developers.coupangcorp.com/hc/ko/articles/360033843154-%EC%A3%BC%EB%AC%B8-%EC%83%81%ED%92%88-%EC%B7%A8%EC%86%8C-%EC%B2%98%EB%A6%AC
- 교환: https://developers.coupangcorp.com/hc/ko/articles/360033397594-%EA%B5%90%ED%99%98%EC%9A%94%EC%B2%AD-%EB%AA%A9%EB%A1%9D%EC%A1%B0%ED%9A%8C

## 5. 11번가

### 5-1. 인증과 운영

- 판매자 ID와 Seller API Key를 사용한다.
- Open API Center에서 서비스 등록, API 권한, IP 또는 셀링툴 업체를 설정한다.
- 계정마다 별도 키와 승인 상태를 검증한다.
- 공개 조사상 별도 테스트 서버가 없으므로 제한된 실제 주문 UAT가 필요하다.
- 2026-06-30부터 Seller API 키 유효기간은 180일로 조사됐다.
- 만료 60일 전부터 갱신하고, API 사용으로 마지막 호출 기준 연장되는 정책을 계정 상태에 반영한다.

정확한 자동 연장·갱신 정책은 연결 화면에 설명하기 전에 판매자 계정 공지와 기술지원에서 재확인한다.

### 5-2. 기능

공개 소개에서 주문 목록·상세, 발주 확인, 배송 처리, 취소·반품·교환 조회·처리 범주를 확인했다.

다음은 로그인 개발가이드와 실계정으로 확정해야 한다.

- endpoint, 요청·응답 schema, 상태 enum
- 주문·클레임 조회 최대 기간·페이지 크기
- 호출 제한과 429/오류 정책
- 직접전달 전용 처리
- 부분 성공 응답
- 개인통관고유부호 제공
- 송장 정정

### 5-3. 공식 링크

- 포털: https://openapi.11st.co.kr/openapi/OpenApiFrontMain.tmall
- 주문 API 소개: https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=ORDER
- 클레임 API 소개: https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=CLAIM
- FAQ: https://openapi.11st.co.kr/openapi/OpenApiFaqBoard.tmall?method=getFaqBoardList&unityBrdNo=55

## 6. G마켓·옥션 ESM

### 6-1. 사업·승인 제약

- G마켓·옥션 판매자 회원과 ESM PLUS Master ID가 필요하다.
- 셀링툴 업체는 업체 사업자로 판매자 가입이 필요하다.
- 서비스 URL, 개발 API 범위, 개발기간, 매출·판매자 규모, 소개자료를 제출해 권한을 신청한다.
- 서비스 안정성과 지원 리소스에 따라 승인이 거절될 수 있다.
- 개발 완료 후 테스트와 운영 사용 일정을 협의한다.

따라서 ESM은 코드를 먼저 완성한다고 출시할 수 있는 연동이 아니다. 사업자 승인과 테스트 일정이 P0 외부 의존성이다.

### 6-2. 인증

- ESM Master ID와 Secret Key로 HS256 JWT를 생성한다.
- issuer, subject, audience, site seller 정보와 허용 IP를 검증한다.
- G마켓과 옥션 판매자 ID를 분리 보존한다.
- siteType 값의 의미가 API마다 다를 수 있으므로 전역 공통 enum으로 재사용하지 않고 endpoint별 codec을 둔다.

### 6-3. 수집·호출 제한

- 주문 조회 범위는 공식 가이드 제한 안에서 페이지 처리한다.
- 취소·반품·교환은 일반 주문 목록과 별도 API로 수집한다.
- 클레임 조회 범위가 짧은 API는 짧은 주기와 overlap, 야간 backfill을 함께 사용한다.
- 주문·발송예정 조회의 공개 제한은 판매자 ID 기준 5초당 1회다.
- 계정·endpoint별 제한기를 적용하고 모든 조회를 한 scheduler가 조정한다.

### 6-4. 클레임 주의사항

- 발주 확인 전 구매자 취소와 발주 확인 후 승인 대상의 흐름이 다르다.
- 취소 요청 처리기한과 자동 취소 가능성을 작업함 SLA에 반영한다.
- API에 따라 별도 거절 대신 발송 처리가 사실상 거절 결과가 되는 경우가 있다.
- G마켓과 옥션의 반품·교환 단계가 완전히 같다고 가정하지 않는다.
- 공통 Claim 상태와 사이트별 원상태를 함께 저장한다.

### 6-5. 직접배송

상품 배송 유형의 직접배송과 주문 발송 단계의 직접전달을 동일 기능으로 단정하지 않는다. 주문 발송 API의 필수 택배사·송장 조합을 실계정으로 확인하기 전 capability는 확인 필요로 둔다.

### 6-6. 공식 링크

- 포털: https://etapi.gmarket.com/
- 이용·인증: https://etapi.gmarket.com/pages/API-%EA%B0%80%EC%9D%B4%EB%93%9C
- 주문 조회: https://etapi.gmarket.com/67
- 발주 확인: https://etapi.gmarket.com/68
- 발송 처리: https://etapi.gmarket.com/70
- 취소: https://etapi.gmarket.com/50
- 반품: https://etapi.gmarket.com/53
- 교환: https://etapi.gmarket.com/59
- 호출 제한: https://etapi.gmarket.com/198

## 7. 마켓 연결 입력정보

| 마켓 | 사용자 입력 | 서버 확인 결과 |
|---|---|---|
| 스마트스토어 | 연동용 판매자ID, Client ID, Client Secret | 계정, 채널, 권한, 토큰 만료 |
| 쿠팡 | Vendor ID, Access Key, Secret Key | 업체 일치, 키 만료, 연동방식, 호출 성공 |
| 11번가 | Seller ID, API Key | 승인상태, IP/업체, 권한, 만료 |
| ESM | Master ID, Secret, G마켓 Seller ID, 옥션 Seller ID | site별 권한, IP, API 그룹, 승인상태 |

스토어명은 사용자가 붙이는 표시명이고 외부 seller/channel ID를 대체하지 않는다.

## 8. 공통 adapter 계약

각 adapter는 최소 다음 함수를 제공한다.

- verifyCredentials
- getCapabilities
- pullOrderChanges
- getOrderDetails
- pullClaimChanges
- acceptOrderItems
- submitShipment
- updateShipment
- cancelOrderItems
- executeClaimAction
- reconcileCommand

각 결과는 다음을 포함한다.

- success item 목록
- failure item 목록과 원본 오류코드
- retryable 여부
- provider request ID
- 최신 provider 상태
- raw snapshot 참조
- 다음 cursor

adapter가 기능을 지원하지 않으면 빈 성공을 반환하지 않고 명시적인 UNSUPPORTED 결과를 반환한다.

## 9. 오류 정책

| 오류 | 처리 |
|---|---|
| 401/인증 실패 | 토큰 갱신 가능 시 1회, 이후 재인증 필요 |
| 403/권한·IP | 자동 재시도 중단, 계정 확인 필요 |
| 404/대상 없음 | 최신 상태 재조회 후 삭제·완료·잘못된 ID 분류 |
| 409/상태 충돌 | 최신 주문·클레임 조회 후 사용자 액션 재계산 |
| 429 | Retry-After 또는 지수 backoff+jitter |
| 5xx | 제한 횟수 자동 재시도 후 장애 작업함 |
| timeout | UNKNOWN, 상태조회 대사 전 동일 쓰기 재호출 금지 |
| 부분 성공 | 성공 item만 반영, 실패 item별 재시도 |

## 10. 출시 전 실계정 UAT

마켓마다 다음을 반복한다.

1. 신규 주문과 변경분 재수집
2. 주문확인 전 주소 변경
3. 복수 품목·합배송·분리배송
4. 개별·일괄 주문확인
5. 일반 송장 등록과 가능한 경우 정정
6. 직접전달 또는 미지원 대체
7. 주문확인 전·후 구매자 취소
8. 판매자 취소
9. 반품 승인·거부·보류·회수·입고·환불
10. 교환 승인·거부·회수·재배송
11. 클레임 철회
12. 호출 제한과 재시도
13. 키 만료·교체
14. 부분 성공과 timeout 대사

공식 공개문서에서 확인되지 않은 11번가 직접전달·호출 제한, ESM 주문 직접전달 필드, 스마트스토어·11번가 통관부호 필드는 출시 전 별도 확인표에서 해소한다.
