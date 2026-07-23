/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const outDir = path.join(process.cwd(), "docs", "09_와이어프레임", "html-export");

const orderRows = [
  ["스마트스토어", "smartstore", "리빙온마켓", "20260723-10021", "무선 물걸레 로봇청소기 X10 Plus", "소싱대기", "79,000원", "소싱하기"],
  ["쿠팡", "coupang", "쿠팡라이프샵", "CP-260723-8842", "접이식 캠핑 수납박스 56L", "상품준비", "42,900원", "주문확인"],
  ["11번가", "eleven", "글로벌픽스토어", "11ST-723-1207", "LED 무드등 알람시계", "발송대기", "31,500원", "송장등록"],
  ["G마켓", "gmarket", "지마켓리빙박스", "GMK-723-4412", "프리미엄 주방 정리 랙", "배송중", "26,800원", "상세보기"],
  ["옥션", "auction", "옥션리빙셀렉트", "AUC-723-7201", "USB 충전식 휴대 선풍기", "배송완료", "18,900원", "상세보기"],
];

const screens = [
  {
    file: "00_전체화면_인덱스.html",
    title: "전체 화면 인덱스",
    subtitle: "소싱라이프 주문관리 화면별 HTML 목록",
    body: indexBody,
  },
  {
    file: "01_주문관리_전체.html",
    title: "주문관리 - 전체",
    subtitle: "마켓 주문을 한 화면에서 검색하고 상태별로 처리합니다.",
    body: () => orderScreen("전체", "전체 주문", orderRows),
  },
  {
    file: "02_주문관리_신규주문.html",
    title: "주문관리 - 신규주문",
    subtitle: "신규 수집 주문을 확인하고 소싱하기 또는 주문확인을 진행합니다.",
    body: () => orderScreen("신규주문", "소싱 또는 주문확인이 필요한 주문", orderRows.slice(0, 3)),
  },
  {
    file: "03_주문관리_상품준비.html",
    title: "주문관리 - 상품준비",
    subtitle: "구매 및 상품 준비 상태를 확인하고 국내 송장 전 단계까지 관리합니다.",
    body: () => orderScreen("상품준비", "구매 진행 및 입고 전 주문", [orderRows[1], orderRows[0], orderRows[2]]),
  },
  {
    file: "04_주문관리_발송대기.html",
    title: "주문관리 - 발송대기",
    subtitle: "등록된 국내 송장을 확인하고 배송중 처리를 진행합니다.",
    body: () => orderScreen("발송대기", "송장 등록 또는 배송중 처리 대상", [orderRows[2], orderRows[1]]),
  },
  {
    file: "05_주문관리_배송중.html",
    title: "주문관리 - 배송중",
    subtitle: "마켓 배송중 처리 완료 주문과 송장 정보를 확인합니다.",
    body: () => orderScreen("배송중", "배송 흐름 추적", [orderRows[3], orderRows[2]]),
  },
  {
    file: "06_주문관리_배송완료.html",
    title: "주문관리 - 배송완료",
    subtitle: "배송완료 주문과 사후 처리 이력을 확인합니다.",
    body: () => orderScreen("배송완료", "완료 주문 조회", [orderRows[4], orderRows[3]]),
  },
  {
    file: "07_취소반품교환.html",
    title: "취소/반품/교환",
    subtitle: "마켓 클레임을 유형별로 확인하고 필요한 판매자 액션을 처리합니다.",
    body: claimsScreen,
  },
  {
    file: "08_문의관리.html",
    title: "문의관리",
    subtitle: "여러 마켓의 고객 문의를 한 곳에서 확인하고 답변합니다.",
    body: inquiriesScreen,
  },
  {
    file: "09_마켓연동.html",
    title: "마켓연동",
    subtitle: "스마트스토어, 쿠팡, 11번가, G마켓, 옥션 계정을 연결하고 수집 상태를 관리합니다.",
    body: marketsScreen,
  },
  {
    file: "10_소싱하기_모달.html",
    title: "소싱하기 모달",
    subtitle: "주문 상품과 소싱라이프 상품을 매칭하고 구매 결제 연동을 시작합니다.",
    body: sourcingModal,
  },
  {
    file: "11_수동구매완료_모달.html",
    title: "수동구매완료 모달",
    subtitle: "소싱라이프 결제 완료 후 구매번호와 금액 정보를 수동으로 기록합니다.",
    body: manualPurchaseModal,
  },
  {
    file: "12_배송정보수정_모달.html",
    title: "배송정보수정 모달",
    subtitle: "국내 송장 정보를 수정하고 마켓 배송중 처리 전 오류를 바로잡습니다.",
    body: invoiceModal,
  },
  {
    file: "13_주문취소확인_모달.html",
    title: "주문취소확인 모달",
    subtitle: "소싱 전 주문 취소 또는 판매자 취소 요청을 확인합니다.",
    body: cancelModal,
  },
  {
    file: "14_마켓추가수정_모달.html",
    title: "마켓추가/수정 모달",
    subtitle: "마켓별 API 인증 정보를 등록하거나 갱신합니다.",
    body: marketEditModal,
  },
  {
    file: "15_마켓삭제확인_모달.html",
    title: "마켓삭제확인 모달",
    subtitle: "마켓 계정 연결 해제 전 영향 범위를 확인합니다.",
    body: marketDeleteModal,
  },
  {
    file: "16_클레임처리_모달.html",
    title: "클레임처리 모달",
    subtitle: "취소, 반품, 교환별 처리 상태와 판매자 응답을 입력합니다.",
    body: claimModal,
  },
  {
    file: "17_이미지크게보기_모달.html",
    title: "이미지 크게보기 모달",
    subtitle: "주문 상품 이미지와 소싱 후보 이미지를 크게 비교합니다.",
    body: imagePreviewModal,
  },
  {
    file: "18_직접기간선택_팝오버.html",
    title: "직접기간선택 팝오버",
    subtitle: "주문 수집 조회 기간을 직접 입력합니다.",
    body: datePopover,
  },
  {
    file: "19_마켓스토어필터_팝오버.html",
    title: "마켓/스토어 필터 팝오버",
    subtitle: "마켓과 스토어를 조합해 주문 목록을 좁힙니다.",
    body: marketFilterPopover,
  },
  {
    file: "20_로그인.html",
    title: "업무 공간 로그인",
    subtitle: "운영 환경에서 워크스페이스 계정으로 접근합니다. 로컬 화면 검수에서는 우회됩니다.",
    body: loginScreen,
  },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function layout(screen) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(screen.title)}</title>
  <style>${css()}</style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand">소싱라이프</div>
      <div class="switch"><span class="active">타오바오</span><span>1688</span></div>
      <nav>
        <a class="nav-item disabled">아이템 검색</a>
        <a class="nav-item current" href="01_주문관리_전체.html">주문관리</a>
        <a class="nav-sub" href="02_주문관리_신규주문.html">주문수집</a>
        <a class="nav-sub" href="07_취소반품교환.html">취소/반품/교환</a>
        <a class="nav-sub" href="08_문의관리.html">문의관리</a>
        <a class="nav-sub" href="09_마켓연동.html">마켓연동</a>
        <a class="nav-item disabled">찜 리스트</a>
        <a class="nav-item disabled">장바구니</a>
        <a class="nav-item disabled">주문 내역</a>
        <a class="nav-item disabled">배송 조회</a>
      </nav>
    </aside>
    <main class="main">
      <header class="topbar">
        <div>
          <h1>${escapeHtml(screen.title)}</h1>
          <p>${escapeHtml(screen.subtitle)}</p>
        </div>
        <a class="index-link" href="00_전체화면_인덱스.html">전체 화면</a>
      </header>
      ${screen.body()}
    </main>
  </div>
</body>
</html>`;
}

function css() {
  return `
*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#111827;font-family:Arial,"Noto Sans KR","Apple SD Gothic Neo",sans-serif}.app{display:grid;grid-template-columns:244px minmax(0,1fr);min-height:100vh}.sidebar{background:#fff;border-right:1px solid #e5e7eb;padding:18px 12px}.brand{font-size:24px;font-weight:900;letter-spacing:-.03em;margin:2px 8px 16px}.switch{display:grid;grid-template-columns:1fr 1fr;gap:4px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:4px;margin-bottom:18px}.switch span{height:36px;display:grid;place-items:center;border-radius:6px;font-weight:800;color:#64748b}.switch .active{background:#ff321c;color:#fff}.nav-item,.nav-sub{display:flex;align-items:center;height:42px;border-radius:7px;padding:0 12px;margin:3px 0;text-decoration:none;color:#1f2937;font-weight:800}.nav-item.current{background:#fff1f0;color:#ff321c}.nav-sub{height:32px;margin-left:24px;border-left:1px solid #e5e7eb;border-radius:0;padding-left:14px;color:#64748b;font-size:13px}.disabled{opacity:.55}.main{padding:28px;min-width:0}.topbar{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:20px}.topbar h1{margin:0;font-size:28px;letter-spacing:-.03em}.topbar p{margin:7px 0 0;color:#64748b}.index-link,.button{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 13px;border:1px solid #d1d5db;border-radius:7px;background:#fff;color:#111827;text-decoration:none;font-size:13px;font-weight:800}.button.primary{background:#111827;color:#fff;border-color:#111827}.button.red{background:#ff321c;color:#fff;border-color:#ff321c}.toolbar,.panel,.modal,.popover{background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 1px 2px rgba(15,23,42,.04)}.toolbar{display:flex;justify-content:space-between;gap:12px;padding:14px;margin-bottom:14px}.tabs{display:flex;gap:6px;flex-wrap:wrap}.tab{height:34px;padding:0 12px;border-radius:999px;border:1px solid #e5e7eb;background:#fff;color:#475569;font-weight:800;font-size:13px}.tab.active{background:#111827;color:#fff;border-color:#111827}.search{height:36px;min-width:260px;border:1px solid #d1d5db;border-radius:7px;padding:0 12px;color:#64748b;background:#fff}.table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden}.table th,.table td{padding:13px 14px;border-bottom:1px solid #edf0f3;text-align:left;font-size:13px;vertical-align:middle}.table th{background:#f8fafc;color:#64748b;font-weight:900}.table tr:last-child td{border-bottom:0}.badge{display:inline-flex;align-items:center;height:24px;padding:0 8px;border-radius:999px;color:#fff;font-size:12px;font-weight:900}.smartstore{background:#03c75a}.coupang{background:#1f4e9d}.eleven{background:#e60012}.gmarket{background:#00a7e1}.auction{background:#ef3e2e}.status{display:inline-flex;height:24px;align-items:center;border-radius:999px;padding:0 8px;background:#eef2ff;color:#3730a3;font-size:12px;font-weight:800}.grid{display:grid;gap:14px}.grid.cols3{grid-template-columns:repeat(3,minmax(0,1fr))}.grid.cols4{grid-template-columns:repeat(4,minmax(0,1fr))}.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px}.card h3{margin:0 0 8px;font-size:15px}.card .big{font-size:26px;font-weight:900}.muted{color:#64748b}.modal-wrap{min-height:calc(100vh - 150px);display:grid;place-items:center;background:linear-gradient(rgba(15,23,42,.58),rgba(15,23,42,.58));border-radius:10px;padding:28px}.modal{width:min(1120px,100%);overflow:hidden}.modal-head{padding:18px 22px;border-bottom:1px solid #e5e7eb}.modal-head h2{margin:0;font-size:21px}.modal-body{padding:20px}.split{display:grid;grid-template-columns:280px 1fr 280px;gap:16px}.thumb{width:72px;height:72px;border-radius:8px;background:linear-gradient(135deg,#e2e8f0,#cbd5e1)}.product-row{display:flex;gap:12px;padding:12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:10px}.product-row.active{border-color:#ff321c;background:#fff7f5}.field{display:grid;gap:6px;margin-bottom:12px}.field label{font-size:12px;color:#64748b;font-weight:900}.field input,.field select,.field textarea{width:100%;border:1px solid #d1d5db;border-radius:7px;padding:10px;background:#fff}.field textarea{min-height:96px}.popover-wrap{min-height:calc(100vh - 150px);display:grid;place-items:start center;padding-top:70px}.popover{width:360px;padding:16px}.calendar{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}.day{height:34px;display:grid;place-items:center;border-radius:7px;background:#f8fafc;font-size:12px}.day.active{background:#111827;color:#fff}.footer-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.link-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}.screen-link{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;text-decoration:none;color:#111827;font-weight:900}.screen-link span{color:#64748b;font-size:12px;font-weight:700}@media(max-width:900px){.app{grid-template-columns:1fr}.sidebar{position:static}.split,.grid.cols3,.grid.cols4{grid-template-columns:1fr}.toolbar,.topbar{flex-direction:column}.search{min-width:0;width:100%}}`;
}

function indexBody() {
  return `<section class="link-list">${screens
    .filter((screen) => screen.file !== "00_전체화면_인덱스.html")
    .map((screen, index) => `<a class="screen-link" href="${screen.file}">${escapeHtml(screen.title)}<span>${String(index + 1).padStart(2, "0")}</span></a>`)
    .join("")}</section>`;
}

function orderScreen(active, caption, rows) {
  const tabs = ["전체", "신규주문", "상품준비", "발송대기", "배송중", "배송완료"];
  return `<section class="toolbar">
    <div class="tabs">${tabs.map((tab) => `<button class="tab ${tab === active ? "active" : ""}">${tab}</button>`).join("")}</div>
    <div><input class="search" value="주문번호, 수취인, 상품명 검색" readonly /> <button class="button">필터</button></div>
  </section>
  <table class="table">
    <thead><tr><th>판매처</th><th>스토어</th><th>주문번호</th><th>상품</th><th>상태</th><th>결제금액</th><th>처리</th></tr></thead>
    <tbody>${rows.map(([market, cls, store, no, product, status, price, action]) => `<tr><td><span class="badge ${cls}">${market}</span></td><td>${store}</td><td>${no}</td><td>${product}</td><td><span class="status">${status}</span></td><td>${price}</td><td><button class="button red">${action}</button></td></tr>`).join("")}</tbody>
  </table>
  <p class="muted" style="margin-top:12px">${caption}. 소싱라이프에서 직접 생성된 주문은 주문수집 대상에 포함하지 않습니다.</p>`;
}

function claimsScreen() {
  return `<section class="grid cols3">
    <div class="card"><h3>취소 요청</h3><div class="big">8건</div><p class="muted">오늘 처리 필요 3건</p></div>
    <div class="card"><h3>반품 진행</h3><div class="big">5건</div><p class="muted">회수 송장 확인 2건</p></div>
    <div class="card"><h3>교환 요청</h3><div class="big">2건</div><p class="muted">재발송 대기 1건</p></div>
  </section>
  <table class="table" style="margin-top:14px"><thead><tr><th>판매처</th><th>클레임</th><th>주문번호</th><th>사유</th><th>마감</th><th>처리</th></tr></thead><tbody>
    <tr><td><span class="badge smartstore">스마트스토어</span></td><td>취소</td><td>20260723-10021</td><td>구매의사 취소</td><td>오늘 18:00</td><td><button class="button red">취소 승인</button></td></tr>
    <tr><td><span class="badge coupang">쿠팡</span></td><td>반품</td><td>CP-260723-8842</td><td>상품 불량</td><td>내일 12:00</td><td><button class="button">상세 처리</button></td></tr>
    <tr><td><span class="badge eleven">11번가</span></td><td>교환</td><td>11ST-723-1207</td><td>옵션 오배송</td><td>2일 남음</td><td><button class="button">교환 처리</button></td></tr>
  </tbody></table>`;
}

function inquiriesScreen() {
  return `<section class="grid cols4">
    <div class="card"><h3>미답변 문의</h3><div class="big">12건</div></div>
    <div class="card"><h3>답변 완료</h3><div class="big">48건</div></div>
    <div class="card"><h3>전체 문의</h3><div class="big">60건</div></div>
    <div class="card"><h3>연동 스토어</h3><div class="big">10개</div></div>
  </section>
  <section class="toolbar"><button class="button primary">문의 불러오기</button><input class="search" value="문의 내용, 주문번호 검색" readonly /></section>
  <div class="grid">
    ${["배송은 언제 시작되나요?", "옵션을 변경할 수 있나요?", "반품 접수 후 회수 일정이 궁금합니다."].map((q, i) => `<article class="card"><h3>${q}</h3><p class="muted">${i === 0 ? "스마트스토어" : i === 1 ? "쿠팡" : "G마켓"} · 주문번호 ${10020 + i}</p><p>고객 문의 내용과 주문 정보를 함께 확인한 뒤 답변을 작성합니다.</p><button class="button red">답변하기</button></article>`).join("")}
  </div>`;
}

function marketsScreen() {
  const markets = [
    ["스마트스토어", "smartstore", "연동 완료", "10분 전"],
    ["쿠팡", "coupang", "연동 완료", "15분 전"],
    ["11번가", "eleven", "재인증 필요", "1시간 전"],
    ["G마켓", "gmarket", "연동 완료", "20분 전"],
    ["옥션", "auction", "연동 완료", "25분 전"],
  ];
  return `<section class="toolbar"><button class="button red">마켓 추가</button><button class="button">전체 주문수집</button></section>
  <table class="table"><thead><tr><th>마켓</th><th>스토어명</th><th>계정</th><th>상태</th><th>마지막 수집</th><th>관리</th></tr></thead><tbody>
    ${markets.map(([name, cls, status, last], i) => `<tr><td><span class="badge ${cls}">${name}</span></td><td>${name} 리빙스토어 ${i + 1}</td><td>seller_${i + 1}</td><td><span class="status">${status}</span></td><td>${last}</td><td><button class="button">수정</button></td></tr>`).join("")}
  </tbody></table>`;
}

function sourcingModal() {
  return modal(`<div class="split">
    <aside class="card"><h3>현재 주문</h3><div class="thumb"></div><p><b>무선 물걸레 로봇청소기 X10 Plus</b></p><p class="muted">수량 1개 · 결제금액 79,000원</p><p>주문번호 20260723-10021</p></aside>
    <section><div class="field"><label>상품명 또는 URL 검색</label><input value="taobao.com/item/..." /></div>
      <div class="product-row active"><div class="thumb"></div><div><b>X10 Plus 물걸레 로봇청소기</b><p class="muted">소싱라이프 상품 후보 · 재고 58개</p><b>48,200원</b></div></div>
      <div class="product-row"><div class="thumb"></div><div><b>가정용 자동 물걸레 청소기</b><p class="muted">유사 상품 · 재고 24개</p><b>45,900원</b></div></div>
    </section>
    <aside class="card"><h3>결제 연동</h3><div class="field"><label>옵션</label><select><option>화이트 / 기본형</option></select></div><p>소싱라이프 결제 예정금액</p><div class="big">48,200원</div><button class="button red" style="width:100%">소싱라이프 결제</button></aside>
  </div>`);
}

function manualPurchaseModal() {
  return modal(`<div class="grid cols3"><div class="field"><label>소싱라이프 구매번호</label><input value="SL-260723-1020" /></div><div class="field"><label>구매금액</label><input value="48,200" /></div><div class="field"><label>구매일시</label><input value="2026-07-23 14:20" /></div></div><div class="field"><label>메모</label><textarea>소싱라이프에서 결제 완료. 물류 상세처리는 소싱라이프에서 진행.</textarea></div>`);
}

function invoiceModal() {
  return modal(`<div class="grid cols3"><div class="field"><label>택배사</label><select><option>CJ대한통운</option></select></div><div class="field"><label>송장번호</label><input value="584920174912" /></div><div class="field"><label>처리 상태</label><select><option>배송중 처리 대기</option></select></div></div><p class="muted">저장 후 자동 배송중 처리를 실행할 수 있습니다.</p>`);
}

function cancelModal() {
  return modal(`<div class="card"><h3>주문을 취소하시겠습니까?</h3><p>소싱 전 주문은 주문관리에서 취소 처리하고, 이미 소싱라이프 결제가 완료된 건은 소싱라이프 환불 흐름을 별도로 확인합니다.</p><div class="footer-actions"><button class="button">닫기</button><button class="button red">취소 확정</button></div></div>`);
}

function marketEditModal() {
  return modal(`<div class="grid cols3"><div class="field"><label>마켓</label><select><option>스마트스토어</option><option>쿠팡</option><option>11번가</option><option>G마켓</option><option>옥션</option></select></div><div class="field"><label>스토어명</label><input value="리빙온마켓" /></div><div class="field"><label>판매자 ID</label><input value="seller_living" /></div></div><div class="grid cols3"><div class="field"><label>Client ID</label><input /></div><div class="field"><label>Secret Key</label><input type="password" /></div><div class="field"><label>사업자번호</label><input /></div></div>`);
}

function marketDeleteModal() {
  return modal(`<div class="card"><h3>마켓 연결을 해제하시겠습니까?</h3><p>해제 후에는 해당 마켓의 신규 주문수집과 자동 배송중 처리가 중단됩니다. 기존 주문 이력은 유지됩니다.</p><div class="footer-actions"><button class="button">취소</button><button class="button red">연결 해제</button></div></div>`);
}

function claimModal() {
  return modal(`<div class="grid cols3"><div class="card"><h3>클레임 유형</h3><div class="big">반품</div></div><div class="card"><h3>귀책</h3><div class="big">판매자</div></div><div class="card"><h3>마감</h3><div class="big">D-1</div></div></div><div class="field"><label>처리 메모</label><textarea>불량 접수 확인. 회수 송장 확인 후 환불 승인 예정.</textarea></div>`);
}

function imagePreviewModal() {
  return modal(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px"><div class="card"><h3>주문 상품 이미지</h3><div style="height:360px;border-radius:8px;background:linear-gradient(135deg,#e2e8f0,#94a3b8)"></div></div><div class="card"><h3>소싱 후보 이미지</h3><div style="height:360px;border-radius:8px;background:linear-gradient(135deg,#fee2e2,#fecaca)"></div></div></div>`);
}

function datePopover() {
  return `<section class="popover-wrap"><div class="popover"><h3>직접 기간 선택</h3><div class="grid cols3"><div class="field"><label>시작일</label><input value="2026-07-01" /></div><div class="field"><label>종료일</label><input value="2026-07-23" /></div><div class="field"><label>빠른 선택</label><select><option>이번 달</option></select></div></div><div class="calendar">${Array.from({ length: 31 }, (_, i) => `<div class="day ${i > 14 && i < 23 ? "active" : ""}">${i + 1}</div>`).join("")}</div><div class="footer-actions"><button class="button red">적용</button></div></div></section>`;
}

function marketFilterPopover() {
  return `<section class="popover-wrap"><div class="popover"><h3>마켓/스토어 필터</h3>${["스마트스토어 리빙온마켓", "쿠팡라이프샵", "11번가 글로벌픽스토어", "G마켓 리빙박스", "옥션 리빙셀렉트"].map((label, i) => `<label style="display:flex;gap:10px;margin:10px 0"><input type="checkbox" ${i < 2 ? "checked" : ""}/> ${label}</label>`).join("")}<div class="footer-actions"><button class="button">초기화</button><button class="button red">적용</button></div></div></section>`;
}

function loginScreen() {
  return `<section class="modal-wrap"><div class="modal" style="width:min(760px,100%)"><div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:24px"><div><h2>업무 공간 로그인</h2><p class="muted">운영 환경 접근 화면입니다.</p></div><div><div class="field"><label>워크스페이스</label><input value="sourcinglife" /></div><div class="field"><label>이메일</label><input value="operator@example.com" /></div><div class="field"><label>비밀번호</label><input type="password" value="password" /></div><button class="button red" style="width:100%">로그인</button></div></div></div></section>`;
}

function modal(content) {
  return `<section class="modal-wrap"><div class="modal"><div class="modal-head"><h2>작업 화면</h2><p class="muted">개별 HTML 검수용 정적 모달입니다.</p></div><div class="modal-body">${content}<div class="footer-actions"><button class="button">닫기</button><button class="button red">저장</button></div></div></div></section>`;
}

fs.mkdirSync(outDir, { recursive: true });
for (const screen of screens) {
  fs.writeFileSync(path.join(outDir, screen.file), layout(screen), "utf8");
}

console.log(`Generated ${screens.length} HTML files in ${outDir}`);
