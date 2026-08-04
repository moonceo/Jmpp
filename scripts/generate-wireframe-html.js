/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const outDir = path.join(process.cwd(), "docs", "09_와이어프레임", "html-export");
const baseUrl = "http://localhost:3000";

const screens = [
  {
    file: "00_전체화면_인덱스.html",
    title: "전체 화면 인덱스",
    route: null,
    note: "현재 앱 화면을 기준으로 연결한 개별 HTML 목록입니다.",
  },
  {
    file: "01_주문관리_전체.html",
    title: "주문관리 - 전체",
    route: "/orders?view=all",
    note: "주문관리 전체 탭 현재 화면",
  },
  {
    file: "02_주문관리_신규주문.html",
    title: "주문관리 - 신규주문",
    route: "/orders?view=new",
    note: "신규주문 탭 현재 화면",
  },
  {
    file: "03_주문관리_상품준비.html",
    title: "주문관리 - 상품준비",
    route: "/orders?view=preparing",
    note: "상품준비 탭 현재 화면",
  },
  {
    file: "04_주문관리_발송대기.html",
    title: "주문관리 - 발송대기",
    route: "/orders?view=waiting",
    note: "발송대기 탭 현재 화면",
  },
  {
    file: "05_주문관리_배송중.html",
    title: "주문관리 - 배송중",
    route: "/orders?view=shipping",
    note: "배송중 탭 현재 화면",
  },
  {
    file: "06_주문관리_배송완료.html",
    title: "주문관리 - 배송완료",
    route: "/orders?view=delivered",
    note: "배송완료 탭 현재 화면",
  },
  {
    file: "07_취소반품교환.html",
    title: "취소/반품/교환",
    route: "/orders?view=claims",
    note: "클레임 처리 현재 화면",
  },
  {
    file: "08_문의관리.html",
    title: "문의관리",
    route: "/inquiries",
    note: "문의관리 현재 화면",
  },
  {
    file: "09_마켓연동.html",
    title: "마켓연동",
    route: "/me/markets",
    note: "마켓연동 현재 화면",
  },
  {
    file: "10_소싱하기_모달.html",
    title: "소싱하기 모달 확인",
    route: "/orders?view=new",
    note: "현재 주문관리 화면에서 소싱하기 버튼을 눌러 실제 모달을 확인합니다.",
  },
  {
    file: "11_수동구매완료_모달.html",
    title: "수동구매완료 모달 확인",
    route: "/orders?view=preparing",
    note: "현재 주문관리 화면에서 해당 주문 액션을 눌러 실제 모달을 확인합니다.",
  },
  {
    file: "12_배송정보수정_모달.html",
    title: "배송정보수정 모달 확인",
    route: "/orders?view=waiting",
    note: "현재 발송대기 화면에서 송장 관련 액션을 눌러 실제 모달을 확인합니다.",
  },
  {
    file: "13_주문취소확인_모달.html",
    title: "주문취소확인 모달 확인",
    route: "/orders?view=new",
    note: "현재 신규주문 화면에서 취소 액션을 눌러 실제 모달을 확인합니다.",
  },
  {
    file: "14_마켓추가수정_모달.html",
    title: "마켓추가/수정 모달 확인",
    route: "/me/markets",
    note: "현재 마켓연동 화면에서 마켓 추가 또는 수정 버튼을 눌러 실제 모달을 확인합니다.",
  },
  {
    file: "15_마켓삭제확인_모달.html",
    title: "마켓삭제확인 모달 확인",
    route: "/me/markets",
    note: "현재 마켓연동 화면에서 삭제 액션을 눌러 실제 확인 모달을 확인합니다.",
  },
  {
    file: "16_클레임처리_모달.html",
    title: "클레임처리 모달 확인",
    route: "/orders?view=claims",
    note: "현재 클레임 화면에서 처리 버튼을 눌러 실제 모달을 확인합니다.",
  },
  {
    file: "17_이미지크게보기_모달.html",
    title: "이미지 크게보기 모달 확인",
    route: "/orders?view=new",
    note: "현재 주문관리 화면에서 상품 이미지를 눌러 실제 이미지 확대 화면을 확인합니다.",
  },
  {
    file: "18_직접기간선택_팝오버.html",
    title: "직접기간선택 팝오버 확인",
    route: "/orders?view=new",
    note: "현재 주문관리 화면에서 기간 필터를 열어 실제 팝오버를 확인합니다.",
  },
  {
    file: "19_마켓스토어필터_팝오버.html",
    title: "마켓/스토어 필터 팝오버 확인",
    route: "/orders?view=new",
    note: "현재 주문관리 화면에서 마켓/스토어 필터를 열어 실제 팝오버를 확인합니다.",
  },
  {
    file: "20_로그인.html",
    title: "로그인",
    route: "/login",
    note: "운영 환경 로그인 화면입니다. 로컬 개발 인증 우회 상태에서는 주문관리 화면 확인에 로그인 입력이 필요 없습니다.",
  },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function appUrl(route) {
  return `${baseUrl}${route}`;
}

function html(screen) {
  const body = screen.route ? frameBody(screen) : indexBody();
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(screen.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 76px;
      padding: 14px 18px;
      border-bottom: 1px solid #e2e8f0;
      background: white;
    }
    h1 { margin: 0; font-size: 18px; letter-spacing: -0.02em; }
    p { margin: 5px 0 0; color: #64748b; font-size: 13px; }
    a, button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 36px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 0 12px;
      color: #0f172a;
      text-decoration: none;
      background: white;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }
    a.primary { background: #111827; color: white; border-color: #111827; }
    .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    iframe {
      width: 100%;
      height: calc(100vh - 76px);
      border: 0;
      background: white;
    }
    main { padding: 24px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }
    .card {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: white;
      text-decoration: none;
    }
    .card strong { display: block; font-size: 15px; }
    .card span { color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

function frameBody(screen) {
  const url = appUrl(screen.route);
  return `<header>
    <div>
      <h1>${escapeHtml(screen.title)}</h1>
      <p>${escapeHtml(screen.note)}</p>
    </div>
    <div class="actions">
      <a href="00_전체화면_인덱스.html">전체 화면</a>
      <a class="primary" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">현재 앱에서 열기</a>
    </div>
  </header>
  <iframe src="${escapeHtml(url)}"></iframe>`;
}

function indexBody() {
  return `<header>
    <div>
      <h1>전체 화면 인덱스</h1>
      <p>각 HTML은 현재 개발 서버의 실제 앱 화면을 iframe으로 표시합니다. 서버 실행 후 확인하세요.</p>
    </div>
    <div class="actions">
      <a class="primary" href="${baseUrl}/orders" target="_blank" rel="noreferrer">현재 앱 열기</a>
    </div>
  </header>
  <main>
    <div class="grid">
      ${screens
        .filter((screen) => screen.route)
        .map((screen, index) => `<a class="card" href="${escapeHtml(screen.file)}"><strong>${escapeHtml(screen.title)}</strong><span>${String(index + 1).padStart(2, "0")}</span></a>`)
        .join("\n      ")}
    </div>
  </main>`;
}

fs.mkdirSync(outDir, { recursive: true });
for (const screen of screens) {
  fs.writeFileSync(path.join(outDir, screen.file), html(screen), "utf8");
}

console.log(`Generated ${screens.length} current-screen viewer HTML files in ${outDir}`);
