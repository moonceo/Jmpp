"use client";

import { useMemo, useState } from "react";
import {
    Download,
    PencilLine,
    Search,
    Settings,
} from "lucide-react";
import { toast } from "sonner";
import { ManualLedgerEntryDialog } from "@/components/ledger/manual-ledger-entry-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MARKET_LABELS } from "@/lib/constants/orders";
import {
    filterLedgerOrders,
    formatLedgerDate,
    getMonthLedgerRange,
    getRecentLedgerRange,
    LEDGER_HEADERS,
    ledgerRowToValues,
    summarizeLedger,
    type LedgerFilter,
    type LedgerMarket,
} from "@/lib/ledger";
import { createMockOrders } from "@/lib/mock-data/orders";
import {
    useLedgerManualEntryHydration,
    useLedgerManualEntryStore,
} from "@/lib/stores/ledger-manual-entry-store";
import { cn } from "@/lib/utils";
import type { MarketType, Order } from "@/types/order";

type SearchMode = "monthly" | "range";

const marketOptions = Object.entries(MARKET_LABELS) as Array<[MarketType, string]>;

function rangeFromDays(referenceDate: Date, days: number): Pick<LedgerFilter, "startDate" | "endDate"> {
    const end = new Date(referenceDate);
    const start = new Date(referenceDate);
    start.setDate(start.getDate() - (days - 1));
    return { startDate: formatLedgerDate(start), endDate: formatLedgerDate(end) };
}

function formatCurrency(value: number): string {
    return `${value.toLocaleString("ko-KR")}원`;
}

type LedgerHeader = (typeof LEDGER_HEADERS)[number];

const NUMBER_HEADERS = new Set<LedgerHeader>([
    "수량",
    "상품결제금액",
    "결제배송비",
    "정산예정금액",
    "결제금액",
    "구매금액(원화)",
    "국제배송비",
    "화물택배비",
    "관부가세",
    "수익금",
    "수익률",
]);

function formatLedgerCell(header: LedgerHeader, value: string | number | Date | null): string {
    if (value === null || value === "") return "-";
    if (value instanceof Date) return formatLedgerDate(value);
    if (header === "수익률" && typeof value === "number") return `${(value * 100).toFixed(1)}%`;
    if (typeof value === "number" && header !== "수량") return value.toLocaleString("ko-KR");
    return String(value);
}

function ledgerHeaderGroupClass(index: number): string {
    if (index <= 18 || index === 37) return "bg-amber-50 text-amber-950";
    if (index <= 26) return "bg-yellow-100 text-yellow-950";
    if (index <= 34) return "bg-slate-100 text-slate-950";
    return "bg-rose-50 text-rose-950";
}

function ledgerColumnClass(header: LedgerHeader): string {
    if (["상품명", "주소", "배송메세지", "비고"].includes(header)) return "min-w-64 whitespace-normal";
    if (["상품URL", "소싱URL"].includes(header)) return "min-w-72 whitespace-normal break-all";
    if (["주문번호", "상품번호", "해외주문번호", "해외송장번호", "국내운송장번호", "화물운송장번호"].includes(header)) {
        return "min-w-44 font-mono";
    }
    return "min-w-28 whitespace-nowrap";
}

export default function LedgerPage() {
    useLedgerManualEntryHydration();
    const manualEntries = useLedgerManualEntryStore((state) => state.entries);
    const [orders] = useState(() => createMockOrders(new Date()));
    const [referenceDate] = useState(() => new Date());
    const initialRange = useMemo(() => getRecentLedgerRange(referenceDate), [referenceDate]);
    const [mode, setMode] = useState<SearchMode>("range");
    const [appliedMode, setAppliedMode] = useState<SearchMode>("range");
    const [year, setYear] = useState(String(referenceDate.getFullYear()));
    const [month, setMonth] = useState(String(referenceDate.getMonth() + 1));
    const [draftFilter, setDraftFilter] = useState<LedgerFilter>({
        ...initialRange,
        market: "all",
        onlyConfirmed: true,
        excludeCanceledReturns: true,
        includeManualEntries: true,
    });
    const [appliedFilter, setAppliedFilter] = useState<LedgerFilter>(draftFilter);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [manualEntryOrder, setManualEntryOrder] = useState<Order | null>(null);

    const rows = useMemo(
        () => filterLedgerOrders(orders, appliedFilter, manualEntries),
        [appliedFilter, manualEntries, orders],
    );
    const summary = useMemo(() => summarizeLedger(rows), [rows]);

    const updateDates = (range: Pick<LedgerFilter, "startDate" | "endDate">) => {
        setDraftFilter((current) => ({ ...current, ...range }));
    };

    const selectMode = (nextMode: SearchMode) => {
        setMode(nextMode);
        if (nextMode === "monthly") {
            updateDates(getMonthLedgerRange(Number(year), Number(month)));
        }
    };

    const updateMonth = (nextYear: string, nextMonth: string) => {
        setYear(nextYear);
        setMonth(nextMonth);
        updateDates(getMonthLedgerRange(Number(nextYear), Number(nextMonth)));
    };

    const handleSearch = () => {
        if (draftFilter.startDate > draftFilter.endDate) {
            toast.error("조회 시작일은 종료일보다 늦을 수 없습니다.");
            return;
        }

        setIsRefreshing(true);
        setAppliedFilter(draftFilter);
        setAppliedMode(mode);
        window.setTimeout(() => setIsRefreshing(false), 350);
    };

    const handleDownload = async () => {
        setIsGenerating(true);
        try {
            const response = await fetch("/api/ledger/download", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...appliedFilter, monthly: appliedMode === "monthly", manualEntries }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => null) as { message?: string } | null;
                throw new Error(error?.message ?? "장부 파일을 생성하지 못했습니다.");
            }

            const disposition = response.headers.get("Content-Disposition") ?? "";
            const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "commerce-life_ledger.xlsx";
            const blob = await response.blob();
            const downloadUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = downloadUrl;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(downloadUrl);
            toast.success(`장부 다운로드 완료: ${filename}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "장부 파일을 생성하지 못했습니다.");
        } finally {
            setIsGenerating(false);
        }
    };

    const marketCount = new Set(orders.map((order) => order.marketType)).size;
    const updateDraft = <Key extends keyof LedgerFilter>(key: Key, value: LedgerFilter[Key]) => {
        setDraftFilter((current) => ({ ...current, [key]: value }));
    };

    return (
        <div className="min-h-full space-y-6 p-4 sm:p-6 lg:p-8">
            <PageHeader
                eyebrow="COMMERCE LIFE · LEDGER EXPORT"
                title="장부 다운로드"
                description="주문을 조회하고 엑셀 장부로 저장합니다."
            />

            <Card className="rounded-xl p-4 shadow-sm">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-2">
                    <div className="shrink-0">
                        <div className="flex h-10 rounded-md bg-muted p-1">
                            <button
                                type="button"
                                onClick={() => selectMode("range")}
                                className={cn(
                                    "rounded px-2.5 text-sm font-bold transition-colors",
                                    mode === "range" ? "bg-background shadow-sm" : "text-muted-foreground",
                                )}
                            >
                                기간
                            </button>
                            <button
                                type="button"
                                onClick={() => selectMode("monthly")}
                                className={cn(
                                    "rounded px-2.5 text-sm font-bold transition-colors",
                                    mode === "monthly" ? "bg-background shadow-sm" : "text-muted-foreground",
                                )}
                            >
                                월별
                            </button>
                        </div>
                    </div>

                    <div className="shrink-0">
                        {mode === "monthly" ? (
                            <div className="flex gap-2">
                                <Select value={year} onValueChange={(value) => updateMonth(value, month)}>
                                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {Array.from({ length: 3 }, (_, index) => referenceDate.getFullYear() - index).map((value) => (
                                            <SelectItem key={value} value={String(value)}>{value}년</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={month} onValueChange={(value) => updateMonth(year, value)}>
                                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
                                            <SelectItem key={value} value={String(value)}>{value}월</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1.5">
                                <label>
                                    <span className="sr-only">조회 시작일</span>
                                    <input
                                        type="date"
                                        value={draftFilter.startDate}
                                        onChange={(event) => updateDraft("startDate", event.target.value)}
                                        className="h-10 w-32 rounded-md border bg-background px-2 font-mono text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    />
                                </label>
                                <span className="text-muted-foreground">—</span>
                                <label>
                                    <span className="sr-only">조회 종료일</span>
                                    <input
                                        type="date"
                                        value={draftFilter.endDate}
                                        onChange={(event) => updateDraft("endDate", event.target.value)}
                                        className="h-10 w-32 rounded-md border bg-background px-2 font-mono text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    />
                                </label>
                            </div>
                        )}
                    </div>

                    {mode === "range" && (
                        <div className="shrink-0">
                            <Select value="" onValueChange={(value) => {
                                if (value === "today") updateDates(rangeFromDays(referenceDate, 1));
                                if (value === "week") updateDates(rangeFromDays(referenceDate, 7));
                                if (value === "month") updateDates(getMonthLedgerRange(referenceDate.getFullYear(), referenceDate.getMonth() + 1));
                                if (value === "quarter") {
                                    const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - 2, 1);
                                    updateDates({ startDate: formatLedgerDate(start), endDate: formatLedgerDate(referenceDate) });
                                }
                            }}>
                                <SelectTrigger className="w-24" aria-label="빠른 기간 선택">
                                    <SelectValue placeholder="빠른 기간" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="today">오늘</SelectItem>
                                    <SelectItem value="week">최근 7일</SelectItem>
                                    <SelectItem value="month">이번 달</SelectItem>
                                    <SelectItem value="quarter">최근 3개월</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="shrink-0">
                        <Select value={draftFilter.market} onValueChange={(value) => updateDraft("market", value as LedgerMarket)}>
                            <SelectTrigger className="w-32" aria-label="마켓">
                                <SelectValue>
                                    {draftFilter.market === "all" ? `전체 (${marketCount})` : MARKET_LABELS[draftFilter.market]}
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">전체 ({marketCount})</SelectItem>
                                {marketOptions.map(([value, label]) => (
                                    <SelectItem key={value} value={value}>{label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="min-w-40 shrink-0 xl:ml-auto">
                        <p className="flex h-10 items-center whitespace-nowrap rounded-md bg-muted/60 px-3 font-mono text-[11px] font-bold">
                            {appliedFilter.startDate} — {appliedFilter.endDate}
                        </p>
                    </div>

                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        aria-label="조회 설정"
                        title="조회 설정"
                        onClick={() => setSettingsOpen(true)}
                    >
                        <Settings className="size-4" />
                    </Button>
                    <Button className="shrink-0 px-3" onClick={handleSearch} disabled={isRefreshing}>
                        <Search className="size-4" />
                        {isRefreshing ? "조회 중" : "조회"}
                    </Button>
                </div>
            </Card>

            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>조회 설정</DialogTitle>
                        <DialogDescription>장부에 포함할 주문 조건을 선택합니다.</DialogDescription>
                    </DialogHeader>
                    <div className="divide-y rounded-md border">
                        <SettingSwitch
                            label="마진 확정 주문만"
                            description="실제 또는 직접 입력 구매금액이 있는 주문만 표시"
                            checked={draftFilter.onlyConfirmed}
                            onCheckedChange={(checked) => updateDraft("onlyConfirmed", checked)}
                        />
                        <SettingSwitch
                            label="취소·반품 제외"
                            description="취소되거나 반품된 주문은 장부에서 제외"
                            checked={draftFilter.excludeCanceledReturns}
                            onCheckedChange={(checked) => updateDraft("excludeCanceledReturns", checked)}
                        />
                        <SettingSwitch
                            label="직접 입력 반영"
                            description="직접 입력값을 장부 데이터, 마진과 엑셀에 반영"
                            checked={draftFilter.includeManualEntries}
                            onCheckedChange={(checked) => updateDraft("includeManualEntries", checked)}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            <Card className="overflow-hidden rounded-xl border-foreground bg-foreground text-background shadow-sm">
                <div className="grid sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_190px]">
                    <SummaryItem label="주문" value={`${summary.totalOrders}건`} />
                    <SummaryItem label="매출" value={formatCurrency(summary.totalSales)} />
                    <SummaryItem label="마진" value={formatCurrency(summary.totalProfit)} />
                    <SummaryItem label="마진율" value={`${summary.marginRate.toFixed(1)}%`} />
                    <div className="flex items-center border-t border-background/15 p-3 xl:border-l xl:border-t-0">
                        <Button
                            variant="secondary"
                            className="w-full bg-background text-foreground hover:bg-background/90"
                            onClick={handleDownload}
                            disabled={isGenerating || rows.length === 0}
                        >
                            <Download className="size-4" />
                            {isGenerating ? "생성 중" : "엑셀 다운로드"}
                        </Button>
                    </div>
                </div>
            </Card>

            <Card className="overflow-hidden rounded-xl shadow-sm">
                <div className="max-h-[68vh] overflow-auto">
                    <Table className="min-w-max border-separate border-spacing-0">
                        <TableHeader className="sticky top-0 z-20 shadow-[0_1px_0_0_var(--border)]">
                            <TableRow>
                                {LEDGER_HEADERS.map((header, index) => (
                                    <TableHead
                                        key={header}
                                        className={cn(
                                            "h-12 border-r border-b px-3 text-xs font-black whitespace-nowrap",
                                            ledgerHeaderGroupClass(index),
                                            index === 0 && "sticky left-0 z-30 w-28 min-w-28",
                                            NUMBER_HEADERS.has(header) && "text-right",
                                        )}
                                    >
                                        <span className="mr-1.5 font-mono text-[10px] opacity-45">{String(index + 1).padStart(2, "0")}</span>
                                        {header}
                                    </TableHead>
                                ))}
                                <TableHead className="h-12 w-12 min-w-12 border-b border-l bg-foreground p-0 text-center text-background">
                                    <PencilLine className="mx-auto size-3.5" aria-hidden="true" />
                                    <span className="sr-only">직접 입력</span>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={LEDGER_HEADERS.length + 1} className="h-28 text-center text-muted-foreground">
                                        조회 조건에 맞는 장부 데이터가 없습니다.
                                    </TableCell>
                                </TableRow>
                            ) : rows.map((row) => {
                                const values = ledgerRowToValues(row);

                                return (
                                    <TableRow key={row.order.id}>
                                        {LEDGER_HEADERS.map((header, index) => (
                                            <TableCell
                                                key={header}
                                                className={cn(
                                                    "border-r border-b px-3 py-2.5 text-xs align-top",
                                                    ledgerColumnClass(header),
                                                    index === 0 && "sticky left-0 z-10 w-28 min-w-28 bg-background font-mono",
                                                    NUMBER_HEADERS.has(header) && "text-right tabular-nums",
                                                    (header === "수익금" || header === "수익률") && "font-bold",
                                                )}
                                            >
                                                {formatLedgerCell(header, values[index] ?? null)}
                                            </TableCell>
                                        ))}
                                        <TableCell className="w-12 min-w-12 border-b border-l bg-background p-0 text-center">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-xs"
                                                aria-label={`${row.order.product.name} 직접 입력`}
                                                title="직접 입력"
                                                onClick={() => setManualEntryOrder(row.order)}
                                            >
                                                <PencilLine aria-hidden="true" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </Card>

            {manualEntryOrder && (
                <ManualLedgerEntryDialog
                    key={manualEntryOrder.id}
                    orders={[manualEntryOrder]}
                    initialOrderId={manualEntryOrder.id}
                    open
                    hideTrigger
                    onOpenChange={(open) => {
                        if (!open) setManualEntryOrder(null);
                    }}
                />
            )}
        </div>
    );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="border-t border-background/15 px-5 py-4 xl:border-l xl:border-t-0">
            <p className="text-[11px] font-semibold text-background/55">{label}</p>
            <p className="mt-1 whitespace-nowrap text-lg font-black tracking-tight">{value}</p>
        </div>
    );
}

function SettingSwitch({
    label,
    description,
    checked,
    onCheckedChange,
}: {
    label: string;
    description: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-center gap-4 px-4 py-3.5">
            <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
            </span>
            <Switch
                checked={checked}
                onCheckedChange={onCheckedChange}
                aria-label={label}
            />
        </label>
    );
}
