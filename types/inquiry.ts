import { MarketType } from "./order";

export type InquiryStatus = 'waiting' | 'answered';

export interface InquiryProduct {
    name: string;
    thumbnail: string;
    optionName?: string;
    marketLink: string; // Link to market product page
}

export interface Inquiry {
    id: string;
    marketType: MarketType;
    status: InquiryStatus;

    // Content
    type: string; // e.g., "배송문의", "상품문의"
    content: string; // Main question text

    // Context
    product?: InquiryProduct; // Some inquiries are general, not product specific
    orderId?: string; // Optional linkage to an order

    // User Info (To be masked in UI)
    writerId: string;
    writerName?: string;
    createdAt: string;

    // Reply (if answered)
    replyContent?: string;
    repliedAt?: string;

    // Metadata for external market admin link handling
    isExternal?: boolean;
    externalLink?: string; // Link to market admin center for reply
}

export interface InquiryStats {
    unansweredCount: number;
    answeredCount: number; // This month
    totalCount: number;
    connectedStores: number;
}
