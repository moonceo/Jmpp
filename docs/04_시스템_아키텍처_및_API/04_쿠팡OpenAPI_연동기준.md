---
버전: v1.0
최종수정일: 2026-07-10
상태: [Draft - 공식 공개문서 기반]
---

# 쿠팡 Open API 연동 기준

## 1. 범위

쿠팡 판매자 계정 연결, 주문수집, 상품준비중 처리, 송장·DIRECT, 판매자 취소, 취소·반품·교환 수집과 처리를 대상으로 한다.

## 2. 자격증명과 연결

필수 입력:

- Vendor ID
- Access Key
- Secret Key
- 사용자 표시용 스토어명

서버는 HMAC 서명을 생성한다. Secret Key와 서명 재료를 브라우저에 전달하지 않는다.

연결 검증:

1. HMAC으로 읽기 API를 호출한다.
2. 요청 Vendor ID와 응답 판매자 범위가 일치하는지 확인한다.
3. 만료일과 마지막 검증시각을 저장한다.
4. 수집·발송·클레임 capability를 저장한다.
5. 테스트가 끝난 계정만 활성화한다.

운영 제약:

- 사업자 인증 WING 판매자만 키 발급 가능
- 판매자 ID별 Open API 키 1개
- 연동업체 또는 자체개발 중 하나만 선택
- 키 유효기간 180일
- 재발급한 순간 기존 키 사용 불가
- 별도 테스트 환경 없음
- 일부 API 초당 5회 제한

## 3. 주문수집

- 일 단위 페이징은 초기·백필 수집에 사용한다.
- 분 단위 조회는 증분 수집에 사용하되 API 허용 범위를 넘지 않는다.
- shipmentBoxId, orderId, vendorItemId, sellerProductId를 모두 보존한다.
- 상품주문 처리 단위와 합배송 상자인 shipmentBox를 분리한다.
- 상품준비중 처리 전까지 주소가 바뀔 수 있으므로 성공 후 단건 주문을 다시 조회한다.
- 취소·반품은 일반 주문 목록만 믿지 않고 반품/취소 API를 별도 조회한다.
- 교환도 별도 조회한다.

유일키 후보:

- 주문 헤더: market_account + orderId
- 배송그룹: market_account + shipmentBoxId
- 주문상품: shipmentBoxId + vendorItemId + vendorItemPackageId 또는 공식 line 식별값

실제 응답에서 안정적인 item ID를 확인해 최종 확정한다.

## 4. 상품준비중 처리

- 내부 주문확인은 쿠팡 상품준비중 처리 API에 대응한다.
- 액션 직전 최신 주문과 클레임 상태를 조회한다.
- 배치의 부분 성공을 item별로 저장한다.
- 성공 item만 PREPARING으로 이동한다.
- 이미 상품준비중이면 성공으로 대사하되 중복 이력을 만들지 않는다.

## 5. 송장과 DIRECT

일반 송장:

- shipmentBoxId와 주문 식별값, 택배사 코드, 송장을 공식 요청 구조에 맞춰 보낸다.
- 실제 국내 택배사 코드를 쿠팡 코드로 변환한다.
- 쿠팡 성공 응답 item만 마켓 발송 완료로 저장한다.
- 송장 정정은 별도 revision과 command로 처리한다.

DIRECT:

- deliveryCompanyCode는 DIRECT다.
- 숫자형 invoiceNumber가 필요하다.
- 배송추적을 지원하지 않는다.
- 분할배송에 제약이 있다.
- DIRECT 숫자와 실제 국내송장을 별도 저장한다.
- 일반적인 해외구매대행 직접전달로 사용할 수 있는지 운영 승인 후 capability를 활성화한다.

## 6. 취소·반품·교환

취소:

- 결제완료·상품준비중 등 공식 허용 상태에서 판매자 취소를 실행한다.
- 취소 요청 목록을 별도 수집한다.
- 발송과 취소가 경합하면 최신 상태를 조회하고 먼저 확정된 마켓 결과를 기준으로 다음 액션을 계산한다.

반품:

- 요청 목록·단건 조회
- 반품 접수 확인
- 반품 승인
- 판매자 회수송장 업로드
- 회수·입고·환불 상태 동기화

교환:

- 요청 목록
- 교환품 회수 확인
- 교환 거부
- 교환 재배송 송장

마켓 클레임과 소싱라이프 구매 환불은 별도 상태로 저장한다.

## 7. 재시도

- 401: 서명 시각, canonical path, 키·Vendor ID를 점검하고 자동 반복 금지
- 403: IP·보안 차단·권한 문제로 계정 확인 필요
- 429: endpoint+Vendor ID별 제한기와 backoff
- 5xx: 제한 횟수 재시도
- timeout: UNKNOWN으로 저장 후 단건 주문·클레임 상태 대사
- 응답 retryRequired가 있으면 provider 값을 우선한다.

## 8. 필수 UAT

- 일/분 주문수집과 페이징
- 주소 변경 후 상품준비중 처리
- 합배송·분리배송
- 일반 송장 등록·정정
- DIRECT와 숫자값 중복·추적 불가 표시
- 주문확인 전·후 취소
- 반품 접수·승인·회수송장
- 교환 회수·거부·재배송
- 부분 성공
- 초당 제한과 회복
- 키 만료·재발급 무중단 전환

## 9. 공식 문서

- https://developers.coupangcorp.com/hc/ko
- https://developers.coupangcorp.com/hc/ko/articles/20288952179993-OpenAPI-Key-%EB%B0%9C%EA%B8%89%EB%B0%9B%EA%B8%B0
- https://developers.coupangcorp.com/hc/ko/articles/360033461914-HMAC-Signature-%EC%83%9D%EC%84%B1
- https://developers.coupangcorp.com/hc/ko/sections/360005081913
- https://developers.coupangcorp.com/hc/ko/sections/360005081933
- https://developers.coupangcorp.com/hc/ko/sections/360005046554

## 10. 현재 구현 경계와 공식 계약 근거

2026-07-10 기준 `lib/server/integrations/coupang/`에 다음 읽기 전용 코어만 구현했다.

- 공식 HMAC 규칙: UTC `yyMMddTHHmmssZ`, `datetime + method + path + query` 서명 재료, HMAC-SHA256 hex, `CEA` Authorization 헤더
- 분 단위 발주서 목록: `GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets`
- 배송번호 단건 발주서: `GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets/{shipmentBoxId}`
- 18자리 `shipmentBoxId`를 반올림하지 않는 문자열 파싱
- 15초 기본 timeout, 4 MiB 응답 상한, redirect 거부, 401·403·429·5xx 분류
- 2026-03-17 공지 기준 Vendor ID당 기본 초당 5회 제한을 전제로 하되, 실제 제한값은 변동 가능하므로 429를 우선한다.

연결 확인은 최근 5분의 `ACCEPT` 발주서 목록을 1회 읽어 해당 Vendor ID 경로의 접근 권한만 확인한다. 응답에 판매자 프로필이 포함되지 않으므로 Vendor ID를 독립적으로 재확인했다고 표현하지 않는다.

아직 자격증명 저장·검증 worker, 주문 동기화 worker, 일 단위 paging, 주문 ID 조회, 상품준비중·송장·직접전달·클레임 쓰기는 구현하지 않았다. `IMPLEMENTED_MARKET_ADAPTERS`와 계정 생성 API 허용목록은 계속 NAVER 전용이며 이 클라이언트를 UI에 연결하지 않는다. Wing 실계정·고정 IP·키 만료/재발급·전 상태 주문·합배송/분리배송·429 회복 UAT 전에는 쿠팡을 활성화하지 않는다. 세부 근거와 미검증 항목은 `lib/server/integrations/coupang/README.md`를 따른다.

추가 공식 근거:

- https://developers.coupangcorp.com/hc/ko/articles/360042793752-Node-js-Examples
- https://developers.coupangcorp.com/hc/ko/articles/360033792774-%EB%B0%9C%EC%A3%BC%EC%84%9C-%EB%AA%A9%EB%A1%9D-%EC%A1%B0%ED%9A%8C-%EB%B6%84%EB%8B%A8%EC%9C%84-%EC%A0%84%EC%B2%B4
- https://developers.coupangcorp.com/hc/ko/articles/360033792854-%EB%B0%9C%EC%A3%BC%EC%84%9C-%EB%8B%A8%EA%B1%B4-%EC%A1%B0%ED%9A%8C-shipmentBoxId
- https://developers.coupangcorp.com/hc/en-us/articles/56090840760089-Optimization-and-Adjustment-of-Open-API-Rate-Limit-Effective-March-17th-2026
