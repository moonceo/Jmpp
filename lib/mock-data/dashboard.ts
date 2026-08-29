export interface DashboardMetrics {
  sales: number;
  expectedSettlement: number;
  costs: number;
  expectedMargin: number;
  cashback: number;
  orderCount: number;
}

export interface DailySales {
  date: string;
  sales: number;
}

export interface Announcement {
  id: string;
  badge: 'important' | 'general';
  title: string;
  date: string;
  content?: string;
}

export interface PendingTask {
  id: string;
  name: string;
  count: number;
  url: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  isRead: boolean;
}

export const mockMetrics: DashboardMetrics = {
  sales: 45231890,
  expectedSettlement: 38947123,
  costs: 28456780,
  expectedMargin: 10490343,
  cashback: 0,
  orderCount: 1248,
};

export const mockDailySales: DailySales[] = Array.from({ length: 31 }, (_, i) => ({
  date: `2026-06-${String(i + 1).padStart(2, '0')}`,
  sales: Math.floor(Math.random() * 3000000) + 500000,
}));

export const mockAnnouncements: Announcement[] = [
  {
    id: '1',
    badge: 'important',
    title: '전체 주문현황과 처리 이슈 보드 추가',
    date: '방금 전',
    content: '접수부터 소싱·해외배송·통관·구매확정·클레임까지 전체 흐름을 한 화면에서 확인할 수 있습니다.',
  },
  {
    id: '2',
    badge: 'general',
    title: '고객·판매자 알림 정책 화면 추가',
    date: '방금 전',
    content: '통관부호, 현지배송, 배대지 출고, 신규주문, 오류입고 알림을 분리해 검토할 수 있습니다.',
  },
  {
    id: '3',
    badge: 'general',
    title: '문의 AI 답변 초안과 실제마진 필터 추가',
    date: '방금 전',
    content: '문의 초안을 검토 후 전송하고, 장부에서 직접 입력 비용 반영 여부를 전환할 수 있습니다.',
  },
];

export const mockPendingTasks: PendingTask[] = [
  {
    id: 'new-orders',
    name: '신규주문',
    count: 23,
    url: '/orders?view=new',
  },
  {
    id: 'preparing',
    name: '상품준비',
    count: 15,
    url: '/orders?view=preparing',
  },
  {
    id: 'waiting',
    name: '발송대기',
    count: 5,
    url: '/orders?view=waiting',
  },
  {
    id: 'claims',
    name: '취소/반품/교환',
    count: 3,
    url: '/orders?view=claims',
  },
];

export const mockNotifications: Notification[] = [
  {
    id: '1',
    title: '새로운 주문',
    message: '신규 주문 5건이 수집되었습니다.',
    timestamp: '10분 전',
    isRead: false,
  },
  {
    id: '2',
    title: '상품준비 필요',
    message: '이미지 매칭 또는 옵션 확인이 필요한 주문 3건이 있습니다.',
    timestamp: '1시간 전',
    isRead: false,
  },
  {
    id: '3',
    title: '국내송장 수신',
    message: '소싱라이프에서 국내송장 2건이 수신되었습니다.',
    timestamp: '2시간 전',
    isRead: true,
  },
];
