---
버전: v1.0
최종수정일: 2026-07-10
상태: [Draft - 공식 공개문서 기반, 사업자 승인 필요]
---

# ESM Trading API 연동 기준

## 1. 범위

ESM PLUS를 통한 G마켓·옥션 계정 연결, 주문·배송, 취소·반품·교환을 대상으로 한다.

## 2. 출시 선행조건

ESM 연동은 일반 API Key 입력만으로 시작할 수 없다.

- G마켓·옥션 판매자 회원 가입
- ESM PLUS Master ID
- 셀링툴 업체 사업자 정보
- 서비스 URL과 소개자료
- 개발 API 범위와 개발기간
- 최근 매출·이용 판매자 규모
- ESM API 권한 승인
- 개발 완료 후 테스트와 운영 일정 협의

승인은 내부 지원 리소스와 안정성 판단에 따라 거절될 수 있다. 승인 신청·담당자·상태를 프로젝트 P0 의존성으로 관리한다.

## 3. 인증

- Master ID와 Secret Key를 사용한다.
- HS256 JWT를 요청 직전에 생성한다.
- audience와 subject는 공식 고정값을 사용한다.
- site seller 정보에 G마켓 G, 옥션 A 판매자 ID를 넣는다.
- 허용 IP에서만 호출한다.
- Secret은 Secret Manager에 보관한다.

G마켓과 옥션은 별도 market_account로 보존하되 같은 ESM Master secret_ref를 참조할 수 있다.

## 4. endpoint별 codec

siteType 숫자나 코드의 의미가 API마다 같다고 가정하지 않는다.

- 각 endpoint module이 요청·응답 enum을 독립적으로 변환한다.
- 전역 숫자 enum을 공유하지 않는다.
- 원문 snapshot에 adapter schema version을 기록한다.
- 알 수 없는 코드가 오면 UNKNOWN으로 보존하고 상태를 추정하지 않는다.

## 5. 주문수집

- 공식 허용 기간 안에서 날짜 범위를 나눠 페이지 처리한다.
- 주문 조회는 최대 31일 범위라는 공개 기준을 적용한다.
- 결제완료, 배송준비, 배송중, 배송완료, 구매확정을 원상태로 저장한다.
- 개인통관고유부호 InfoCin을 민감정보로 암호화한다.
- 취소·반품·교환은 주문 목록과 별도로 조회한다.
- 짧은 클레임 조회기간은 overlap 폴링과 야간 backfill로 보완한다.

공개 호출 제한:

- 주문·발송예정 조회는 판매자 ID 기준 5초당 1회
- account+endpoint별 limiter를 둔다.
- 수동 수집도 같은 limiter와 queue를 사용한다.

## 6. 발주·발송

- 발주확인 전 구매자 취소와 확인 후 승인 대상 흐름을 구분한다.
- 발주확인 성공 item만 내부 상품준비로 이동한다.
- 발송은 사이트별 주문번호, 택배사, 송장 필수값을 변환한다.
- 발송 응답을 site+order item 단위로 저장한다.
- 상품 설정의 직접배송 유형을 주문 발송 직접전달과 동일하다고 보지 않는다.
- 주문 직접전달 필드 조합을 실계정 검증하기 전 capability는 확인 필요다.

## 7. 취소

- 발주확인 전 즉시 취소될 수 있는 요청을 별도로 수집한다.
- 발주확인 후 판매자 승인 대상과 처리기한을 작업함에 표시한다.
- 공개 안내상 24시간 미처리 시 자동 취소될 수 있는 흐름은 SLA 경고를 둔다.
- 별도 거절 API 대신 발송 처리가 거절 효과를 내는 endpoint는 최신 상태와 실제 업무 의도를 검증한 뒤 실행한다.
- 마켓 취소와 소싱라이프 구매 중단·환불 결과를 분리한다.

## 8. 반품·교환

- G마켓과 옥션의 상태전이가 같다고 가정하지 않는다.
- 공통 Claim 상태와 site별 원상태를 함께 저장한다.
- 요청, 승인, 거부, 보류, 회수, 입고, 환불, 재배송 단계별 capability를 endpoint 기준으로 둔다.
- 반품 회수송장과 교환 재배송 송장은 별도 shipment로 저장한다.
- 최대 조회기간이 7일인 API는 누락 방지 overlap과 backfill을 적용한다.

## 9. 오류·재시도

- 401: JWT, Master ID, site seller ID, 권한 확인
- IP/권한 오류: 자동 재시도 중단, ESM 승인·허용 IP 확인
- 호출 제한: 5초 규칙 이상의 안전 간격과 jitter
- schema 오류: 원문 보존, endpoint codec 수정 후 replay
- timeout: UNKNOWN, 주문·클레임 재조회
- 부분 성공: G마켓/옥션과 주문별 결과 분리

## 10. 필수 UAT

- G마켓과 옥션 각각 주문수집
- 31일 백필과 증분 overlap
- 발주확인 전·후 취소
- 발주확인
- 일반 송장
- 직접전달 확인 또는 UNSUPPORTED 처리
- 반품 전체 단계
- 교환 전체 단계
- 구매확정 수집
- InfoCin 암호화·마스킹
- 5초 호출 제한
- 권한 없는 API와 IP 오류
- 두 site 부분 성공

## 11. 공식 문서

- https://etapi.gmarket.com/
- https://etapi.gmarket.com/pages/API-%EA%B0%80%EC%9D%B4%EB%93%9C
- https://etapi.gmarket.com/67
- https://etapi.gmarket.com/68
- https://etapi.gmarket.com/70
- https://etapi.gmarket.com/50
- https://etapi.gmarket.com/53
- https://etapi.gmarket.com/59
- https://etapi.gmarket.com/198
