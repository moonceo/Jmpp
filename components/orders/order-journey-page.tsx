"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
    AlertCircle,
    CheckCircle2,
    Clock3,
    RefreshCw,
    Search,
    Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
    getOrderJourneyIssue,
    ORDER_JOURNEY_GROUPS,
    ORDER_JOURNEY_STATUS_LABELS,
    orderJourneyTargetHref,
    projectOrderJourneyStatus,
    type OrderJourneyIssue,
    type OrderJourneyIssueCode,
    type OrderJourneyStatus,
} from "@/lib/order-journey";
import { MARKET_LABELS } from "@/lib/constants/orders";
import { mockOrders } from "@/lib/mock-data/orders";
import { cn } from "@/lib/utils";
import type { Order } from "@/types/order";

interface JourneyRow {
    order: Order;
    status: OrderJourneyStatus;
    issue?: OrderJourneyIssue;
}

type IssueSettings = Record<OrderJourneyIssueCode, boolean>;

const ISSUE_SETTING_LABELS: Record<OrderJourneyIssueCode, { title: string; description: string }> = {
    CUSTOMS: {
        title: "통관부호 미수집·형식 오류",
        description: "신규·상품준비 주문의 통관부호를 확인 대상으로 표시합니다.",
    },
    FAILURE: {
        title: "처리보류·연동 실패",
        description: "작업 실패 사유가 있거나 처리보류된 주문을 표시합니다.",
    },
    CLAIM: {
        title: "미완료 마켓 클레임",
        description: "답변 또는 처리가 끝나지 않은 취소·반품·교환을 표시합니다.",
    },
    SOURCING_REFUND: {
        title: "소싱환불 후속 확인",
        description: "미접수·반품 필요·거절·대사 필요 상태를 표시합니다.",
    },
    MARGIN: {
        title: "예상 역마진",
        description: "예상 비용이 정산예정금보다 큰 주문을 표시합니다.",
    },
};

const DEFAULT_ISSUE_SETTINGS: IssueSettings = {
    CUSTOMS: true,
    FAILURE: true,
    CLAIM: true,
    SOURCING_REFUND: true,
    MARGIN: true,
};

export function OrderJourneyPage() {
    const [search, setSearch] = useState("");
    const [issuesOnly, setIssuesOnly] = useState(false);
    const [selectedStatus, setSelectedStatus] = useState<OrderJourneyStatus>("NEW_ORDER");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [issueSettings, setIssueSettings] = useState<IssueSettings>(DEFAULT_ISSUE_SETTINGS);
    const [dismissedIssueIds, setDismissedIssueIds] = useState<Set<string>>(() => new Set());
    const [snoozedUntilByOrderId, setSnoozedUntilByOrderId] = useState<Record<string, number>>({});
    const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

    const allRows = useMemo<JourneyRow[]>(() => {
        const normalizedSearch = search.trim().toLowerCase();
        const now = lastUpdatedAt?.getTime() ?? 0;

        return mockOrders
            .filter((order) => {
                if (!normalizedSearch) return true;
                return [
                    order.marketOrderId,
                    order.product.name,
                    order.recipient.name,
                    order.recipient.phone,
                    order.storeName,
                ].some((value) => value.toLowerCase().includes(normalizedSearch));
            })
            .map((order) => {
                const rawIssue = getOrderJourneyIssue(order);
                const isSuppressed = dismissedIssueIds.has(order.id)
                    || (snoozedUntilByOrderId[order.id] ?? 0) > now;
                const issue = rawIssue && issueSettings[rawIssue.code] && !isSuppressed
                    ? rawIssue
                    : undefined;

                return {
                    order,
                    status: projectOrderJourneyStatus(order),
                    issue,
                };
            });
    }, [dismissedIssueIds, issueSettings, lastUpdatedAt, search, snoozedUntilByOrderId]);

    const rows = useMemo(
        () => allRows.filter((row) => !issuesOnly || row.issue),
        [allRows, issuesOnly],
    );

    const countByStatus = useMemo(() => {
        return rows.reduce<Record<OrderJourneyStatus, { total: number; issues: number }>>((counts, row) => {
            counts[row.status].total += 1;
            if (row.issue) counts[row.status].issues += 1;
            return counts;
        }, createEmptyStatusCounts());
    }, [rows]);

    const selectedRows = useMemo(
        () => rows.filter((row) => row.status === selectedStatus),
        [rows, selectedStatus],
    );
    const visibleIssueCount = allRows.filter((row) => row.issue).length;
    const lastUpdatedLabel = lastUpdatedAt
        ? `최근 갱신 ${lastUpdatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
        : "초기 데모 데이터";

    const changeIssuesOnly = (checked: boolean) => {
        setIssuesOnly(checked);
        if (!checked) return;

        const firstIssue = allRows.find((row) => row.issue);
        if (firstIssue) setSelectedStatus(firstIssue.status);
    };

    const refresh = () => {
        setLastUpdatedAt(new Date());
        toast.success("주문현황을 최신 데모 데이터로 갱신했습니다.");
    };

    const dismissIssue = (orderId: string) => {
        setDismissedIssueIds((current) => new Set(current).add(orderId));
        toast.success("이 주문을 현재 이슈 목록에서 제외했습니다.");
    };

    const snoozeIssue = (orderId: string) => {
        const now = Date.now();
        setSnoozedUntilByOrderId((current) => ({
            ...current,
            [orderId]: now + 2 * 60 * 60 * 1000,
        }));
        setLastUpdatedAt(new Date(now));
        toast.success("2시간 뒤 다시 확인할 주문으로 미뤘습니다.");
    };

    return (
        <div className="min-h-full space-y-6 p-4 sm:p-6 lg:p-8">
            <PageHeader
                title="주문현황"
                eyebrow="COMMERCE LIFE · ORDER JOURNEY"
                description="접수부터 소싱·해외배송·통관·구매확정·클레임까지 전체 흐름과 처리할 이슈를 한 화면에서 봅니다."
                actions={(
                    <>
                        <Button variant="outline" onClick={() => setSettingsOpen(true)}>
                            <Settings2 />
                            이슈 기준 설정
                        </Button>
                        <Button onClick={refresh}>
                            <RefreshCw />
                            새로고침
                        </Button>
                    </>
                )}
            />

            <Alert>
                <AlertCircle />
                <AlertTitle className="line-clamp-none">외부 배대지 단계는 연동 수신값으로만 표시합니다</AlertTitle>
                <AlertDescription>
                    커머스라이프가 입고·검수·재포장·출고를 직접 운영하지 않습니다. 현재 데모에서는 보유한 주문·소싱·마켓 상태만 투영하며, 외부 연동값이 없는 단계는 0건으로 유지합니다.
                </AlertDescription>
            </Alert>

            <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="gap-4 border-b p-4 sm:p-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <div className="relative min-w-0 flex-1">
                            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="주문번호·상품명·수령자·연락처·스토어 검색"
                                className="pl-9"
                            />
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 lg:justify-start">
                            <div>
                                <Label htmlFor="issues-only" className="font-semibold">이슈만 보기</Label>
                                <p className="text-xs text-muted-foreground">현재 처리 필요 {visibleIssueCount}건</p>
                            </div>
                            <Switch id="issues-only" checked={issuesOnly} onCheckedChange={changeIssuesOnly} />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {lastUpdatedLabel} · 검색과 이슈 필터는 아래 상태표와 주문 목록에 함께 적용됩니다.
                    </p>
                </CardHeader>

                <CardContent className="p-4 sm:p-5">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                        {ORDER_JOURNEY_GROUPS.map((group) => (
                            <section key={group.id} className="min-w-0 rounded-lg border bg-muted/20 p-3">
                                <div className="mb-3 min-h-14">
                                    <h2 className="text-sm font-bold">{group.label}</h2>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{group.description}</p>
                                </div>
                                <div className="space-y-2">
                                    {group.statuses.map((status) => {
                                        const count = countByStatus[status.id];
                                        const active = selectedStatus === status.id;

                                        return (
                                            <Button
                                                key={status.id}
                                                type="button"
                                                variant="outline"
                                                className={cn(
                                                    "h-auto min-h-12 w-full justify-between gap-2 whitespace-normal px-3 py-2 text-left shadow-none",
                                                    active && "border-foreground bg-foreground text-background hover:bg-foreground hover:text-background",
                                                )}
                                                onClick={() => setSelectedStatus(status.id)}
                                            >
                                                <span className="min-w-0 text-sm font-medium leading-5">{status.label}</span>
                                                <span className="flex shrink-0 items-center gap-1.5">
                                                    {count.issues > 0 ? (
                                                        <Badge
                                                            variant={active ? "secondary" : "outline"}
                                                            className="px-1.5 text-xs"
                                                        >
                                                            처리 {count.issues}
                                                        </Badge>
                                                    ) : null}
                                                    <span className="min-w-5 text-right text-sm font-bold">{count.total}</span>
                                                </span>
                                            </Button>
                                        );
                                    })}
                                </div>
                            </section>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="border-b p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <CardTitle>{ORDER_JOURNEY_STATUS_LABELS[selectedStatus]}</CardTitle>
                            <CardDescription className="mt-1">
                                처리 필요 건을 먼저 확인하고 해당 주문 작업함으로 이동하세요.
                            </CardDescription>
                        </div>
                        <Badge variant="outline">{selectedRows.length}건</Badge>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {selectedRows.length > 0 ? (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>주문·상품</TableHead>
                                        <TableHead>판매처</TableHead>
                                        <TableHead>수령자</TableHead>
                                        <TableHead>처리 필요</TableHead>
                                        <TableHead className="text-right">결제금액</TableHead>
                                        <TableHead className="text-right">작업</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {selectedRows.map(({ order, issue }) => (
                                        <TableRow key={order.id}>
                                            <TableCell className="min-w-72">
                                                <div className="font-semibold">{order.product.name}</div>
                                                <div className="mt-1 font-mono text-xs text-muted-foreground">{order.marketOrderId}</div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="font-medium">{MARKET_LABELS[order.marketType]}</div>
                                                <div className="text-xs text-muted-foreground">{order.storeName}</div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="font-medium">{order.recipient.name}</div>
                                                <div className="text-xs text-muted-foreground">{order.recipient.phone}</div>
                                            </TableCell>
                                            <TableCell className="min-w-64">
                                                {issue ? (
                                                    <div className="space-y-1">
                                                        <Badge variant="outline">{issue.label}</Badge>
                                                        <p className="text-xs leading-5 text-muted-foreground">{issue.detail}</p>
                                                    </div>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                                                        <CheckCircle2 className="size-4" /> 정상 진행
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap text-right font-semibold">
                                                {order.paymentPrice.toLocaleString("ko-KR")}원
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex min-w-max justify-end gap-2">
                                                    {issue ? (
                                                        <>
                                                            <Button size="sm" variant="ghost" onClick={() => dismissIssue(order.id)}>
                                                                이슈 아님
                                                            </Button>
                                                            <Button size="sm" variant="outline" onClick={() => snoozeIssue(order.id)}>
                                                                <Clock3 />
                                                                2시간 미루기
                                                            </Button>
                                                        </>
                                                    ) : null}
                                                    <Button asChild size="sm">
                                                        <Link href={orderJourneyTargetHref(selectedStatus, issue?.code)}>처리하기</Link>
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <Empty className="min-h-72">
                            <EmptyHeader>
                                <EmptyMedia variant="icon"><CheckCircle2 /></EmptyMedia>
                                <EmptyTitle>이 상태의 주문이 없습니다</EmptyTitle>
                                <EmptyDescription>검색어나 이슈 필터를 바꾸거나 다른 상태를 선택해 보세요.</EmptyDescription>
                            </EmptyHeader>
                        </Empty>
                    )}
                </CardContent>
            </Card>

            <IssueSettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                settings={issueSettings}
                onChange={setIssueSettings}
            />
        </div>
    );
}

function IssueSettingsDialog({
    open,
    onOpenChange,
    settings,
    onChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    settings: IssueSettings;
    onChange: (settings: IssueSettings) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>이슈 기준 설정</DialogTitle>
                    <DialogDescription>
                        주문현황에서 처리 필요로 집계할 운영 조건을 선택합니다. 이 데모 설정은 현재 브라우저 화면에만 적용됩니다.
                    </DialogDescription>
                </DialogHeader>
                <div className="divide-y rounded-lg border">
                    {(Object.keys(ISSUE_SETTING_LABELS) as OrderJourneyIssueCode[]).map((code) => {
                        const item = ISSUE_SETTING_LABELS[code];
                        return (
                            <div key={code} className="flex items-start justify-between gap-5 p-4">
                                <div>
                                    <Label htmlFor={`issue-${code}`} className="font-semibold">{item.title}</Label>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
                                </div>
                                <Switch
                                    id={`issue-${code}`}
                                    checked={settings[code]}
                                    onCheckedChange={(checked) => onChange({ ...settings, [code]: checked })}
                                />
                            </div>
                        );
                    })}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onChange(DEFAULT_ISSUE_SETTINGS)}>기본값 복원</Button>
                    <Button onClick={() => onOpenChange(false)}>적용</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function createEmptyStatusCounts(): Record<OrderJourneyStatus, { total: number; issues: number }> {
    return Object.fromEntries(
        ORDER_JOURNEY_GROUPS.flatMap((group) => (
            group.statuses.map((status) => [status.id, { total: 0, issues: 0 }])
        )),
    ) as Record<OrderJourneyStatus, { total: number; issues: number }>;
}
