# 쿠팡 Open API 기준 문서

## 공식 문서

- Open API 메인: https://developers.coupangcorp.com/hc/ko
- OpenAPI Key 발급받기: https://developers.coupangcorp.com/hc/ko/articles/20288952179993-OpenAPI-Key-%EB%B0%9C%EA%B8%89%EB%B0%9B%EA%B8%B0
- OpenAPI key 설명: https://developers.coupangcorp.com/hc/ko/articles/20405856965145-OpenAPI-key-%EB%9E%80-%EB%AC%B4%EC%97%87%EC%9D%B8%EA%B0%80%EC%9A%94
- 발주서 목록 조회: https://developers.coupangcorp.com/hc/ko/articles/360033919573-%EB%B0%9C%EC%A3%BC%EC%84%9C-%EB%AA%A9%EB%A1%9D-%EC%A1%B0%ED%9A%8C-%EC%9D%BC%EB%8B%A8%EC%9C%84-%ED%8E%98%EC%9D%B4%EC%A7%95
- 발주서 단건 조회: https://developers.coupangcorp.com/hc/ko/articles/360034320553-%EB%B0%9C%EC%A3%BC%EC%84%9C-%EB%8B%A8%EA%B1%B4-%EC%A1%B0%ED%9A%8C-orderId

## 확인 기준

- 확인일: 2026-06-10
- 실제 구현 전에는 반드시 공식 문서와 최신 공지사항을 다시 확인한다.

## 우선 검토 범위

주문 수집과 운영 자동화를 위해 우선 확인할 영역이다.

- API Key 발급
- 인증 서명 방식
- 발주서/주문 조회
  - 발주서 목록 조회
  - 발주서 단건 조회
- 배송/환불 API
- 반품 API
- 교환 API
- CS API
- 정산 API
- 호출 제한 정책

## 주문 연동 시 주의사항

- OpenAPI key는 Access key와 Secret key로 구성된다.
- Key 발급 후 실제 접근 권한 반영까지 시간이 걸릴 수 있다.
- 별도 테스트 환경 제공 여부를 구현 시점에 다시 확인한다.
- 발주서 목록 조회는 주문량이 많으면 타임아웃 가능성이 있으므로 페이징과 재시도 정책이 필요하다.
- 주문 생성 직후 목록 조회에 반영되기까지 지연이 있을 수 있으므로 단건 조회 보완을 검토한다.
- 배송지 정보는 고객 변경 가능성이 있으므로 상품준비중 처리 이후 최신 정보를 다시 확인한다.
- API 공지사항에 주문 응답 필드 변경, 개인정보 필드 변경, 호출 제한 정책 변경이 올라오므로 운영 전후로 정기 확인이 필요하다.

## 구현 전 체크리스트

- WING 판매자 계정과 vendorId 확인
- Access key / Secret key 발급 및 보관 방식
- 허용 IP 등록 필요 여부
- 인증 서명 생성 방식
- 호출 제한과 재시도 정책
- 주문 상태 코드와 내부 주문 상태 매핑
- 개인정보 저장 범위와 마스킹 정책
- 실패 요청 재처리 화면 또는 운영 로그

