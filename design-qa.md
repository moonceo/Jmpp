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

# Design QA — 장부 비용 관리 모달

- source visual truth: `C:/Users/cool5/AppData/Local/Temp/codex-clipboard-736bbf18-bd17-45fc-b89e-7e5d64e24c73.png`
- prior implementation reference: `C:/Users/cool5/AppData/Local/Temp/codex-clipboard-b7986873-b274-4bd4-9100-e3d630efdc74.png`
- implementation screenshot: `C:/Users/cool5/.codex/visualizations/2026/08/26/01a03bb1-8f81-7552-ab65-a16a7320e0a4/ledger-cost-management-modal.png`
- viewport: 1522 × 1272 CSS px, device scale factor 1
- source pixels: 495 × 854
- implementation pixels: 1522 × 1272; modal bounding box 492 × 911 CSS px
- density normalization: 별도 리사이즈 없이 같은 비교 입력에서 모달 영역의 폭, 구조와 밀도를 직접 비교했다. 앱 셸과 배경 표는 비교 대상에서 제외했다.
- state: `/ledger`, 첫 주문의 비용 관리 모달, 자동 구매금액 반영, 추가 비용 0원 상태

## Full-view comparison evidence

- 참고 화면의 `현재 정산·비용·마진 → 비용 입력 → 반영 후 마진 → 취소/저장` 흐름을 유지했다.
- 기존 선택형 직접 입력 UI를 고정형 비용 관리 UI로 바꾸고, 커머스라이프의 검정 요약 카드와 초록 마진 강조색을 적용했다.
- 모달은 492px 폭에서 전체 항목과 하단 작업 버튼이 잘리지 않고 보이며, 작은 화면에서는 내부 세로 스크롤로 접근할 수 있다.

## Focused comparison evidence

- 정산 요약 카드, 네 비용 입력 행, 실시간 예상 마진 카드와 하단 버튼을 확대 비교했다.
- 참고 화면보다 도움말이 추가되어 세로 길이는 약 57px 길지만 자동값과 직접 입력 가능 여부를 구분하기 위한 의도된 제품 차이다.

## Required fidelity surfaces

- Fonts and typography: 기존 제품의 한글 글꼴과 굵기 체계를 유지하고 제목, 금액, 보조 문구 계층을 참고 화면과 동일하게 분리했다.
- Spacing and layout rhythm: 24px 모달 여백, 4개 입력 행, 카드 사이 20px 간격과 고정 하단 작업 영역을 사용해 조밀하지만 읽기 쉬운 흐름을 유지했다.
- Colors and visual tokens: 리펀디의 회색·적색 복제 대신 제품의 검정 요약 카드와 emerald 양수 마진, rose 음수 마진 토큰을 사용했다.
- Image quality and asset fidelity: 모달에 별도 이미지 자산이 없으며 기존 Lucide 트리거 아이콘만 사용한다.
- Copy and content: 구매금액(원화), 국제배송비, 화물택배비, 관부가세와 장부·예상 마진 반영 문구만 사용했다.

## Comparison history

- 1차: 숫자 입력의 브라우저 증감 화살표와 `원` 단위가 겹치는 P2 문제를 확인했다.
- 수정: 입력을 숫자 키패드를 유지하는 숫자 전용 텍스트 입력으로 바꾸고 비숫자 문자를 제거하도록 처리했다.
- 2차: 동일 상태 재캡처에서 겹침이 해소되었고 추가 P0/P1/P2 차이는 확인되지 않았다.

## Interaction and console verification

- 모달 열기, 국제배송비 1,000원 입력, 예상 마진 46,000원 → 45,000원 및 마진율 35.7% → 34.9% 실시간 변경을 확인했다.
- 취소 시 입력을 저장하지 않고 닫히며, 다시 열어 저장하면 성공 안내 후 모달이 닫히는 것을 확인했다.
- 브라우저 콘솔 error/warn: 없음.

## Findings

- P0/P1/P2 없음.
- P3: 자동 반영 구매금액 입력에는 원 단위 정수 원본값을 그대로 보여주며 천 단위 구분 표시는 요약 카드에서 제공한다.

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

---

# Design QA — 장부 다운로드

- source visual truth: `C:/Users/cool5/AppData/Local/Temp/codex-clipboard-f42701b2-6eeb-434e-8348-93501296a5da.png`
- implementation screenshot: `F:/dev4/주문수집소싱라이프/.codex-artifacts/ledger-implementation.png`
- comparison image: `F:/dev4/주문수집소싱라이프/.codex-artifacts/ledger-comparison.png`
- viewport: 2327 × 508 CSS px, device scale factor 1
- source pixels: 2327 × 508
- implementation pixels: 2327 × 508
- density normalization: 없음; 같은 픽셀 크기와 같은 기간 조회 상태로 비교
- state: `/ledger`, 기간 조회, 전체 마켓, 마진 확정만 ON, 취소/반품 제거 ON

## Full-view comparison evidence

- 원본의 안내 접이식 영역, 민트색 자동 갱신 안내, 조회 방식 탭, 기간·빠른 조회, 우측 조회 버튼, 마켓·다운로드, 우측 필터, 4개 요약 카드의 순서와 밀도를 유지했다.
- 기존 앱의 공통 사이드바와 상단 헤더는 제품 구조상 유지했다. 콘텐츠 영역 내부 비율과 정렬은 원본과 동일한 좌우 흐름으로 맞췄다.
- 사용자 요청에 따라 `직접 입력 비용 반영` 필터와 관련 요약 문구는 제거했다.

## Focused comparison evidence

- 상단 조회 패널의 입력·버튼·스위치가 동일 viewport에서 모두 읽히므로 별도 확대 비교는 필요하지 않았다.
- 마켓 선택값, 날짜 아이콘, 스위치 상태색을 1차 비교에서 집중 확인했다.

## Required fidelity surfaces

- Fonts and typography: 기존 서비스의 Geist/한글 fallback 체계를 유지하면서 원본의 작은 굵은 UI 텍스트 계층을 맞췄다.
- Spacing and layout rhythm: 원본의 3단 구조와 4열 카드 비율을 유지했고 겹침이나 가로 잘림이 없다.
- Colors and visual tokens: 주 액션·안내·확정값에만 emerald 계열을 사용하고 나머지는 기존 중립 토큰을 유지했다.
- Image quality and asset fidelity: 화면에 별도 이미지 자산은 없으며 아이콘은 기존 Lucide 구성요소를 사용했다.
- Copy and content: 원본 구성 문구를 유지하되 직접 입력 비용 관련 문구만 요청대로 제거했다.

## Comparison history

- 1차: 마켓 선택값이 비어 보이고 날짜 입력에 달력 아이콘이 중복되며 스위치가 검정색으로 표시되는 P2 차이를 확인했다.
- 수정: 선택값을 명시적으로 렌더링하고 추가 달력 아이콘을 제거했으며 활성 스위치를 emerald로 맞췄다.
- 2차: 동일 viewport 재캡처에서 세 항목이 해결되었고 추가 P0/P1/P2 차이는 확인되지 않았다.

## Interaction and console verification

- 마진 확정 필터 OFF → 조회 후 주문 수가 39건에서 56건으로 갱신되는 것을 확인했다.
- 다운로드 API가 실제 `.xlsx`와 기간 기반 파일명을 반환하는 것을 확인했다.
- 브라우저 콘솔 error/warn: 없음.

## Findings

- P0/P1/P2 없음.
- P3: 원본은 콘텐츠만 캡처되었고 구현은 기존 앱 셸을 포함하지만, 이는 제품 내 일관성을 위한 의도된 차이다.

final result: passed
