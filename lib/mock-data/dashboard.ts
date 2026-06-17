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
    title: '소싱라이프 결제 연동 준비 안내',
    date: '2일 전',
    content: '주문팡팡 상품/옵션 매칭 결과를 소싱라이프 결제 페이지로 넘기는 연동을 준비 중입니다.',
  },
  {
    id: '2',
    badge: 'general',
    title: '국내송장 자동 회수 구조 안내',
    date: '5일 전',
    content: '소싱라이프 결제 완료 후 생성되는 국내송장을 주문팡팡으로 수신하고 마켓에 업로드하는 구조입니다.',
  },
  {
    id: '3',
    badge: 'general',
    title: '마켓 주문 수집 점검',
    date: '1주 전',
    content: '네이버, 쿠팡, 11번가 주문 수집 항목을 점검했습니다.',
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
