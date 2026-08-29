"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { Check, Search, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandGroup,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MARKET_BADGE_CLASSES, MARKET_LABELS } from "@/lib/constants/orders";
import { filterOrders, getOrderAccountKey, type OrderPeriodFilter } from "@/lib/order-search";
import { cn } from "@/lib/utils";
import { MarketType, Order } from "@/types/order";

export interface OrderSearchProps {
    baseData: Order[];
    onSearch: (filtered: Order[]) => void;
    linkedStores?: readonly AccountOption[];
    middleContent?: ReactNode;
    commonAction?: ReactNode;
    showMarketFilter?: boolean;
    placeholder?: string;
}

export interface AccountOption {
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

const periodOptions: Array<{ value: OrderPeriodFilter; label: string }> = [
    { value: "today", label: "오늘" },
    { value: "3d", label: "3일" },
    { value: "7d", label: "7일" },
    { value: "1m", label: "30일" },
    { value: "custom", label: "직접 입력" },
];

const marketIconMeta: Record<MarketType, { label: string; className: string }> = {
    naver: { label: "N", className: MARKET_BADGE_CLASSES.naver },
    coupang: { label: "C", className: MARKET_BADGE_CLASSES.coupang },
    "11st": { label: "11", className: MARKET_BADGE_CLASSES["11st"] },
    gmarket: { label: "G", className: MARKET_BADGE_CLASSES.gmarket },
    auction: { label: "A", className: MARKET_BADGE_CLASSES.auction },
};

function MarketIcon({ marketType }: { marketType: MarketType }) {
    const icon = marketIconMeta[marketType];

    return (
        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", icon.className)}>
            {icon.label}
        </span>
    );
}

export function OrderSearch({
    baseData,
    onSearch,
    linkedStores,
    commonAction,
    middleContent,
    showMarketFilter = true,
    placeholder = "상품명, 주문번호, 주문자, 수령인 검색",
}: OrderSearchProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [marketFilters, setMarketFilters] = useState<MarketType[]>([]);
    const [accountFilters, setAccountFilters] = useState<string[]>([]);
    const [periodFilter, setPeriodFilter] = useState<OrderPeriodFilter>("7d");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [dateOpen, setDateOpen] = useState(false);
    const [combinedOpen, setCombinedOpen] = useState(false);
    const derivedAccountOptions = useMemo(() => {
        const optionMap = new Map<string, AccountOption>();

        baseData.forEach((order) => {
            const key = getOrderAccountKey(order);
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
    const accountOptions = linkedStores ?? derivedAccountOptions;

    useEffect(() => {
        onSearch(filterOrders(baseData, {
            searchTerm,
            marketFilters,
            accountFilters,
            periodFilter,
            startDate,
            endDate,
        }));
    }, [accountFilters, baseData, endDate, marketFilters, onSearch, periodFilter, searchTerm, startDate]);

    const hasCombinedFilter = marketFilters.length > 0 || accountFilters.length > 0;
    const toggleMarketFilter = (marketType: MarketType) => {
        const next = marketFilters.includes(marketType)
            ? marketFilters.filter((item) => item !== marketType)
            : [...marketFilters, marketType];

        setMarketFilters(next);
        setAccountFilters((selectedAccounts) => {
            if (next.length === 0) return selectedAccounts;
            return selectedAccounts.filter((accountKey) => {
                const [accountMarket] = accountKey.split(":");
                return next.includes(accountMarket as MarketType);
            });
        });
    };
    const toggleAccountFilter = (accountKey: string) => {
        setAccountFilters((current) => (
            current.includes(accountKey)
                ? current.filter((item) => item !== accountKey)
                : [...current, accountKey]
        ));
    };
    const resetCombinedFilter = () => {
        setMarketFilters([]);
        setAccountFilters([]);
    };
    const isAccountEnabled = (marketType: MarketType) => marketFilters.length === 0 || marketFilters.includes(marketType);

    return (
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={periodFilter}
                    onValueChange={(value) => {
                        if (!value) return;
                        const period = value as OrderPeriodFilter;
                        setPeriodFilter(period);
                        if (period === "custom") {
                            setDateOpen(true);
                            return;
                        }
                        setStartDate("");
                        setEndDate("");
                        setDateOpen(false);
                    }}
                >
                    {periodOptions.map((period) => (
                        <ToggleGroupItem
                            key={period.value}
                            value={period.value}
                            className="font-bold"
                        >
                            {period.label}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>

                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                    <PopoverTrigger asChild>
                        <Button type="button" variant="ghost" className="sr-only">직접 기간 선택</Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[240px] rounded-md p-3" align="start">
                        <div className="grid gap-2">
                            <Field className="gap-1">
                                <FieldLabel htmlFor="order-start-date">시작날짜</FieldLabel>
                                <Input
                                    id="order-start-date"
                                    type="date"
                                    value={startDate}
                                    onChange={(event) => setStartDate(event.target.value)}
                                    className="bg-background shadow-none"
                                />
                            </Field>
                            <Field className="gap-1">
                                <FieldLabel htmlFor="order-end-date">끝나는날짜</FieldLabel>
                                <Input
                                    id="order-end-date"
                                    type="date"
                                    value={endDate}
                                    onChange={(event) => setEndDate(event.target.value)}
                                    className="bg-background shadow-none"
                                />
                            </Field>
                        </div>
                    </PopoverContent>
                </Popover>

                <div className="relative min-w-[280px] flex-1 xl:max-w-[380px]">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder={placeholder}
                        className="h-8 border-border bg-card pl-9 text-sm shadow-sm focus-visible:bg-card"
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        aria-label="주문 검색"
                    />
                </div>

                {showMarketFilter && (
                    <Popover open={combinedOpen} onOpenChange={setCombinedOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="icon"
                                aria-label="마켓/스토어 필터"
                                className={cn(
                                    "relative h-8 w-8 border-border bg-card shadow-sm",
                                    hasCombinedFilter && "border-foreground bg-primary text-primary-foreground",
                                )}
                            >
                                <Store className="h-4 w-4" />
                                {hasCombinedFilter && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary-foreground" />}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[280px] rounded-md p-0" align="start">
                            <Command>
                                <CommandList>
                                    <CommandGroup heading="마켓">
                                        <CommandItem value="전체 마켓 스토어" onSelect={resetCombinedFilter}>
                                            <span className="flex-1">전체</span>
                                            {!hasCombinedFilter && <Check className="h-4 w-4" />}
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
                                    <CommandGroup heading="스토어">
                                        {accountOptions.map((account) => {
                                            const enabled = isAccountEnabled(account.marketType);

                                            return (
                                                <CommandItem
                                                    key={account.key}
                                                    value={`${MARKET_LABELS[account.marketType]} ${account.storeName}`}
                                                    disabled={!enabled}
                                                    className={cn(!enabled && "cursor-not-allowed opacity-35")}
                                                    onSelect={() => {
                                                        if (enabled) toggleAccountFilter(account.key);
                                                    }}
                                                >
                                                    <MarketIcon marketType={account.marketType} />
                                                    <span className="flex-1">{account.storeName}</span>
                                                    {accountFilters.includes(account.key) && <Check className="h-4 w-4" />}
                                                </CommandItem>
                                            );
                                        })}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                )}

                {middleContent && <div className="flex items-center">{middleContent}</div>}
            </div>

            {commonAction && <div className="flex shrink-0 items-center justify-end">{commonAction}</div>}
        </div>
    );
}
