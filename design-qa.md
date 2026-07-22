# Design QA — 배대지 선택 모달

- source screenshot: `F:/dev4/주문수집소싱라이프/output/design-qa/forwarder-modal-reference.png`
- implementation screenshot: `F:/dev4/주문수집소싱라이프/output/design-qa/forwarder-modal-implemented.png`
- comparison image: `F:/dev4/주문수집소싱라이프/output/design-qa/forwarder-modal-comparison.png`
- viewport/state: 주문관리 > 상품준비 > `COUPANG-NEW-0026` > 소싱하기 > 배대지 선택

## Comparison

- 상품 요약 표의 구조, 모달 헤더, 배대지 카드 스타일과 기존 주황색 주 액션은 기존 화면 패턴을 유지했다.
- 사용자 요청에 따라 마진 분석을 좌측 상품정보 바로 아래의 넓은 카드로 이동했다.
- 우측 요약 카드는 소싱 총비용과 구매대행 신청/취소 액션만 남겼다.
- 마진 분석의 결제금액, 쿠팡 판매 수수료, 상품가, 소싱처 이용료, 환전 수수료, 예상 운임, 예상 순이익, 마진율이 모두 보인다.
- 실제 주문 흐름으로 모달을 열었으며 레이아웃 겹침, 잘림, 콘솔 오류가 없다. 세로로 남은 배대지 카드는 모달 내부 스크롤로 접근 가능하다.

final result: passed

---

# Design QA — 주문 자세히 보기 처리하기 섹션

- source screenshot: `C:/Users/cool5/AppData/Local/Temp/codex-clipboard-d851f906-f577-4729-8e7e-3ed32deba23e.png`
- implementation screenshot: unavailable
- comparison image: unavailable
- target state: 주문관리 > 상품준비 또는 발송대기 > 주문 행 자세히 보기

## Intended comparison

- 하단 왼쪽에 `처리하기`, 오른쪽에 `소싱상품`을 1:2 비율로 배치한다.
- 상품준비 목록에서는 저빈도 `국내송장 등록`, `마켓 직접전달`을 숨기고 자세히 보기의 처리하기에서 제공한다.
- 발송대기 목록에는 `배송중 처리`만 남기고 자세히 보기에는 `배송중 처리`, `결제완료 보기`, `주문취소`를 제공한다.
- 직접전달 주문에는 `주문취소`를 표시하지 않는다.

## Blocker

- 로컬 앱은 실행 중이고 타입 검사, 기능 테스트, 프로덕션 빌드는 통과했다.
- 현재 데스크톱 브라우저 연결이 초기화되지 않아 구현 화면 캡처와 기준 이미지의 나란히 비교를 완료할 수 없었다.

final result: blocked
