"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { Check, Search, Store, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandGroup,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MARKET_LABELS } from "@/lib/constants/orders";
import { cn } from "@/lib/utils";
import { MarketType, Order } from "@/types/order";

export interface OrderSearchProps {
    baseData: Order[];
    onSearch: (filtered: Order[]) => void;
    middleContent?: ReactNode;
    commonAction?: ReactNode;
    showMarketFilter?: boolean;
    placeholder?: string;
}

type PeriodFilter = "today" | "3d" | "7d" | "1m" | "custom";

interface AccountOption {
    key: string;
    marketType: MarketType;
    storeName: string;
}

const marketOptions: Array<{ value: MarketType; label: string }> = [
    { value: "naver", label: MARKET_LABELS.naver },
    { value: "coupang", label: MARKET_LABELS.coupang },
    { value: "11st", label: MARKET_LABELS["11st"] },
    { value: "gmarket", label: MARKET_LABELS.gmarket },
    { value: "auction", label: MARKET_LABELS.auction },
];

const periodOptions: Array<{ value: PeriodFilter; label: string; days?: number }> = [
    { value: "today", label: "오늘", days: 0 },
    { value: "3d", label: "3일", days: 3 },
    { value: "7d", label: "7일", days: 7 },
    { value: "1m", label: "한달", days: 30 },
    { value: "custom", label: "직접선택" },
];

const marketIconMeta: Record<MarketType, { label: string; className: string }> = {
    naver: { label: "N", className: "bg-emerald-500 text-white" },
    coupang: { label: "C", className: "bg-red-500 text-white" },
    "11st": { label: "11", className: "bg-orange-500 text-white" },
    gmarket: { label: "G", className: "bg-blue-500 text-white" },
    auction: { label: "A", className: "bg-violet-500 text-white" },
};

function formatDateFilterLabel(periodFilter: PeriodFilter, startDate: string, endDate: string) {
    if (periodFilter === "custom") {
        if (startDate && endDate) return `${startDate} ~ ${endDate}`;
        if (startDate) return `${startDate} ~`;
        if (endDate) return `~ ${endDate}`;
    }

    return periodOptions.find((item) => item.value === periodFilter)?.label ?? "7일";
}

function getAccountKey(order: Pick<Order, "marketType" | "storeName">) {
    return `${order.marketType}:${order.storeName}`;
}

function MarketIcon({ marketType }: { marketType: MarketType }) {
    const icon = marketIconMeta[marketType];

    return (
        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", icon.className)}>
            {icon.label}
        </span>
    );
}

export function OrderSearch({
    baseData,
    onSearch,
    commonAction,
    middleContent,
    showMarketFilter = true,
    placeholder = "상품명, 주문번호, 주문자, 수령인 검색",
}: OrderSearchProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [marketFilters, setMarketFilters] = useState<MarketType[]>([]);
    const [accountFilters, setAccountFilters] = useState<string[]>([]);
    const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("7d");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [dateOpen, setDateOpen] = useState(false);
    const [marketOpen, setMarketOpen] = useState(false);
    const [accountOpen, setAccountOpen] = useState(false);
    const accountOptions = useMemo(() => {
        const optionMap = new Map<string, AccountOption>();

        baseData.forEach((order) => {
            const key = getAccountKey(order);
            if (!optionMap.has(key)) {
                optionMap.set(key, {
                    key,
                    marketType: order.marketType,
                    storeName: order.storeName,
                });
            }
        });

        return Array.from(optionMap.values());
    }, [baseData]);

    useEffect(() => {
        const term = searchTerm.trim().toLowerCase();
        const normalizedTerm = term.replace(/\D/g, "");
        const selectedPeriod = periodOptions.find((item) => item.value === periodFilter);
        const cutoff = selectedPeriod?.days !== undefined && periodFilter !== "custom"
            ? new Date(new Date().getTime() - selectedPeriod.days * 24 * 60 * 60 * 1000)
            : undefined;
        const start = periodFilter === "custom" && startDate ? new Date(`${startDate}T00:00:00`) : undefined;
        const end = periodFilter === "custom" && endDate ? new Date(`${endDate}T23:59:59`) : undefined;
        const filtered = baseData.filter((order) => {
            const phoneTargets = [order.buyerPhone, order.recipient.phone].map((value) => value.replace(/\D/g, ""));
            const matchesSearch =
                !term ||
                order.product.name.toLowerCase().includes(term) ||
                order.marketOrderId.toLowerCase().includes(term) ||
                order.product.productOrderId?.toLowerCase().includes(term) ||
                order.product.id.toLowerCase().includes(term) ||
                order.id.toLowerCase().includes(term) ||
                order.buyerName.toLowerCase().includes(term) ||
                order.buyerId?.toLowerCase().includes(term) ||
                order.recipient.name.toLowerCase().includes(term) ||
                order.recipient.deliveryMessage?.toLowerCase().includes(term) ||
                order.recipient.personalCustomsCode?.toLowerCase().includes(term) ||
                phoneTargets.some((phone) => normalizedTerm && phone.includes(normalizedTerm));

            const matchesMarket = marketFilters.length === 0 || marketFilters.includes(order.marketType);
            const matchesAccount = accountFilters.length === 0 || accountFilters.includes(getAccountKey(order));
            const orderDate = new Date(order.orderDate.replace(/-/g, "/"));
            const matchesPeriod = (!cutoff || orderDate >= cutoff)
                && (!start || orderDate >= start)
                && (!end || orderDate <= end);

            return matchesSearch && matchesMarket && matchesAccount && matchesPeriod;
        });

        onSearch(filtered);
    }, [accountFilters, baseData, endDate, marketFilters, onSearch, periodFilter, searchTerm, startDate]);

    const dateFilterLabel = formatDateFilterLabel(periodFilter, startDate, endDate);
    const toggleMarketFilter = (marketType: MarketType) => {
        setMarketFilters((current) => (
            current.includes(marketType)
                ? current.filter((item) => item !== marketType)
                : [...current, marketType]
        ));
    };
    const toggleAccountFilter = (accountKey: string) => {
        setAccountFilters((current) => (
            current.includes(accountKey)
                ? current.filter((item) => item !== accountKey)
                : [...current, accountKey]
        ));
    };

    return (
        <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-2.5 shadow-sm xl:flex-row xl:items-center">
            <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                    placeholder={placeholder}
                    className="h-9 border-slate-200 bg-slate-50 pl-9 text-sm shadow-none focus-visible:bg-white"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    aria-label="주문 검색"
                />
            </div>

            {middleContent && <div className="flex items-center">{middleContent}</div>}

            <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        className="h-9 w-full justify-start gap-2 border-slate-200 bg-white shadow-none xl:w-[180px]"
                        aria-label="날짜 필터"
                    >
                        <span className="truncate">{dateFilterLabel}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[240px] rounded-md p-3" align="end">
                    <div className="grid gap-2">
                        {periodOptions.map((period) => (
                            <Button
                                key={period.value}
                                type="button"
                                variant={periodFilter === period.value ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                    setPeriodFilter(period.value);
                                    if (period.value !== "custom") {
                                        setStartDate("");
                                        setEndDate("");
                                        setDateOpen(false);
                                    }
                                }}
                            >
                                {period.label}
                            </Button>
                        ))}
                    </div>

                    {periodFilter === "custom" && (
                        <div className="mt-3 grid gap-2 border-t pt-3">
                            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                                시작날짜
                                <Input
                                    type="date"
                                    value={startDate}
                                    onChange={(event) => setStartDate(event.target.value)}
                                    className="bg-background shadow-none"
                                />
                            </label>
                            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                                끝나는날짜
                                <Input
                                    type="date"
                                    value={endDate}
                                    onChange={(event) => setEndDate(event.target.value)}
                                    className="bg-background shadow-none"
                                />
                            </label>
                        </div>
                    )}
                </PopoverContent>
            </Popover>

            {showMarketFilter && (
                <Popover open={marketOpen} onOpenChange={setMarketOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            size="icon"
                            aria-label="플랫폼 필터"
                            className={cn(
                                "h-9 w-9 border-slate-200 bg-white shadow-none",
                                marketFilters.length > 0 && "border-sky-300 bg-sky-50 text-sky-700",
                            )}
                        >
                            <Store className="h-4 w-4" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[180px] rounded-md p-0" align="end">
                        <Command>
                            <CommandList>
                                <CommandGroup>
                                    <CommandItem
                                        value="전체 플랫폼"
                                        onSelect={() => setMarketFilters([])}
                                    >
                                        <span className="flex-1">전체</span>
                                        {marketFilters.length === 0 && <Check className="h-4 w-4" />}
                                    </CommandItem>
                                    {marketOptions.map((market) => (
                                        <CommandItem
                                            key={market.value}
                                            value={market.label}
                                            onSelect={() => toggleMarketFilter(market.value)}
                                        >
                                            <span className="flex-1">{market.label}</span>
                                            {marketFilters.includes(market.value) && <Check className="h-4 w-4" />}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>
            )}

            <Popover open={accountOpen} onOpenChange={setAccountOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="icon"
                        aria-label="계정 필터"
                        className={cn(
                            "h-9 w-9 border-slate-200 bg-white shadow-none",
                            accountFilters.length > 0 && "border-sky-300 bg-sky-50 text-sky-700",
                        )}
                    >
                        <UserRound className="h-4 w-4" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[260px] rounded-md p-0" align="end">
                    <Command>
                        <CommandList>
                            <CommandGroup>
                                <CommandItem
                                    value="전체 계정"
                                    onSelect={() => setAccountFilters([])}
                                >
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">
                                        ALL
                                    </span>
                                    <span className="flex-1">전체 계정</span>
                                    {accountFilters.length === 0 && <Check className="h-4 w-4" />}
                                </CommandItem>
                                {accountOptions.map((account) => (
                                    <CommandItem
                                        key={account.key}
                                        value={`${MARKET_LABELS[account.marketType]} ${account.storeName}`}
                                        onSelect={() => toggleAccountFilter(account.key)}
                                    >
                                        <MarketIcon marketType={account.marketType} />
                                        <span className="flex-1">{account.storeName}</span>
                                        {accountFilters.includes(account.key) && <Check className="h-4 w-4" />}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>

            {commonAction}
        </div>
    );
}
