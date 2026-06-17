import { Inquiry, InquiryStats } from "@/types/inquiry";
import { format, subDays, subHours } from "date-fns";

const now = new Date();

export const mockInquiryStats: InquiryStats = {
    unansweredCount: 4,
    answeredCount: 128,
    totalCount: 1532,
    connectedStores: 5,
};

export const mockInquiries: Inquiry[] = [
    {
        id: "inq_001",
        marketType: "naver",
        status: "waiting",
        type: "배송문의",
        content: "배송 언제 시작하나요? 주말 전에 받을 수 있는지 확인 부탁드립니다.",
        product: {
            name: "북유럽 인테리어 TV 거실장 2000",
            thumbnail: "/images/dummy/tv-stand.png",
            optionName: "화이트 / 2000mm",
            marketLink: "https://smartstore.naver.com",
        },
        writerId: "happy_day",
        writerName: "김*수",
        createdAt: format(subHours(now, 2), "yyyy-MM-dd HH:mm"),
    },
    {
        id: "inq_002",
        marketType: "coupang",
        status: "waiting",
        type: "상품문의",
        content: "이 제품은 별도 조립이 필요한가요? 설명서가 동봉되는지도 궁금합니다.",
        product: {
            name: "로봇청소기 X10 Plus 물걸레 겸용",
            thumbnail: "/images/dummy/robot-vacuum.png",
            marketLink: "https://coupang.com",
        },
        writerId: "user1234",
        createdAt: format(subHours(now, 5), "yyyy-MM-dd HH:mm"),
    },
    {
        id: "inq_003",
        marketType: "11st",
        status: "waiting",
        type: "교환/반품",
        content: "제품에 스크래치가 있어 교환하고 싶습니다. 사진 첨부했습니다. 확인해주세요.",
        product: {
            name: "원목 캣타워 대형 캣폴",
            thumbnail: "/images/dummy/cat-tower.png",
            optionName: "5단 / 스크래처 추가",
            marketLink: "https://11st.co.kr",
        },
        writerId: "cat_lover",
        createdAt: format(subDays(now, 1), "yyyy-MM-dd HH:mm"),
        isExternal: true,
        externalLink: "https://soffice.11st.co.kr/view/qna",
    },
    {
        id: "inq_004",
        marketType: "gmarket",
        status: "waiting",
        type: "기타",
        content: "대량 구매 가능한가요? 10개 정도 필요합니다. 할인 가능 여부 문의드립니다.",
        product: {
            name: "캠핑 접이식 경량 체어",
            thumbnail: "/images/dummy/camping-chair.png",
            marketLink: "https://gmarket.co.kr",
        },
        writerId: "camping_go",
        createdAt: format(subDays(now, 1), "yyyy-MM-dd HH:mm"),
        isExternal: true,
        externalLink: "https://www.gmarket.co.kr",
    },
    {
        id: "inq_005",
        marketType: "naver",
        status: "answered",
        type: "배송문의",
        content: "배송이 너무 늦는데요. 언제 오나요?",
        product: {
            name: "빈티지 글라스 무드 조명",
            thumbnail: "/images/dummy/vintage-lamp.png",
            marketLink: "https://smartstore.naver.com",
        },
        writerId: "waiting_person",
        createdAt: format(subDays(now, 2), "yyyy-MM-dd HH:mm"),
        replyContent: "안녕하세요 고객님. 주문하신 상품은 오늘 출고되었으며, 택배사 사정에 따라 1~2일 내 수령 가능할 것으로 예상됩니다.",
        repliedAt: format(subDays(now, 1), "yyyy-MM-dd HH:mm"),
    },
];
