"use client";

import { useDashboardMetrics } from "@/hooks/use-dashboard-data";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, CreditCard, TrendingUp, Wallet, ShoppingCart, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface SummaryItemProps {
    label: string;
    value: number;
    icon: React.ReactNode;
    description: string;
    valueClassName?: string;
    unit?: string;
}

function SummaryItem({ label, value, icon, description, valueClassName, unit = "원" }: SummaryItemProps) {
    return (
        <Card className="gap-0 py-0">
            <CardContent className="flex items-center gap-4 p-4">
            <div className="p-2 bg-background rounded-full border shadow-sm text-muted-foreground">
                {icon}
            </div>
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">{label}</span>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button type="button" variant="ghost" size="icon-sm" className="size-6" aria-label={`${label} 설명`}>
                                    <Info className="size-4 text-muted-foreground" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p className="text-xs">{description}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <span className={cn("text-lg font-bold tracking-tight", valueClassName)}>
                    {new Intl.NumberFormat('ko-KR').format(value)}{unit}
                </span>
            </div>
            </CardContent>
        </Card>
    );
}

export function SalesSummary() {
    const { data: metrics, isLoading } = useDashboardMetrics();

    if (isLoading) {
        return <SummarySkeleton />;
    }

    if (!metrics) return null;

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
            <SummaryItem
                label="총 매출"
                value={metrics.sales}
                icon={<DollarSign className="h-4 w-4" />}
                description="해당 월의 총 결제 금액입니다."
            />
            <SummaryItem
                label="정산예정금"
                value={metrics.expectedSettlement}
                icon={<Wallet className="h-4 w-4" />}
                description="마켓수수료를 제외하고 입금될 예정 금액입니다."
            />
            <SummaryItem
                label="비용"
                value={metrics.costs}
                icon={<CreditCard className="h-4 w-4" />}
                description="매입가 + 배송비 등 지출 합계입니다."
            />
            <SummaryItem
                label="예상마진"
                value={metrics.expectedMargin}
                icon={<TrendingUp className="h-4 w-4" />}
                description="정산예정금에서 비용을 뺀 수익성 지표입니다."
                valueClassName="text-foreground dark:text-foreground"
            />
            <SummaryItem
                label="주문건수"
                value={metrics.orderCount}
                unit="건"
                icon={<ShoppingCart className="h-4 w-4" />}
                description="해당 기간 발생한 총 주문 건수입니다."
            />
        </div>
    );
}

function SummarySkeleton() {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            {Array.from({ length: 5 }).map((_, i) => (
                <Card key={i} className="h-20 gap-0 py-0">
                    <CardContent className="flex h-full items-center gap-4 p-4">
                        <Skeleton className="size-10 rounded-full" />
                        <div className="flex-1 space-y-2">
                            <Skeleton className="h-3 w-20" />
                            <Skeleton className="h-5 w-28" />
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
