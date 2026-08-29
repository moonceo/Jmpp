"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    Clock3,
    FlaskConical,
    LoaderCircle,
    RefreshCw,
    Search,
    ShieldAlert,
    Truck,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { withBrowserSecurity } from "@/lib/client/http";
import {
    DEMO_BUYER_CLAIMS,
    DEMO_SELLER_CANCEL_CLAIMS,
    DEMO_SELLER_CANCEL_STORAGE_KEY,
    type DemoClaimAction,
    type DemoClaimDetail,
} from "@/lib/mock-data/claims";
import { cn } from "@/lib/utils";
import type {
    ClaimCursorPage,
    ClaimDetail,
    ClaimListItem,
    ClaimRequester,
    ClaimStatus,
    ClaimType,
    PurchaseCompensationStatus,
} from "@/lib/server/claims/types";

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
type ClaimTypeFilter = ClaimType | "ALL";
type ClaimStatusFilter = ClaimStatus | "ALL";
type DeadlineFilter = "ALL" | "OVERDUE" | "DUE_24H";
type MarketFilter = "ALL" | "NAVER" | "COUPANG";
type PeriodFilter = "TODAY" | "3D" | "7D" | "30D" | "ALL";
type ClaimStageFilter = "ALL" | "NEW" | "PROCESSING" | "COMPLETED";
type RequesterFilter = "ALL" | "CUSTOMER" | "SELLER";

const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
    CANCEL: "취소",
    RETURN: "반품",
    EXCHANGE: "교환",
};

const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
    REQUESTED: "요청 접수",
    UNDER_REVIEW: "확인 중",
    APPROVAL_PENDING: "승인 대기",
    APPROVED: "승인",
    REJECTED: "거부",
    ON_HOLD: "보류",
    COLLECTION_PENDING: "회수 대기",
    IN_TRANSIT: "회수 중",
    RECEIVED: "회수 완료",
    REFUND_PENDING: "환불 대기",
    REFUNDED: "환불 완료",
    REPLACEMENT_PENDING: "교환 발송 대기",
    REPLACEMENT_SHIPPED: "교환 발송",
    WITHDRAWN: "철회",
    COMPLETED: "처리 완료",
};

const PURCHASE_COMPENSATION_LABELS: Record<PurchaseCompensationStatus, string> = {
    NOT_REQUIRED: "후속조치 없음",
    PENDING: "소싱환불 요청 대기",
    IN_PROGRESS: "소싱라이프 처리 중",
    SUCCEEDED: "소싱환불 완료",
    FAILED: "소싱환불 실패",
    NEEDS_ATTENTION: "소싱환불 검토 필요",
    UNKNOWN: "결과 확인 필요",
};

export function getSourcingCompensationGuidance(status: PurchaseCompensationStatus): string {
    if (status === "NOT_REQUIRED") return "이 클레임에 연결된 소싱 구매 후속조치가 없습니다.";
    if (status === "SUCCEEDED") return "소싱 구매금액 회수가 완료됐습니다. 마켓 환불 완료 여부는 별도로 확인하세요.";
    if (status === "PENDING" || status === "IN_PROGRESS") return "소싱라이프 처리 결과와 예상 환불금·차감비용을 기다리는 중입니다.";
    if (status === "NEEDS_ATTENTION") return "소싱 결제완료 상품이므로 마켓 처리와 별도로 소싱환불을 검토해야 합니다.";
    return "소싱라이프 응답과 커머스라이프 기록을 대사해 후속조치를 결정하세요.";
}

const MARKET_LABELS = {
    NAVER: "네이버 스마트스토어",
    COUPANG: "쿠팡",
    ELEVEN_STREET: "11번가",
    GMARKET: "지마켓",
    AUCTION: "옥션",
} as const;

const NEW_CLAIM_STATUSES = new Set<ClaimStatus>(["REQUESTED", "UNDER_REVIEW", "APPROVAL_PENDING"]);
const COMPLETED_CLAIM_STATUSES = new Set<ClaimStatus>(["REJECTED", "REFUNDED", "REPLACEMENT_SHIPPED", "WITHDRAWN", "COMPLETED"]);

const CLAIM_STAGE_LABELS: Record<ClaimStageFilter, string> = {
    ALL: "전체",
    NEW: "신규요청",
    PROCESSING: "처리중",
    COMPLETED: "완료",
};

const REQUESTER_LABELS: Record<ClaimRequester, string> = {
    CUSTOMER: "구매자 신청",
    SELLER: "판매자 직접취소",
    MARKET: "마켓 접수",
    INTERNAL: "내부 접수",
    UNKNOWN: "접수 주체 미확인",
};

const PERIOD_OPTIONS: Array<{ value: PeriodFilter; label: string; days?: number }> = [
    { value: "TODAY", label: "오늘", days: 0 },
    { value: "3D", label: "3일", days: 3 },
    { value: "7D", label: "7일", days: 7 },
    { value: "30D", label: "30일", days: 30 },
    { value: "ALL", label: "전체" },
];

const DEMO_ACTION_RAW_STATUS: Partial<Record<DemoClaimAction["key"], string>> = {
    RETURN_RECEIVE: "VENDOR_WAREHOUSE_CONFIRM",
    APPROVE_RETURN: "RETURN_APPROVED",
    EXCHANGE_RECEIVE: "REDELIVERY",
    DISPATCH_EXCHANGE: "REPLACEMENT_SHIPPED",
    STOP_SHIPMENT: "CANCEL_COMPLETE",
    ALREADY_SHIPPED: "RETURNS_UNCHECKED",
};

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
});

export function formatClaimDateTime(value: string | null): string {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : dateTimeFormatter.format(date);
}

export function buildClaimsUrl(input: {
    cursor?: string | null;
    claimType: ClaimTypeFilter;
    status: ClaimStatusFilter;
    requester: ClaimRequester | "ALL";
    deadlineBefore: string | null;
    activeOnly: boolean;
    search: string;
}): string {
    const query = new URLSearchParams({ limit: "50" });
    if (input.cursor) query.set("cursor", input.cursor);
    if (input.claimType !== "ALL") query.set("claimType", input.claimType);
    if (input.status !== "ALL") query.set("status", input.status);
    if (input.requester !== "ALL") query.set("requesterType", input.requester);
    if (input.deadlineBefore) query.set("deadlineBefore", input.deadlineBefore);
    if (input.activeOnly) query.set("activeOnly", "true");
    if (input.search.trim()) query.set("search", input.search.trim());
    return `/api/claims?${query.toString()}`;
}

async function apiGet<T>(url: string): Promise<T> {
    const response = await fetch(url, withBrowserSecurity());
    const envelope = await response.json() as ApiEnvelope<T>;
    if (!response.ok || envelope.data === undefined) {
        if (response.status === 401) window.location.assign(`/login?next=${encodeURIComponent("/orders?view=claims")}`);
        throw new Error(envelope.error?.message ?? "클레임 정보를 불러오지 못했습니다.");
    }
    return envelope.data;
}

function typeBadgeClass(type: ClaimType): string {
    if (type === "CANCEL") return "border-border bg-muted text-foreground";
    if (type === "RETURN") return "border-border bg-muted text-foreground";
    return "border-border bg-muted text-foreground";
}

function statusBadgeClass(status: ClaimStatus): string {
    if (["COMPLETED", "REFUNDED", "REPLACEMENT_SHIPPED"].includes(status)) return "border-border bg-muted text-foreground";
    if (["REJECTED", "WITHDRAWN"].includes(status)) return "border-border bg-muted text-muted-foreground";
    if (status === "ON_HOLD") return "border-border bg-muted text-foreground";
    return "border-border bg-muted text-foreground";
}

function deadlineLabel(claim: ClaimListItem): string {
    if (!claim.deadlineAt) return "마감 없음";
    return `${claim.deadlineOverdue ? "기한 초과 · " : ""}${formatClaimDateTime(claim.deadlineAt)}`;
}

export function claimEntryActionLabel(claimType: ClaimType): string {
    return `${CLAIM_TYPE_LABELS[claimType]}처리`;
}

function claimStage(status: ClaimStatus): Exclude<ClaimStageFilter, "ALL"> {
    if (NEW_CLAIM_STATUSES.has(status)) return "NEW";
    if (COMPLETED_CLAIM_STATUSES.has(status)) return "COMPLETED";
    return "PROCESSING";
}

export function getBuyerClaimActions(claim: Pick<ClaimDetail, "marketCode" | "claimType" | "normalizedStatus" | "marketStatusRaw"> & Partial<Pick<ClaimDetail, "requesterType">>): DemoClaimAction[] {
    if (claim.requesterType && claim.requesterType !== "CUSTOMER") return [];

    const apiAction = (
        key: DemoClaimAction["key"],
        label: string,
        description: string,
        nextStatus: ClaimStatus,
        tone: DemoClaimAction["tone"] = "primary",
    ): DemoClaimAction => ({
        key,
        label,
        description,
        nextStatus,
        tone,
        requiresTracking: key === "DISPATCH_EXCHANGE",
    });
    const status = claim.normalizedStatus;

    if (claim.marketCode === "NAVER") {
        if (claim.claimType === "CANCEL" && ["REQUESTED", "UNDER_REVIEW", "APPROVAL_PENDING"].includes(status)) {
            return [apiAction("APPROVE_CANCEL", "취소 승인", "네이버 구매자 취소 승인 API 대상입니다.", "COMPLETED")];
        }
        if (claim.claimType === "RETURN") {
            if (["COLLECTION_PENDING", "IN_TRANSIT"].includes(status)) {
                return [apiAction("HOLD", "반품 보류", "네이버 반품 보류 API 대상입니다.", "ON_HOLD", "secondary")];
            }
            if (status === "RECEIVED") return [
                apiAction("APPROVE_RETURN", "반품 승인", "네이버 반품 승인 API 대상입니다.", "REFUND_PENDING"),
                apiAction("HOLD", "반품 보류", "네이버 반품 보류 API 대상입니다.", "ON_HOLD", "secondary"),
            ];
            if (status === "ON_HOLD") return [
                apiAction("RELEASE_HOLD", "보류 해제", "네이버 반품 보류 해제 API 대상입니다.", "RECEIVED"),
                apiAction("REJECT_RETURN", "반품 거부", "네이버 반품 거부 API 대상입니다.", "REJECTED", "secondary"),
            ];
        }
        if (claim.claimType === "EXCHANGE") {
            if (status === "IN_TRANSIT") return [apiAction("EXCHANGE_RECEIVE", "교환 수거 완료", "네이버 교환 수거 완료 API 대상입니다.", "REPLACEMENT_PENDING")];
            if (["RECEIVED", "REPLACEMENT_PENDING"].includes(status)) return [
                apiAction("DISPATCH_EXCHANGE", "교환품 재배송", "네이버 교환 재배송 API 대상입니다.", "REPLACEMENT_SHIPPED"),
                apiAction("HOLD", "교환 보류", "네이버 교환 보류 API 대상입니다.", "ON_HOLD", "secondary"),
            ];
            if (status === "ON_HOLD") return [
                apiAction("RELEASE_HOLD", "보류 해제", "네이버 교환 보류 해제 API 대상입니다.", "RECEIVED"),
                apiAction("REJECT_EXCHANGE", "교환 거부", "네이버 교환 거부 API 대상입니다.", "REJECTED", "secondary"),
            ];
        }
    }

    if (claim.marketCode === "COUPANG") {
        if (claim.claimType === "CANCEL" && ["REQUESTED", "UNDER_REVIEW", "APPROVAL_PENDING"].includes(status)) {
            return [
                apiAction("STOP_SHIPMENT", "출고중지 완료", "쿠팡 출고중지 완료 API 대상입니다.", "COMPLETED"),
                apiAction("ALREADY_SHIPPED", "이미출고 처리", "쿠팡 이미출고 API 대상이며 반품 접수로 전환됩니다.", "COLLECTION_PENDING", "secondary"),
            ];
        }
        if (claim.claimType === "RETURN") {
            if (claim.marketStatusRaw === "RETURNS_UNCHECKED") {
                return [apiAction("RETURN_RECEIVE", "반품 입고 확인", "쿠팡 반품상품 입고 확인 API 대상입니다.", "APPROVAL_PENDING")];
            }
            if (claim.marketStatusRaw === "VENDOR_WAREHOUSE_CONFIRM") {
                return [apiAction("APPROVE_RETURN", "반품 승인", "쿠팡 반품요청 승인 API 대상입니다.", "REFUND_PENDING")];
            }
        }
        if (claim.claimType === "EXCHANGE") {
            if (status === "RECEIVED") return [apiAction("EXCHANGE_RECEIVE", "교환 입고 확인", "쿠팡 교환요청상품 입고 확인 API 대상입니다.", "REPLACEMENT_PENDING")];
            if (status === "REPLACEMENT_PENDING") return [apiAction("DISPATCH_EXCHANGE", "교환 송장 등록", "쿠팡 교환상품 송장 업로드 API 대상입니다.", "REPLACEMENT_SHIPPED")];
            if (status === "ON_HOLD") return [apiAction("REJECT_EXCHANGE", "교환 거부", "쿠팡 교환요청 거부 API 대상입니다.", "REJECTED", "secondary")];
        }
    }

    return [];
}

export function ClaimsPageClient() {
    const [demoMode, setDemoMode] = useState(true);
    const [demoClaims, setDemoClaims] = useState<DemoClaimDetail[]>([
        ...DEMO_SELLER_CANCEL_CLAIMS,
        ...DEMO_BUYER_CLAIMS,
    ]);
    const [claimType, setClaimType] = useState<ClaimTypeFilter>("ALL");
    const [status, setStatus] = useState<ClaimStatusFilter>("ALL");
    const [market, setMarket] = useState<MarketFilter>("ALL");
    const [period, setPeriod] = useState<PeriodFilter>("7D");
    const [stage, setStage] = useState<ClaimStageFilter>("ALL");
    const [requester, setRequester] = useState<RequesterFilter>("ALL");
    const [deadline, setDeadline] = useState<DeadlineFilter>("ALL");
    const [deadlineBefore, setDeadlineBefore] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);
    const [filterReferenceTime] = useState(() => Date.now());
    const deferredSearch = useDeferredValue(search);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            try {
                const stored = window.localStorage.getItem(DEMO_SELLER_CANCEL_STORAGE_KEY);
                const parsed: unknown = stored ? JSON.parse(stored) : [];
                if (!Array.isArray(parsed)) return;

                const storedClaims = parsed as DemoClaimDetail[];
                setDemoClaims((current) => {
                    const storedOrderIds = new Set(storedClaims.map((claim) => claim.salesOrderId));
                    return [...storedClaims, ...current.filter((claim) => !storedOrderIds.has(claim.salesOrderId))];
                });
            } catch {
                // A damaged demo cache must not block the built-in claim scenarios.
            }
        }, 0);

        return () => window.clearTimeout(timer);
    }, []);

    const listQuery = useInfiniteQuery({
        queryKey: ["claims", claimType, status, requester, deadlineBefore, deferredSearch.trim()],
        initialPageParam: null as string | null,
        queryFn: ({ pageParam }) => apiGet<ClaimCursorPage>(buildClaimsUrl({
            cursor: pageParam,
            claimType,
            status,
            requester,
            deadlineBefore,
            activeOnly: deadline !== "ALL",
            search: deferredSearch,
        })),
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        retry: false,
        enabled: !demoMode,
    });

    const detailQuery = useQuery({
        queryKey: ["claim-detail", selectedClaimId],
        queryFn: () => apiGet<ClaimDetail>(`/api/claims/${selectedClaimId}`),
        enabled: !demoMode && Boolean(selectedClaimId),
        retry: false,
    });

    const claims = useMemo(() => {
        const source = demoMode ? demoClaims : listQuery.data?.pages.flatMap((page) => page.items) ?? [];
        const term = deferredSearch.trim().toLowerCase();
        const selectedPeriod = PERIOD_OPTIONS.find((option) => option.value === period);
        const cutoff = selectedPeriod?.days === undefined
            ? null
            : new Date(filterReferenceTime - selectedPeriod.days * 86_400_000);
        if (cutoff && selectedPeriod?.days === 0) cutoff.setHours(0, 0, 0, 0);

        return source.filter((claim) => {
            if (claimType !== "ALL" && claim.claimType !== claimType) return false;
            if (status !== "ALL" && claim.normalizedStatus !== status) return false;
            if (requester !== "ALL" && claim.requesterType !== requester) return false;
            if (market !== "ALL" && claim.marketCode !== market) return false;
            if (stage !== "ALL" && claimStage(claim.normalizedStatus) !== stage) return false;
            if (cutoff && new Date(claim.requestedAt) < cutoff) return false;
            if (deadline === "OVERDUE" && !claim.deadlineOverdue) return false;
            if (deadline === "DUE_24H" && (!claim.deadlineAt || new Date(claim.deadlineAt).getTime() > filterReferenceTime + 86_400_000)) return false;
            if (!term) return true;
            return [claim.externalOrderNumber, claim.externalClaimId, claim.storeName, (claim as Partial<ClaimDetail>).lines?.[0]?.productName]
                .some((value) => value?.toLowerCase().includes(term));
        });
    }, [claimType, deadline, deferredSearch, demoClaims, demoMode, filterReferenceTime, listQuery.data, market, period, requester, stage, status]);

    const selectedDemoClaim = demoMode
        ? demoClaims.find((claim) => claim.id === selectedClaimId) ?? null
        : null;
    const sourceClaims = demoMode ? demoClaims : listQuery.data?.pages.flatMap((page) => page.items) ?? [];
    const stageCounts = {
        ALL: sourceClaims.length,
        NEW: sourceClaims.filter((claim) => claimStage(claim.normalizedStatus) === "NEW").length,
        PROCESSING: sourceClaims.filter((claim) => claimStage(claim.normalizedStatus) === "PROCESSING").length,
        COMPLETED: sourceClaims.filter((claim) => claimStage(claim.normalizedStatus) === "COMPLETED").length,
    };

    function changeMode(nextDemoMode: boolean): void {
        setDemoMode(nextDemoMode);
        setSelectedClaimId(null);
    }

    function runDemoAction(action: DemoClaimAction, carrier?: string, trackingNumber?: string): void {
        if (!selectedDemoClaim) return;
        if (!action.nextStatus) return;
        const now = new Date().toISOString();
        setDemoClaims((current) => current.map((claim) => claim.id !== selectedDemoClaim.id ? claim : {
            ...claim,
            normalizedStatus: action.nextStatus as ClaimStatus,
            marketStatusRaw: DEMO_ACTION_RAW_STATUS[action.key] ?? `DEMO_${action.key}`,
            sourceUpdatedAt: now,
            deadlineOverdue: false,
            lines: claim.lines.map((line) => ({ ...line, normalizedStatus: action.nextStatus as ClaimStatus })),
            events: [{
                id: `demo-${claim.events.length + 1}-${claim.id}`,
                externalEventId: null,
                eventType: `DEMO_${action.key}`,
                eventSource: "INTERNAL_DEMO",
                fromStatus: claim.normalizedStatus,
                toStatus: action.nextStatus,
                marketStatusRaw: null,
                marketReasonCode: null,
                sourceOccurredAt: now,
                receivedAt: now,
            }, ...claim.events],
            workflow: {
                ...claim.workflow,
                stage: action.label + " 완료 (데모)",
                nextWork: "실서비스에서는 마켓 응답을 다시 수집해 최종 상태를 확정합니다.",
                risk: null,
                replacementShipment: action.requiresTracking ? `${carrier} / ${trackingNumber}` : claim.workflow.replacementShipment,
            },
        }));
        toast.success(`${action.label}을 로컬 데모에 반영했습니다. 마켓에는 전송되지 않았습니다.`);
    }

    function runDemoSourcingRefund(): void {
        if (!selectedDemoClaim || selectedDemoClaim.claimType === "EXCHANGE") return;
        const now = new Date().toISOString();
        setDemoClaims((current) => current.map((claim) => claim.id !== selectedDemoClaim.id ? claim : {
            ...claim,
            purchaseCompensationStatus: "PENDING",
            purchaseCompensationReference: claim.purchaseCompensationReference ?? `SL-REFUND-${claim.externalClaimId}`,
            purchaseCompensationNextActionAt: now,
            sourceUpdatedAt: now,
            events: [{
                id: `demo-sourcing-refund-${claim.id}`,
                externalEventId: null,
                eventType: "SOURCING_REFUND_REQUESTED",
                eventSource: "INTERNAL_DEMO",
                fromStatus: claim.normalizedStatus,
                toStatus: claim.normalizedStatus,
                marketStatusRaw: null,
                marketReasonCode: null,
                sourceOccurredAt: now,
                receivedAt: now,
            }, ...claim.events],
        }));
        toast.success("소싱환불 후속조치를 접수했습니다. 마켓 클레임 상태는 변경하지 않았습니다.");
    }

    const isPending = !demoMode && listQuery.isPending;
    const isError = !demoMode && listQuery.isError;

    return (
        <div className="min-h-full p-4 sm:p-6 lg:p-8">
            <PageHeader
                title="취소·반품·교환"
                eyebrow="COMMERCE LIFE · CLAIMS DESK"
                description="구매자 클레임과 판매자 직접취소를 접수 주체와 진행 단계에 따라 한 작업함에서 관리합니다."
            />

            <Card className="mt-6 gap-0 overflow-hidden py-0">
            <CardHeader className="space-y-3 border-b border-border p-4 sm:p-5">
                <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <ToggleGroup type="single" variant="outline" size="sm" value={period} onValueChange={(value) => value && setPeriod(value as PeriodFilter)}>
                            {PERIOD_OPTIONS.map((option) => (
                                <ToggleGroupItem
                                    key={option.value}
                                    value={option.value}
                                    className="font-bold"
                                >
                                    {option.label}
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                        <label className="relative min-w-[280px] flex-1 xl:max-w-[380px]">
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="상품명, 주문번호, 클레임 ID 검색" className="h-8 border-border bg-card pl-9 text-sm shadow-sm" />
                        </label>
                        <FilterSelect value={market} onValueChange={(value) => setMarket(value as MarketFilter)} compact>
                            <SelectItem value="ALL">마켓 전체</SelectItem>
                            <SelectItem value="NAVER">네이버</SelectItem>
                            <SelectItem value="COUPANG">쿠팡</SelectItem>
                        </FilterSelect>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-2">
                        <Button size="sm" variant={demoMode ? "outline" : "default"} className="h-8" onClick={() => changeMode(!demoMode)}>
                            {demoMode ? <ShieldAlert className="size-3.5" /> : <FlaskConical className="size-3.5" />}
                            {demoMode ? "실데이터 조회" : "데모 보기"}
                        </Button>
                        {!demoMode ? <Button size="sm" variant="outline" className="h-8" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}><RefreshCw className={cn("size-3.5", listQuery.isFetching && "animate-spin")} />새로고침</Button> : null}
                    </div>
                </div>

                <ToggleGroup type="single" variant="outline" value={stage} onValueChange={(value) => value && setStage(value as ClaimStageFilter)} className="flex-wrap">
                    {(Object.keys(CLAIM_STAGE_LABELS) as ClaimStageFilter[]).map((value) => (
                        <ToggleGroupItem
                            key={value}
                            value={value}
                            className="font-bold"
                        >
                            <span>{CLAIM_STAGE_LABELS[value]}</span>
                            <Badge variant="outline">{stageCounts[value]}</Badge>
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>

                <div className="flex flex-wrap items-center justify-end gap-2">
                    <FilterSelect value={requester} onValueChange={(value) => setRequester(value as RequesterFilter)}>
                        <SelectItem value="ALL">접수 주체 전체</SelectItem>
                        <SelectItem value="CUSTOMER">구매자 신청</SelectItem>
                        <SelectItem value="SELLER">판매자 직접취소</SelectItem>
                    </FilterSelect>
                    <FilterSelect value={claimType} onValueChange={(value) => setClaimType(value as ClaimTypeFilter)}>
                        <SelectItem value="ALL">유형 전체</SelectItem>
                        {Object.entries(CLAIM_TYPE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </FilterSelect>
                    <FilterSelect value={status} onValueChange={(value) => setStatus(value as ClaimStatusFilter)}>
                        <SelectItem value="ALL">상태 전체</SelectItem>
                        {Object.entries(CLAIM_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </FilterSelect>
                    <FilterSelect value={deadline} onValueChange={(value) => {
                        const next = value as DeadlineFilter;
                        setDeadline(next);
                        setDeadlineBefore(next === "ALL" ? null : new Date(Date.now() + (next === "DUE_24H" ? 86_400_000 : 0)).toISOString());
                    }}>
                        <SelectItem value="ALL">처리기한 전체</SelectItem>
                        <SelectItem value="OVERDUE">기한 초과</SelectItem>
                        <SelectItem value="DUE_24H">24시간 이내</SelectItem>
                    </FilterSelect>
                </div>
            </CardHeader>

            <CardContent className="p-4 sm:p-5">
                {isPending ? <LoadingState /> : isError ? (
                    <ErrorState message={listQuery.error.message} onRetry={() => listQuery.refetch()} />
                ) : claims.length === 0 ? (
                    <Empty className="min-h-72 border"><EmptyHeader><EmptyDescription>조건에 맞는 취소·반품·교환 내역이 없습니다.</EmptyDescription></EmptyHeader></Empty>
                ) : <ClaimsTable claims={claims} onOpen={setSelectedClaimId} />}
                {!demoMode && listQuery.hasNextPage ? <div className="flex justify-center border-t border-border pt-4"><Button variant="outline" onClick={() => listQuery.fetchNextPage()} disabled={listQuery.isFetchingNextPage}>다음 50건 불러오기</Button></div> : null}
            </CardContent>
            </Card>

            <ClaimDetailDialog
                claimId={selectedClaimId}
                claim={selectedDemoClaim ?? detailQuery.data ?? null}
                demoMode={demoMode}
                loading={!demoMode && detailQuery.isPending && Boolean(selectedClaimId)}
                error={!demoMode && detailQuery.isError ? detailQuery.error.message : null}
                onOpenChange={(open) => { if (!open) setSelectedClaimId(null); }}
                onRetry={() => detailQuery.refetch()}
                onDemoAction={runDemoAction}
                onDemoSourcingRefund={runDemoSourcingRefund}
            />
        </div>
    );
}

function FilterSelect({ children, compact = false, ...props }: React.ComponentProps<typeof Select> & { compact?: boolean }) {
    return <Select {...props}><SelectTrigger className={cn("border-border bg-card shadow-sm", compact ? "h-8 w-[130px] text-xs" : "h-10 w-[150px]")}><SelectValue /></SelectTrigger><SelectContent>{children}</SelectContent></Select>;
}

function LoadingState() {
    return <Empty className="min-h-72"><EmptyHeader><EmptyMedia variant="icon"><LoaderCircle className="size-5 animate-spin" /></EmptyMedia><EmptyDescription>클레임을 불러오는 중입니다.</EmptyDescription></EmptyHeader></Empty>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <Empty className="min-h-72">
            <EmptyHeader><EmptyMedia variant="icon"><AlertTriangle /></EmptyMedia><EmptyTitle>클레임을 불러오지 못했습니다.</EmptyTitle><EmptyDescription>{message}</EmptyDescription></EmptyHeader>
            <EmptyContent><Button variant="outline" onClick={onRetry}>다시 시도</Button></EmptyContent>
        </Empty>
    );
}

function ClaimsTable({ claims, onOpen }: { claims: ClaimListItem[]; onOpen: (id: string) => void }) {
    return (
        <div className="overflow-x-auto rounded-md border border-border bg-card shadow-sm">
        <Table className="min-w-[1080px] table-fixed">
            <TableHeader><TableRow className="border-b border-border bg-muted hover:bg-muted">
                <TableHead className="h-9 w-[230px] px-2.5 text-xs font-semibold text-muted-foreground">마켓 / 주문</TableHead>
                <TableHead className="h-9 w-[180px] px-2.5 text-xs font-semibold text-muted-foreground">유형 / 상태</TableHead>
                <TableHead className="h-9 w-[170px] px-2.5 text-xs font-semibold text-muted-foreground">접수 주체 / 사유</TableHead>
                <TableHead className="h-9 w-[250px] px-2.5 text-xs font-semibold text-muted-foreground">대상 상품</TableHead>
                <TableHead className="h-9 w-[170px] px-2.5 text-xs font-semibold text-muted-foreground">처리기한</TableHead>
                <TableHead className="h-9 w-[120px] px-2.5 text-right text-xs font-semibold text-muted-foreground">처리</TableHead>
            </TableRow></TableHeader>
            <TableBody>{claims.map((claim) => (
                <TableRow key={claim.id} className="group border-b border-border transition-colors odd:bg-card even:bg-muted/35 hover:bg-muted/60">
                    <TableCell className="px-2.5 py-2 align-top"><div className="text-sm font-bold text-foreground">{MARKET_LABELS[claim.marketCode]} · {claim.storeName}</div><div className="mt-1 truncate font-mono text-xs text-muted-foreground">{claim.externalOrderNumber ?? claim.externalOrderId}</div></TableCell>
                    <TableCell className="px-2.5 py-2 align-top"><div className="flex items-center gap-1.5"><Badge variant="outline" className={typeBadgeClass(claim.claimType)}>{CLAIM_TYPE_LABELS[claim.claimType]}</Badge><Badge variant="outline" className={statusBadgeClass(claim.normalizedStatus)}>{CLAIM_STATUS_LABELS[claim.normalizedStatus]}</Badge></div><div className="mt-1 truncate font-mono text-xs text-muted-foreground">{claim.externalClaimId}</div></TableCell>
                    <TableCell className="px-2.5 py-2 align-top"><div className="text-sm font-semibold text-foreground">{REQUESTER_LABELS[claim.requesterType]}</div><div className="mt-1 truncate text-xs text-muted-foreground">{claim.marketReasonMasked ?? claim.marketReasonCode ?? "사유 없음"}</div></TableCell>
                    <TableCell className="px-2.5 py-2 align-top"><div className="truncate text-sm font-semibold text-foreground">{(claim as ClaimDetail).lines?.[0]?.productName ?? `${claim.affectedLineCount}개 상품`}</div><div className="mt-1 text-xs text-muted-foreground">요청 수량 {claim.totalClaimQuantity}개</div></TableCell>
                    <TableCell className="px-2.5 py-2 align-top"><div className={cn("flex items-center gap-1.5 text-xs font-bold", claim.deadlineOverdue ? "text-foreground" : "text-foreground")}><Clock3 className="size-3.5" />{deadlineLabel(claim)}</div><div className="mt-1 text-xs text-muted-foreground">접수 {formatClaimDateTime(claim.requestedAt)}</div></TableCell>
                    <TableCell className="px-2.5 py-2 text-right align-top"><Button size="sm" variant="outline" className="h-8 text-xs font-bold" onClick={() => onOpen(claim.id)}>{claim.requesterType === "SELLER" ? "상세보기" : claimEntryActionLabel(claim.claimType)} <ArrowRight className="size-3.5" /></Button></TableCell>
                </TableRow>
            ))}</TableBody>
        </Table>
        </div>
    );
}

function ClaimDetailDialog({ claimId, claim, demoMode, loading, error, onOpenChange, onRetry, onDemoAction, onDemoSourcingRefund }: {
    claimId: string | null;
    claim: ClaimDetail | null;
    demoMode: boolean;
    loading: boolean;
    error: string | null;
    onOpenChange: (open: boolean) => void;
    onRetry: () => void;
    onDemoAction: (action: DemoClaimAction, carrier?: string, trackingNumber?: string) => void;
    onDemoSourcingRefund: () => void;
}) {
    const [carrier, setCarrier] = useState("");
    const [trackingNumber, setTrackingNumber] = useState("");
    const workflow = demoMode && claim ? (claim as DemoClaimDetail).workflow : null;
    const actions = claim ? getBuyerClaimActions(claim) : [];

    function runAction(action: DemoClaimAction): void {
        if (!claim) return;
        if (demoMode) {
            onDemoAction(action, carrier, trackingNumber);
            return;
        }
        toast.error(`${action.label} API 실행 어댑터가 아직 연결되지 않았습니다.`);
    }

    return (
        <Dialog open={Boolean(claimId)} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[92svh] overflow-y-auto p-0 sm:max-w-5xl">
                <DialogHeader className="sticky top-0 z-10 border-b border-border bg-card px-6 py-5 text-left">
                    <DialogTitle className="text-xl font-black">{claim ? (claim.requesterType === "SELLER" ? "판매자 직접취소 상세" : claimEntryActionLabel(claim.claimType)) : "클레임 처리"}</DialogTitle>
                    <DialogDescription>{demoMode ? "마켓 미전송 MVP 시뮬레이션" : "마켓에서 수집한 읽기 전용 정보"}</DialogDescription>
                </DialogHeader>
                {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={onRetry} /> : claim ? (
                    <div className="space-y-6 p-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div><div className="flex gap-2"><Badge variant="outline" className={typeBadgeClass(claim.claimType)}>{CLAIM_TYPE_LABELS[claim.claimType]}</Badge><Badge variant="outline" className={statusBadgeClass(claim.normalizedStatus)}>{CLAIM_STATUS_LABELS[claim.normalizedStatus]}</Badge>{claim.deadlineOverdue ? <Badge className="bg-primary">기한 초과</Badge> : null}</div><h2 className="mt-3 text-lg font-black">{MARKET_LABELS[claim.marketCode]} · {claim.storeName}</h2><p className="mt-1 font-mono text-xs text-muted-foreground">주문 {claim.externalOrderNumber ?? claim.externalOrderId} / 클레임 {claim.externalClaimId}</p></div>
                            <div className="rounded-md border bg-muted px-4 py-3 text-right"><div className="text-xs font-bold text-muted-foreground">처리기한</div><div className={cn("mt-1 font-black", claim.deadlineOverdue && "text-foreground")}>{deadlineLabel(claim)}</div></div>
                        </div>

                        {workflow ? (
                            <section className="rounded-lg border border-border bg-muted p-4">
                                <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-5 text-foreground" /><div><div className="text-xs font-bold text-foreground">현재 단계</div><div className="font-black text-foreground">{workflow.stage}</div><p className="mt-2 text-sm text-foreground"><strong>다음 작업:</strong> {workflow.nextWork}</p>{workflow.risk ? <p className="mt-2 text-xs font-bold text-foreground">주의: {workflow.risk}</p> : null}</div></div>
                            </section>
                        ) : null}

                        <section><SectionTitle title="접수 정보" description={claim.requesterType === "SELLER" ? "주문수집 화면에서 판매자가 직접 취소한 기록" : "구매자가 마켓에서 신청한 원문 기준"} /><div className="mt-3 grid overflow-hidden rounded-md border sm:grid-cols-2 lg:grid-cols-4"><SnapshotCell label="접수 주체" value={REQUESTER_LABELS[claim.requesterType]} /><SnapshotCell label="접수 사유" value={claim.marketReasonMasked ?? claim.marketReasonCode ?? "-"} /><SnapshotCell label="주문 상태" value={claim.orderStatusAtRequest} /><SnapshotCell label="배송 상태" value={claim.fulfillmentStatusAtRequest ?? "-"} /></div></section>

                        {workflow && (workflow.pickup || workflow.replacementShipment) ? (
                            <section><SectionTitle title="회수·재배송" description="기존 배송과 별도로 관리" /><div className="mt-3 grid gap-3 md:grid-cols-2">{workflow.pickup ? <InfoCard icon={<Truck className="size-4" />} label="회수 배송" value={workflow.pickup} /> : null}{workflow.replacementShipment ? <InfoCard icon={<Truck className="size-4" />} label="교환 재배송" value={workflow.replacementShipment} /> : null}</div></section>
                        ) : null}

                        <section><SectionTitle title="대상 상품" description={`상품 ${claim.affectedLineCount}개 · 요청 수량 ${claim.totalClaimQuantity}개`} /><div className="mt-3 overflow-hidden rounded-md border"><Table><TableHeader className="bg-muted"><TableRow><TableHead className="pl-4 font-extrabold">상품 / 옵션</TableHead><TableHead className="font-extrabold">요청 수량</TableHead><TableHead className="font-extrabold">상태</TableHead></TableRow></TableHeader><TableBody>{claim.lines.map((line) => <TableRow key={line.id}><TableCell className="py-3 pl-4"><div className="font-bold">{line.productName}</div><div className="mt-1 text-xs text-muted-foreground">{line.optionName ?? "옵션 없음"}</div></TableCell><TableCell className="font-black">{line.requestedQuantity} / {line.orderedQuantity}</TableCell><TableCell><Badge variant="outline" className={statusBadgeClass(line.normalizedStatus)}>{CLAIM_STATUS_LABELS[line.normalizedStatus]}</Badge></TableCell></TableRow>)}</TableBody></Table></div></section>

                        <section>
                            <SectionTitle title="처리 작업" description={demoMode ? "로컬 데모 · 마켓 미전송" : "실계정 UAT 전 실행 차단"} />
                            <div className={cn("mt-3 rounded-md border p-4", demoMode ? "border-border bg-muted" : "border-border bg-muted")}>
                                {actions.length ? <div className="space-y-3">{actions.map((action) => <ActionRow key={`${action.key}-${action.label}`} action={action} carrier={carrier} trackingNumber={trackingNumber} onCarrierChange={setCarrier} onTrackingChange={setTrackingNumber} onRun={(nextAction) => runAction(nextAction)} />)}</div> : <p className="text-sm font-bold text-muted-foreground">{demoMode ? "현재 상태에서 API로 처리할 작업이 없습니다." : "현재 상태에서 공식 API로 실행할 작업이 없습니다."}</p>}
                            </div>
                        </section>

                        <SourcingCompensationSection
                            claim={claim}
                            demoMode={demoMode}
                            onRequest={onDemoSourcingRefund}
                        />

                        <section><SectionTitle title="상태 이력" description={`${claim.events.length}건`} /><div className="mt-3 divide-y rounded-md border">{claim.events.map((event) => <div key={event.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[150px_1fr_auto]"><div className="font-mono text-xs text-muted-foreground">{formatClaimDateTime(event.sourceOccurredAt ?? event.receivedAt)}</div><div><div className="text-sm font-extrabold">{event.eventType}</div><div className="text-xs text-muted-foreground">{event.fromStatus ? CLAIM_STATUS_LABELS[event.fromStatus] : "-"} → {event.toStatus ? CLAIM_STATUS_LABELS[event.toStatus] : "-"}</div></div><Badge variant="outline" className="justify-self-start sm:justify-self-end">{event.eventSource}</Badge></div>)}</div></section>
                    </div>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

function SourcingCompensationSection({ claim, demoMode, onRequest }: { claim: ClaimDetail; demoMode: boolean; onRequest: () => void }) {
    const status = claim.purchaseCompensationStatus;
    const canRequest = claim.claimType !== "EXCHANGE" && ["NEEDS_ATTENTION", "FAILED", "UNKNOWN"].includes(status);

    return (
        <section>
            <SectionTitle title="소싱 구매 후속조치" description="마켓 클레임과 분리해 추적" />
            <div className="mt-3 flex flex-col gap-4 rounded-md border bg-muted p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="bg-card">{PURCHASE_COMPENSATION_LABELS[status]}</Badge>
                        <span className="font-mono text-xs text-muted-foreground">{claim.purchaseCompensationReference ?? "연결 참조 없음"}</span>
                    </div>
                    <p className="mt-2 text-sm leading-5 text-muted-foreground">{getSourcingCompensationGuidance(status)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">신청 당시 소싱 상태: {claim.sourcingStatusAtRequest}</p>
                </div>
                {canRequest ? (
                    <Button className="shrink-0" onClick={onRequest} disabled={!demoMode}>
                        {demoMode ? "소싱환불 요청" : "연동 준비 중"}
                    </Button>
                ) : null}
            </div>
        </section>
    );
}

function ActionRow({ action, carrier, trackingNumber, onCarrierChange, onTrackingChange, onRun }: { action: DemoClaimAction; carrier: string; trackingNumber: string; onCarrierChange: (value: string) => void; onTrackingChange: (value: string) => void; onRun: (action: DemoClaimAction, carrier?: string, trackingNumber?: string) => void }) {
    const disabled = action.requiresTracking && (!carrier.trim() || !trackingNumber.trim());
    return (
        <Item variant="outline" className="items-start">
            <ItemContent>
                <ItemTitle>{action.label}</ItemTitle>
                <ItemDescription>{action.description}</ItemDescription>
                {action.requiresTracking ? <div className="mt-2 grid gap-2 md:grid-cols-2"><Input value={carrier} onChange={(event) => onCarrierChange(event.target.value)} placeholder="택배사" /><Input value={trackingNumber} onChange={(event) => onTrackingChange(event.target.value)} placeholder="재배송 송장번호" /></div> : null}
            </ItemContent>
            <ItemActions><Button variant={action.tone === "primary" ? "default" : "outline"} onClick={() => onRun(action, carrier, trackingNumber)} disabled={disabled}>{action.label}</Button></ItemActions>
        </Item>
    );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
    return <div className="flex flex-wrap items-end justify-between gap-2 border-b pb-2"><h3 className="font-black">{title}</h3><p className="text-xs text-muted-foreground">{description}</p></div>;
}

function SnapshotCell({ label, value }: { label: string; value: string }) {
    return <Item className="rounded-none border-b px-4 py-3 sm:border-b-0 sm:border-r sm:last:border-r-0"><ItemContent><ItemDescription>{label}</ItemDescription><ItemTitle className="break-all">{value}</ItemTitle></ItemContent></Item>;
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return <Item variant="muted"><ItemMedia variant="icon">{icon}</ItemMedia><ItemContent><ItemDescription>{label}</ItemDescription><ItemTitle>{value}</ItemTitle></ItemContent></Item>;
}
