---
버전: v1.0
최종수정일: 2026-07-10
상태: [Draft - 공개범위 및 실계정 검증 필요]
---

# 11번가 Open API 연동 기준

## 1. 범위

11번가 Seller API의 계정 연결, 주문수집, 발주확인, 배송, 취소·반품·교환을 대상으로 한다.

## 2. 계정 연결

필수 입력:

- Seller ID
- 11ST Open API Key
- 사용자 표시용 스토어명

Open API Center에서 다음을 완료해야 한다.

- 판매자 회원 로그인
- 서비스/API 사용 등록
- 약관 동의
- IP 직접입력 또는 승인된 셀링툴 업체 선택
- API Key 발급과 승인상태 확인

연결 테스트는 입력값 존재 여부가 아니라 주문 읽기 API 성공과 판매자 식별 일치를 기준으로 한다.

## 3. 키 수명

2026-06-30부터 Seller API Key의 유효기간이 180일로 적용된다는 공개 안내를 기준으로 설계한다.

- 만료 60일 전부터 갱신 가능 여부를 계정 화면에 표시한다.
- 마지막 호출로 유효기간이 연장되는 정책은 실계정 공지에서 재확인한다.
- 만료일, 마지막 성공 호출일, 갱신 가능일을 별도로 저장한다.
- 만료 계정은 자동 수집과 쓰기 명령을 중단하고 재인증 필요로 표시한다.

## 4. 주문수집

공개 소개에서 주문 목록·상세와 발주·배송 범주를 확인했다. 다음 항목은 로그인 개발가이드에서 endpoint별로 확정한다.

- 주문·상품주문 식별자
- 조회 기간과 페이지 크기
- 결제·발주·배송 상태 enum
- 수취정보와 개인통관고유부호
- 외부 수정시각과 cursor 지원 여부
- 부분 성공 응답

cursor가 없으면 조회 구간 overlap과 외부 ID 멱등 upsert를 사용한다. 날짜 범위 전체 성공 후 watermark를 전진한다.

## 5. 발주·배송

- 발주확인은 상품주문 단위로 명령을 만든다.
- 배송은 택배사·송장 필수값을 endpoint별 schema로 변환한다.
- 송장 정정 가능 상태와 API를 실계정에서 확인한다.
- 직접전달은 공개문서에서 확인하지 못했으므로 UNSUPPORTED를 기본값으로 둔다.
- 판매자센터에서 수동 처리한 건은 단건 재동기화로 내부 상태를 맞춘다.

## 6. 취소·반품·교환

공개 클레임 소개에서 조회·처리 범주를 확인했으나 다음은 로그인 문서와 UAT로 확정한다.

- 구매자 취소 요청과 판매자 취소 구분
- 승인·거부·철회 액션
- 부분 수량
- 반품 회수·입고·환불 단계
- 교환 회수·재배송 단계
- 처리기한과 자동 완료 정책
- 사유코드와 귀책

확정 전 공통 UI는 capability를 MANUAL_FALLBACK으로 제공하고 성공을 가정하지 않는다.

## 7. 오류·재시도

- 인증 실패: 키·IP·승인상태 확인
- 권한 실패: 셀링툴 업체·서비스 등록 확인
- 호출 제한: 공식 수치 확인 전 보수적인 계정별 제한기 사용
- 상태 충돌: 최신 주문·클레임 재조회
- timeout: UNKNOWN과 판매자센터 대사
- XML/응답 schema 변경: 원문 snapshot과 adapter version으로 격리

## 8. P0 확인 목록

1. 정확한 주문·클레임 endpoint
2. API Key 180일과 자동 연장 정책
3. 호출 제한
4. 직접전달
5. 개인통관고유부호
6. 부분 성공
7. 송장 정정
8. 클레임별 처리 가능 상태와 사유코드
9. 테스트 주문 생성·취소 절차

## 9. 필수 UAT

- 최초·증분 주문수집
- 주문확인 전 주소 변경
- 주문확인과 부분 실패
- 일반 송장과 가능한 경우 정정
- 직접전달 capability 미지원 처리
- 판매자 취소와 구매자 취소
- 반품 승인·거부·회수·환불
- 교환 승인·거부·회수·재배송
- 키 만료·갱신
- IP 미허용과 호출 제한

## 10. 공식 문서

- https://openapi.11st.co.kr/openapi/OpenApiFrontMain.tmall
- https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=ORDER
- https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=CLAIM
- https://openapi.11st.co.kr/openapi/OpenApiFaqBoard.tmall?method=getFaqBoardList&unityBrdNo=55

