import { Inquiry } from "@/types/inquiry";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Item, ItemActions, ItemContent, ItemMedia } from "@/components/ui/item";
import { MARKET_LABELS, MARKET_OUTLINE_BADGE_CLASSES } from "@/lib/constants/orders";
import { Clock } from "lucide-react";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";

interface InquiryListItemProps {
    inquiry: Inquiry;
    onReply: (inquiry: Inquiry) => void;
}

const getMarketBadge = (market: Inquiry["marketType"]) => {
    return (
        <Badge variant="outline" className={MARKET_OUTLINE_BADGE_CLASSES[market]}>
            {MARKET_LABELS[market]}
        </Badge>
    );
};

const maskUserId = (id: string) => {
    if (id.length <= 3) return id;
    return id.substring(0, 1) + "***" + id.substring(id.length - 1);
};

export function InquiryListItem({ inquiry, onReply }: InquiryListItemProps) {
    const timeAgo = formatDistanceToNow(new Date(inquiry.createdAt), { addSuffix: true, locale: ko });

    return (
        <Item variant="outline" className="items-start gap-4 bg-card hover:bg-accent/50">
            {/* 1. Market & Product Thumbnail */}
            <ItemMedia className="min-w-[80px] flex-col gap-2">
                {getMarketBadge(inquiry.marketType)}
                {inquiry.product && (
                    <div className="relative h-16 w-16 rounded overflow-hidden border bg-muted">
                        <Image src={inquiry.product.thumbnail} alt="Product" fill sizes="64px" className="object-cover" />
                    </div>
                )}
            </ItemMedia>

            {/* 2. Content */}
            <ItemContent className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{inquiry.type}</span>
                    <span>•</span>
                    <span>{inquiry.product?.name}</span>
                </div>

                <p className="text-sm font-medium line-clamp-2 leading-relaxed">
                    {inquiry.content}
                </p>

                <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                    <div className="flex items-center gap-1">
                        <span className="font-mono bg-muted px-1 rounded">{maskUserId(inquiry.writerId)}</span>
                        {inquiry.writerName && <span>({maskUserId(inquiry.writerName)})</span>}
                    </div>
                    <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {timeAgo}
                    </div>
                </div>
            </ItemContent>

            {/* 3. Action */}
            <ItemActions className="self-center pl-2">
                {inquiry.status === 'answered' ? (
                    <Button variant="ghost" disabled className="text-foreground bg-muted">
                        답변완료
                    </Button>
                ) : (
                    inquiry.isExternal ? (
                        <Button asChild variant="outline" size="sm">
                            <a href={inquiry.externalLink} target="_blank" rel="noreferrer">문의 바로가기</a>
                        </Button>
                    ) : (
                        <Button size="sm" onClick={() => onReply(inquiry)}>
                            답변하기
                        </Button>
                    )
                )}
            </ItemActions>
        </Item>
    );
}

