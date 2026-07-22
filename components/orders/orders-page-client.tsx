"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { withBrowserSecurity } from "@/lib/client/http";
import type { SavedLiveSourcingMapping } from "@/components/orders/live-sourcing-mapping-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { OrderSearch } from "@/components/orders/shared/order-search";
import { OrderTable } from "@/components/orders/shared/order-table";
import { createColumns, OrderProcessActions, type OrderColumnActions } from "@/components/orders/shared/columns";
import { SourcingWorkflowDialog } from "@/components/orders/sourcing-workflow-dialog";
import {
    SellerCancelDialog,
    buildSellerCancelCommandPayload,
    validateSellerCancelDraft,
    type SellerCancelIntent,
    type SellerCancelSubmitResult,
} from "@/components/orders/seller-cancel-dialog";
import { MARKET_ABBREVIATIONS, MARKET_BADGE_CLASSES, ORDER_STATUSES } from "@/lib/constants/orders";
import { mockOrders } from "@/lib/mock-data/orders";
import { getSourcingProgressViewMeta, hasCompletedSourcingPurchase, resolveSourcingProgressStage } from "@/lib/sourcing-progress";
import { cn } from "@/lib/utils";
import { ClaimType, MarketType, Order, OrderStatus, Recipient, SourcingForwarderSelection, SourcingLifeMatch, SourcingProgressStage } from "@/types/order";

export type OrdersView = "all" | "new" | "preparing" | "waiting" | "shipping" | "delivered" | "claims";
type ClaimTypeFilter = "all" | ClaimType;
type OrderListStatus = SourcingProgressStage | "ON_HOLD" | "PURCHASE_CONFIRMED";
type StatusFilter = "all" | OrderListStatus;
type CollectionView = Exclude<OrdersView, "claims">;

const AUTO_SHIPPING_STORAGE_KEY = "jumunpangpang.autoShipping";

interface SyncedInvoice {
    orderId: string;
    carrier: string;
    trackingNumber: string;
    receivedAt: string;
    uploadedToMarketAt?: string;
    source?: "sourcing_life" | "manual";
    uploadMode?: "auto" | "manual";
}

interface CachedMatch {
    orderId: string;
    match: SourcingLifeMatch;
    savedAt: string;
}

interface SourcingPayment {
    orderId: string;
    sourcingLifeOrderId: string;
    paidAt: string;
    actualPaymentAmount: number;
}

interface OrdersPageClientProps {
    activeView: OrdersView;
}

interface ApiOrderItem {
    id: string;
    externalOrderItemId: string | null;
    marketProductId: string | null;
    productName: string;
    optionName: string | null;
    productUrl: string | null;
    thumbnailUrl: string | null;
    quantity: number;
    unitPrice: string;
    itemTotal: string;
    internalWorkStatus: "NEW" | "PREPARING" | "READY_TO_SHIP" | "SHIPPING" | "DELIVERED" | "CANCELED" | "ON_HOLD";
    sourcingStatus: string;
    sourcingVerificationProvenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED" | null;
    marketFulfillmentStatus: string | null;
    marketDeliveryMethod: string | null;
    domesticCarrierCode: string | null;
    domesticTrackingNumber: string | null;
    version: string;
}

interface ApiOrder {
    id: string;
    marketAccountId: string;
    marketCode: "NAVER" | "COUPANG" | "ELEVEN_STREET" | "GMARKET" | "AUCTION";
    storeName: string;
    externalOrderId: string;
    externalOrderNumber: string | null;
    normalizedStatus: string;
    marketStatusRaw: string;
    grossAmount: string;
    paidAmount: string;
    buyerNameMasked: string | null;
    recipientNameMasked: string | null;
    orderedAt: string;
    paidAt: string | null;
    items: ApiOrderItem[];
}

interface ApiMarketAccountSummary {
    id: string;
    authStatus: string;
    isActive: boolean;
    marketCode: string;
    storeName: string;
}

type ApiSyncRunStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "RETRY" | "FAILED" | "CANCELED" | "DEAD";

interface ApiSyncRun {
    id: string;
    marketAccountId: string;
    marketCode: string;
    storeName: string;
    status: ApiSyncRunStatus;
    counters: {
        seen: number;
        inserted: number;
        updated: number;
        skipped: number;
        errors: number;
    };
    errorMessage: string | null;
}

interface ApiEnqueueSyncRunResult {
    run: ApiSyncRun;
    reused: boolean;
}

interface ApiEnvelope<T> {
    data: T;
    error?: { message?: string };
}

const SYNC_STORAGE_KEY = "jumunpangpang.syncedInvoices";
const MATCH_STORAGE_KEY = "jumunpangpang.sourcingMatches";
const PAYMENT_STORAGE_KEY = "jumunpangpang.sourcingPayments";
const TERMINAL_SYNC_STATUSES = new Set<ApiSyncRunStatus>(["SUCCEEDED", "PARTIAL", "FAILED", "CANCELED", "DEAD"]);
const ORDER_SYNC_SUPPORTED_MARKETS = new Set(["NAVER"]);
const SYNC_POLL_INTERVAL_MS = 1_500;
const SYNC_POLL_TIMEOUT_MS = 60_000;

export function summarizeOrderSyncRuns(runs: ApiSyncRun[]) {
    return runs.reduce((summary, run) => ({
        inserted: summary.inserted + run.counters.inserted,
        updated: summary.updated + run.counters.updated,
        errors: summary.errors + run.counters.errors,
        succeeded: summary.succeeded + (run.status === "SUCCEEDED" ? 1 : 0),
        partial: summary.partial + (run.status === "PARTIAL" ? 1 : 0),
        failed: summary.failed + (["FAILED", "CANCELED", "DEAD"].includes(run.status) ? 1 : 0),
    }), { inserted: 0, updated: 0, errors: 0, succeeded: 0, partial: 0, failed: 0 });
}

function wait(delayMs: number) {
    return new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
}

async function waitForOrderSyncRuns(runIds: string[]): Promise<{ runs: ApiSyncRun[]; timedOut: boolean }> {
    const deadline = Date.now() + SYNC_POLL_TIMEOUT_MS;
    let runs: ApiSyncRun[] = [];

    while (Date.now() < deadline) {
        runs = await Promise.all(runIds.map((runId) => apiFetch<ApiSyncRun>(`/api/sync-runs/${runId}`)));
        if (runs.every((run) => TERMINAL_SYNC_STATUSES.has(run.status))) {
            return { runs, timedOut: false };
        }
        await wait(SYNC_POLL_INTERVAL_MS);
    }

    return { runs, timedOut: true };
}

const viewLabels: Record<OrdersView, string> = {
    all: "전체",
    new: "신규주문",
    preparing: "상품준비",
    waiting: "발송대기",
    shipping: "배송중",
    delivered: "배송완료",
    claims: "취소/반품/교환",
};

const viewStatuses: Record<OrdersView, OrderStatus[]> = {
    all: ORDER_STATUSES.ALL,
    new: ORDER_STATUSES.NEW,
    preparing: ORDER_STATUSES.PREPARING,
    waiting: ORDER_STATUSES.WAITING,
    shipping: ORDER_STATUSES.SHIPPING,
    delivered: ORDER_STATUSES.DELIVERED,
    claims: ORDER_STATUSES.CLAIMS,
};

export const collectionTabs: Array<{ view: CollectionView; href: string }> = [
    { view: "all", href: "/orders?view=all" },
    { view: "new", href: "/orders?view=new" },
    { view: "preparing", href: "/orders?view=preparing" },
    { view: "waiting", href: "/orders?view=waiting" },
    { view: "shipping", href: "/orders?view=shipping" },
    { view: "delivered", href: "/orders?view=delivered" },
];

const STATUS_FILTER_LABELS: Record<OrderListStatus, string> = {
    MATCH_REQUIRED: "소싱필요",
    MATCH_PENDING_REVIEW: "소싱 검증대기",
    MATCHED: "소싱완료",
    PAYMENT_WAITING: "결제대기",
    EXTERNAL_PURCHASE: "결제완료",
    SOURCED: "결제완료",
    CHINA_SHIPPING: "중국배송중",
    CUSTOMS_CLEARANCE: "통관 중",
    DOMESTIC_SHIPPING: "국내 배송중",
    DELIVERED: "배송완료",
    ON_HOLD: "처리보류",
    PURCHASE_CONFIRMED: "구매확정",
};

const ALL_STATUS_FILTER_VALUES = (Object.keys(STATUS_FILTER_LABELS) as OrderListStatus[])
    .filter((value) => value !== "EXTERNAL_PURCHASE");

const STATUS_FILTER_VALUES_BY_VIEW: Record<OrdersView, readonly OrderListStatus[]> = {
    all: ALL_STATUS_FILTER_VALUES,
    new: ["MATCH_REQUIRED", "MATCH_PENDING_REVIEW"],
    preparing: ["MATCH_REQUIRED", "MATCH_PENDING_REVIEW", "MATCHED", "PAYMENT_WAITING"],
    waiting: ["SOURCED", "CHINA_SHIPPING", "CUSTOMS_CLEARANCE", "DOMESTIC_SHIPPING"],
    shipping: ["SOURCED", "CHINA_SHIPPING", "CUSTOMS_CLEARANCE", "DOMESTIC_SHIPPING"],
    delivered: ["DELIVERED", "PURCHASE_CONFIRMED"],
    claims: ["MATCH_REQUIRED", "MATCH_PENDING_REVIEW", "MATCHED", "PAYMENT_WAITING", "SOURCED", "CHINA_SHIPPING", "CUSTOMS_CLEARANCE", "DOMESTIC_SHIPPING", "DELIVERED"],
};

type OrderStatusProjection = Pick<
    Order,
    "status" | "sourcingProgressStage" | "sourcingLifeSyncStatus" | "sourcingLifeOrderId" | "marketOrderStatus"
>;

export function getSourcingProgressStage(order: OrderStatusProjection): SourcingProgressStage {
    return resolveSourcingProgressStage(order);
}

export function getOrderListStatuses(order: OrderStatusProjection): OrderListStatus[] {
    const sourcingStage = getSourcingProgressStage(order);
    const statuses: OrderListStatus[] = [
        order.status === "DELIVERED"
            ? "DELIVERED"
            : order.status === "ON_HOLD"
                ? "ON_HOLD"
                : sourcingStage === "EXTERNAL_PURCHASE" ? "SOURCED" : sourcingStage,
    ];

    if (order.status === "DELIVERED" && order.marketOrderStatus === "PURCHASE_DECIDED") {
        statuses.push("PURCHASE_CONFIRMED");
    }

    return statuses;
}

export function getOrderStatusFilterOptions(view: OrdersView) {
    return STATUS_FILTER_VALUES_BY_VIEW[view]
        .map((value) => ({ value, label: STATUS_FILTER_LABELS[value] }));
}

export function getOrderViewCount(orders: readonly Pick<Order, "status">[], view: CollectionView): number {
    return orders.filter((order) => viewStatuses[view].includes(order.status)).length;
}

function loadJson<T>(key: string): T[] {
    if (typeof window === "undefined") return [];

    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T[] : [];
    } catch {
        return [];
    }
}

function saveSyncedInvoice(invoice: SyncedInvoice) {
    const current = loadJson<SyncedInvoice>(SYNC_STORAGE_KEY).filter((item) => item.orderId !== invoice.orderId);
    window.localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify([...current, invoice]));
}

function saveCachedMatch(match: CachedMatch) {
    const current = loadJson<CachedMatch>(MATCH_STORAGE_KEY).filter((item) => item.orderId !== match.orderId);
    window.localStorage.setItem(MATCH_STORAGE_KEY, JSON.stringify([...current, match]));
}

function saveSourcingPayment(payment: SourcingPayment) {
    const current = loadJson<SourcingPayment>(PAYMENT_STORAGE_KEY).filter((item) => item.orderId !== payment.orderId);
    window.localStorage.setItem(PAYMENT_STORAGE_KEY, JSON.stringify([...current, payment]));
}

export function createPaymentWaitingOrder(
    order: Order,
    match: SourcingLifeMatch,
    forwarder: SourcingForwarderSelection,
    requestedAt: string,
): Order {
    return {
        ...order,
        status: "PREPARING",
        sourcingLifeSyncStatus: "PAYMENT_READY",
        sourcingProgressStage: "PAYMENT_WAITING",
        sourcingLifeMatch: match,
        sourcingForwarder: forwarder,
        sourcingPaymentRequestedAt: requestedAt,
        sourcingLifeSyncedAt: requestedAt,
    };
}

function hasCompletedPurchase(order: Order) {
    return hasCompletedSourcingPurchase(order);
}

function shouldMoveDirectDeliveryToShipping(order: Order, hasDomesticInvoice = Boolean(order.domesticInvoice?.trackingNumber?.trim())) {
    return order.status === "READY_TO_SHIP"
        && order.marketOrderStatus === "DELIVERING"
        && order.marketDeliveryMethod === "DIRECT_DELIVERY"
        && hasCompletedPurchase(order)
        && hasDomesticInvoice;
}

function applyCachedState(
    orders: Order[],
    matches: CachedMatch[],
    payments: SourcingPayment[],
    invoices: SyncedInvoice[],
) {
    return orders.map((order) => {
        const cachedMatch = matches.find((item) => item.orderId === order.id);
        const payment = payments.find((item) => item.orderId === order.id);
        const invoice = invoices.find((item) => item.orderId === order.id);
        let nextOrder = cachedMatch
            ? {
                ...order,
                sourcingLifeSyncStatus: "MATCH_SAVED" as const,
                sourcingProgressStage: "MATCHED" as const,
                sourcingLifeSyncedAt: cachedMatch.savedAt,
                sourcingLifeMatch: cachedMatch.match,
            }
            : order;

        if (payment) {
            nextOrder = {
                ...nextOrder,
                status: "READY_TO_SHIP" as OrderStatus,
                sourcingLifeSyncStatus: "PAID" as const,
                sourcingProgressStage: "SOURCED" as const,
                sourcingLifeOrderId: payment.sourcingLifeOrderId,
                sourcingLifeSyncedAt: payment.paidAt,
                sourcingLifeActualPayment: {
                    amount: payment.actualPaymentAmount,
                    currency: "KRW" as const,
                    paidAt: payment.paidAt,
                },
            };
        }

        if (invoice) {
            const isSourcingLifeInvoice = invoice.source === "sourcing_life" || !!nextOrder.sourcingLifeOrderId;
            const canEnterShipping = hasCompletedPurchase(nextOrder);
            const uploadedToMarketAt = canEnterShipping ? invoice.uploadedToMarketAt : undefined;
            nextOrder = {
                ...nextOrder,
                status: uploadedToMarketAt && nextOrder.marketDeliveryMethod !== "DIRECT_DELIVERY" ? "SHIPPING" as OrderStatus : nextOrder.status,
                marketOrderStatus: uploadedToMarketAt ? "DELIVERING" as const : nextOrder.marketOrderStatus,
                marketDeliveryMethod: uploadedToMarketAt && nextOrder.marketDeliveryMethod !== "DIRECT_DELIVERY" ? "DELIVERY" as const : nextOrder.marketDeliveryMethod,
                sourcingLifeSyncStatus: isSourcingLifeInvoice ? "INVOICE_RECEIVED" as const : nextOrder.sourcingLifeSyncStatus,
                sourcingProgressStage: isSourcingLifeInvoice ? nextOrder.sourcingProgressStage ?? "SOURCED" as const : nextOrder.sourcingProgressStage,
                sourcingLifeSyncedAt: isSourcingLifeInvoice ? invoice.receivedAt : nextOrder.sourcingLifeSyncedAt,
                domesticInvoice: {
                    carrier: invoice.carrier,
                    trackingNumber: invoice.trackingNumber,
                    receivedAt: invoice.receivedAt,
                    uploadedToMarketAt,
                    source: invoice.source ?? (isSourcingLifeInvoice ? "sourcing_life" : "manual"),
                    uploadMode: invoice.uploadMode,
                },
            };
        }

        if (shouldMoveDirectDeliveryToShipping(nextOrder)) {
            nextOrder = { ...nextOrder, status: "SHIPPING" as OrderStatus };
        }

        return nextOrder;
    });
}

function createDummyInvoice(orderId: string, index: number, uploadedToMarketAt?: string, uploadMode?: "auto" | "manual"): SyncedInvoice {
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");

    return {
        orderId,
        carrier: index % 2 === 0 ? "CJ대한통운" : "롯데택배",
        trackingNumber: `51${Date.now().toString().slice(-8)}${index}`,
        receivedAt: now,
        uploadedToMarketAt,
        source: "sourcing_life",
        uploadMode,
    };
}

function getOrderNumber(order: Order) {
    return Number(order.id.split("-").at(-1) ?? 0);
}

export function createSellerCanceledOrder(order: Order, canceledAt: string): Order {
    return {
        ...order,
        status: "CANCELED" as OrderStatus,
        previousStatus: order.status === "CLAIM" || order.status === "CANCELED" ? order.previousStatus : order.status,
        sellerCancelReason: "판매자 주문취소",
        sellerCanceledAt: canceledAt,
        failureReason: "판매자 주문취소 완료",
    };
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, withBrowserSecurity(init));
    const text = await response.text();
    let payload: ApiEnvelope<T> | null = null;

    try {
        payload = text ? JSON.parse(text) as ApiEnvelope<T> : null;
    } catch {
        // The status code below remains the public error; HTML/proxy bodies are not surfaced.
    }

    if (!response.ok) {
        throw new Error(payload?.error?.message ?? `요청을 처리하지 못했습니다. (${response.status})`);
    }

    return payload?.data as T;
}

export function mapApiOrderStatus(status: ApiOrderItem["internalWorkStatus"]): OrderStatus {
    return status;
}

export function mapApiSourcingStatus(status: string): Order["sourcingLifeSyncStatus"] {
    if (status === "MATCHED") return "MATCH_SAVED";
    if (status === "PAYMENT_READY") return "PAYMENT_READY";
    if (status === "PAID") return "PAID";
    if (status === "EXTERNAL_PURCHASE") return "NOT_LINKED";
    if (status === "INVOICE_RECEIVED") return "INVOICE_RECEIVED";
    if (status === "HOLD") return "HOLD";
    return "NOT_LINKED";
}

export function mapApiProgress(status: string): SourcingProgressStage {
    if (status === "MATCHED") return "MATCHED";
    if (status === "PAYMENT_READY") return "PAYMENT_WAITING";
    if (status === "EXTERNAL_PURCHASE") return "EXTERNAL_PURCHASE";
    if (status === "PAID" || status === "INVOICE_RECEIVED") return "SOURCED";
    return "MATCH_REQUIRED";
}

export function mapApiMarketOrderStatus(status: string | null): Order["marketOrderStatus"] {
    if (status === "CANCEL_REQUESTED") return "CANCEL_REQUESTED";
    if (status === "SHIPPING") return "DELIVERING";
    if (status === "DELIVERED") return "DELIVERED";
    if (status === "PURCHASE_CONFIRMED") return "PURCHASE_DECIDED";
    return "PAYED";
}

const NEUTRAL_PRODUCT_THUMBNAIL = "/images/product-placeholder.svg";

function toUiOrders(apiOrders: ApiOrder[]): Order[] {
    const marketMap: Record<ApiOrder["marketCode"], MarketType> = {
        NAVER: "naver",
        COUPANG: "coupang",
        ELEVEN_STREET: "11st",
        GMARKET: "gmarket",
        AUCTION: "auction",
    };
    return apiOrders.flatMap((order) => order.items.map((item): Order => ({
        id: item.id,
        marketOrderId: order.externalOrderNumber ?? order.externalOrderId,
        marketType: marketMap[order.marketCode],
        marketAccountId: order.marketAccountId,
        storeName: order.storeName,
        orderDate: order.orderedAt,
        marketPaidAt: order.paidAt ?? undefined,
        status: mapApiOrderStatus(item.internalWorkStatus),
        buyerName: order.buyerNameMasked ?? "마스킹",
        buyerPhone: "-",
        recipient: {
            name: order.recipientNameMasked ?? "마스킹",
            phone: "-",
            address: "상세 주문에서 권한 확인 후 표시",
        },
        product: {
            id: item.marketProductId ?? item.id,
            productOrderId: item.externalOrderItemId ?? undefined,
            name: item.productName,
            thumbnail: item.thumbnailUrl ?? NEUTRAL_PRODUCT_THUMBNAIL,
            optionName: item.optionName ?? "옵션 없음",
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            marketLink: item.productUrl ?? undefined,
        },
        paymentPrice: Number(item.itemTotal),
        platformFee: 0,
        expectedSettlement: Number(item.itemTotal),
        sourcingLifeSyncStatus: mapApiSourcingStatus(item.sourcingStatus),
        sourcingProgressStage: item.sourcingVerificationProvenance === "MANUAL_UNVERIFIED"
            ? "MATCH_PENDING_REVIEW"
            : mapApiProgress(item.sourcingStatus),
        marketOrderStatus: mapApiMarketOrderStatus(item.marketFulfillmentStatus),
        marketDeliveryMethod: item.marketDeliveryMethod === "DIRECT_DELIVERY" ? "DIRECT_DELIVERY" : "DELIVERY",
        domesticInvoice: item.domesticTrackingNumber ? {
            carrier: item.domesticCarrierCode ?? "택배사 미확인",
            trackingNumber: item.domesticTrackingNumber,
            receivedAt: order.orderedAt,
            source: "manual",
        } : undefined,
        dataSource: "api",
        version: item.version,
    })));
}

function toMarketCarrierCode(carrier: string): string {
    const known: Record<string, string> = {
        "CJ대한통운": "CJGLS",
        "롯데택배": "LOTTE",
        "한진택배": "HANJIN",
        "우체국택배": "EPOST",
    };

    return known[carrier] ?? carrier;
}

function getSourcingDialogMode(order: Order | null): "match-only" | "payment" | "progress" {
    if (!order || order.status === "NEW") return "match-only";
    const progressView = getSourcingProgressViewMeta(order);
    return progressView && progressView.stage !== "PAYMENT_WAITING" ? "progress" : "payment";
}

export function OrdersPageClient({ activeView }: OrdersPageClientProps) {
    const [allOrders, setAllOrders] = useState<Order[]>(mockOrders);
    const [activeSourcingOrder, setActiveSourcingOrder] = useState<Order | null>(null);
    const [sourcingCancelOrder, setSourcingCancelOrder] = useState<Order | null>(null);
    const [collectingOrders, setCollectingOrders] = useState(false);
    const [collectionStatus, setCollectionStatus] = useState<string | null>(null);
    const [autoShipping, setAutoShipping] = useState(false);
    const [claimTypeFilter, setClaimTypeFilter] = useState<ClaimTypeFilter>("all");
    const [sellerFilter, setSellerFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
    const [bulkCancelConfirmOpen, setBulkCancelConfirmOpen] = useState(false);
    const isClaimView = activeView === "claims";

    useEffect(() => {
        try {
            setAutoShipping(window.localStorage.getItem(AUTO_SHIPPING_STORAGE_KEY) === "true");
        } catch {
            toast.warning("자동 배송중 처리 설정을 불러오지 못했습니다.");
        }
    }, []);

    const handleAutoShippingChange = useCallback((checked: boolean) => {
        setAutoShipping(checked);
        try {
            window.localStorage.setItem(AUTO_SHIPPING_STORAGE_KEY, String(checked));
        } catch {
            toast.warning("자동 배송중 처리 설정을 저장하지 못했습니다.");
        }
    }, []);

    const orderPageQuery = useInfiniteQuery({
        queryKey: ["orders", "first-page"],
        initialPageParam: null as string | null,
        queryFn: ({ pageParam }) => apiFetch<{ items: ApiOrder[]; nextCursor: string | null }>(
            `/api/orders?limit=100${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        ),
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        retry: false,
    });
    const apiOrders = useMemo(
        () => orderPageQuery.data?.pages.flatMap((page) => page.items) ?? [],
        [orderPageQuery.data],
    );
    const hasLiveOrders = apiOrders.length > 0;

    const filteredBaseOrders = useMemo(() => {
        const statuses = viewStatuses[activeView];
        return allOrders.filter((order) => {
            const matchesStatus = statuses.includes(order.status);
            return matchesStatus;
        });
    }, [activeView, allOrders]);
    const sellerOptions = useMemo(() => {
        const options = new Map<string, { marketType: MarketType; storeName: string }>();

        filteredBaseOrders.forEach((order) => {
            const key = `${order.marketType}:${order.storeName}`;
            if (!options.has(key)) options.set(key, { marketType: order.marketType, storeName: order.storeName });
        });

        return Array.from(options, ([value, option]) => ({ value, ...option }));
    }, [filteredBaseOrders]);
    const statusOptions = useMemo(() => getOrderStatusFilterOptions(activeView), [activeView]);
    const activeStatusFilter = statusFilter === "all" || STATUS_FILTER_VALUES_BY_VIEW[activeView].includes(statusFilter)
        ? statusFilter
        : "all";
    const stageFilteredOrders = useMemo(() => {
        return filteredBaseOrders.filter((order) => {
            const matchesSeller = sellerFilter === "all" || sellerFilter === `${order.marketType}:${order.storeName}`;
            const matchesStatus = activeStatusFilter === "all" || getOrderListStatuses(order).includes(activeStatusFilter);
            return matchesSeller && matchesStatus;
        });
    }, [activeStatusFilter, filteredBaseOrders, sellerFilter]);
    const visibleBaseOrders = useMemo(() => {
        if (activeView === "claims") {
            let claimOrders = stageFilteredOrders;

            if (claimTypeFilter !== "all") {
                claimOrders = claimOrders.filter((order) => order.claimType === claimTypeFilter);
            }

            return claimOrders;
        }

        return stageFilteredOrders;
    }, [activeView, claimTypeFilter, stageFilteredOrders]);
    const claimTypeCounts = useMemo(() => {
        return stageFilteredOrders.reduce((counts, order) => {
            if (order.claimType === "CANCEL") counts.cancel += 1;
            if (order.claimType === "RETURN") counts.return += 1;
            if (order.claimType === "EXCHANGE") counts.exchange += 1;
            return counts;
  }, { all: stageFilteredOrders.length, cancel: 0, return: 0, exchange: 0 });
    }, [stageFilteredOrders]);
    const statusCounts = useMemo(() => {
        return collectionTabs.reduce<Record<CollectionView, number>>((counts, tab) => {
            counts[tab.view] = getOrderViewCount(allOrders, tab.view);
            return counts;
        }, {
            all: 0,
            new: 0,
            preparing: 0,
            waiting: 0,
            shipping: 0,
            delivered: 0,
        });
    }, [allOrders]);
    const [orders, setOrders] = useState<Order[]>(visibleBaseOrders);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            window.localStorage.removeItem(SYNC_STORAGE_KEY);
            window.localStorage.removeItem(MATCH_STORAGE_KEY);
            window.localStorage.removeItem(PAYMENT_STORAGE_KEY);
            setAllOrders(hasLiveOrders ? toUiOrders(apiOrders) : mockOrders);
        }, 0);

        return () => window.clearTimeout(timer);
    }, [apiOrders, hasLiveOrders]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setOrders(visibleBaseOrders);
            setRowSelection({});
        }, 0);

        return () => window.clearTimeout(timer);
    }, [visibleBaseOrders]);

    const handleCollectOrders = async () => {
        setCollectingOrders(true);
        setCollectionStatus("연결 계정을 확인하는 중");
        try {
            const accounts = await apiFetch<ApiMarketAccountSummary[]>("/api/market-accounts");
            const targets = accounts.filter((account) => (
                account.isActive
                && account.authStatus === "CONNECTED"
                && ORDER_SYNC_SUPPORTED_MARKETS.has(account.marketCode)
            ));
            const unsupportedCount = accounts.filter((account) => (
                account.isActive
                && account.authStatus === "CONNECTED"
                && !ORDER_SYNC_SUPPORTED_MARKETS.has(account.marketCode)
            )).length;

            if (targets.length === 0) {
                toast.info("주문수집 가능한 연결 완료 스마트스토어 계정이 없습니다.");
                setCollectionStatus(unsupportedCount > 0 ? `아직 수집을 지원하지 않는 마켓 ${unsupportedCount}개` : null);
                return;
            }

            setCollectionStatus(`${targets.length}개 계정의 수집 작업을 접수하는 중`);
            const results = await Promise.allSettled(targets.map((account) => (
                apiFetch<ApiEnqueueSyncRunResult>(`/api/market-accounts/${account.id}/sync`, { method: "POST" })
            )));
            const accepted = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
            const failed = results.length - accepted.length;

            if (accepted.length === 0) {
                throw new Error("주문수집 작업을 접수하지 못했습니다.");
            }

            const reused = accepted.filter((result) => result.reused).length;
            setCollectionStatus(`${accepted.length}개 계정에서 주문을 수집하는 중${reused ? ` · 진행 중 작업 ${reused}개 포함` : ""}`);
            const completed = await waitForOrderSyncRuns(accepted.map((result) => result.run.id));

            if (completed.timedOut) {
                setCollectionStatus("주문수집이 백그라운드에서 계속 진행 중");
                toast.info("주문수집이 계속 진행 중입니다. 잠시 후 다시 확인해 주세요.");
                return;
            }

            const summary = summarizeOrderSyncRuns(completed.runs);
            await orderPageQuery.refetch();
            const supportNote = unsupportedCount > 0 ? ` · 미지원 마켓 ${unsupportedCount}개 제외` : "";
            const resultLabel = `신규 ${summary.inserted}건 · 갱신 ${summary.updated}건${supportNote}`;
            setCollectionStatus(resultLabel);

            if (summary.failed > 0 || failed > 0) {
                toast.error(`주문수집 일부 실패: ${resultLabel} · 실행 실패 ${summary.failed + failed}개`);
            } else if (summary.partial > 0 || summary.errors > 0) {
                toast.warning(`주문수집 부분 완료: ${resultLabel} · 오류 ${summary.errors}건`);
            } else {
                toast.success(`주문수집 완료: ${resultLabel}`);
            }
        } catch (error) {
            setCollectionStatus("주문수집 실패");
            toast.error(error instanceof Error ? error.message : "주문수집 작업을 접수하지 못했습니다.");
        } finally {
            setCollectingOrders(false);
        }
    };

    const enqueueApiCommand = useCallback(async (
        order: Order,
        type: "ORDER_CONFIRM" | "INVOICE_SUBMIT" | "DIRECT_DELIVERY" | "SELLER_CANCEL",
        payload: Record<string, unknown>,
        effectKey: string,
    ) => {
        const expectedVersion = Number(order.version);
        if (!order.version || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
            throw new Error("주문 버전이 올바르지 않습니다. 주문을 새로고침해 주세요.");
        }

        return apiFetch<{ command: { id: string; status: string }; replayed: boolean }>(
            `/api/order-items/${order.id}/commands`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ type, expectedVersion, effectKey, payload }),
            },
        );
    }, []);

    const saveSourcingMatch = useCallback((order: Order, match: SourcingLifeMatch) => {
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const cachedMatch = { orderId: order.id, match, savedAt: now };
        saveCachedMatch(cachedMatch);
        setAllOrders((current) => applyCachedState(current, [cachedMatch], [], []));
        return cachedMatch;
    }, []);

    const handleSaveSourcingMatch = useCallback((order: Order, match: SourcingLifeMatch) => {
        if (order.dataSource === "api") {
            toast.info("실주문 소싱 매핑 저장 API는 다음 구현 단계입니다. 데모 상태로 저장하지 않았습니다.");
            return;
        }
        saveSourcingMatch(order, match);
        toast.success("소싱상품 매칭과 옵션을 저장했습니다.");
    }, [saveSourcingMatch]);

    const handleCreateSourcingPaymentWait = useCallback((
        order: Order,
        match: SourcingLifeMatch,
        forwarder: SourcingForwarderSelection,
    ) => {
        if (order.dataSource === "api") {
            toast.info("실주문 구매대행 신청은 결제대기 원장 API가 연결된 뒤 활성화됩니다.");
            return;
        }

        const personalCustomsCode = order.recipient.personalCustomsCode?.trim().toUpperCase();
        if (!personalCustomsCode || !/^P\d{12}$/.test(personalCustomsCode)) {
            toast.info("통관부호가 일치해야 구매대행 신청을 진행할 수 있습니다.");
            return;
        }

        const requestedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
        saveCachedMatch({ orderId: order.id, match, savedAt: requestedAt });
        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? createPaymentWaitingOrder(item, match, forwarder, requestedAt)
                : item
        )));
        toast.success(`${order.marketOrderId} 주문의 배대지를 저장하고 결제대기로 전환했습니다.`);
    }, []);

    const handleCompleteSourcingPayment = useCallback((order: Order, match: SourcingLifeMatch) => {
        if (order.dataSource === "api") {
            toast.info("소싱라이프 구매 신청은 결제 전 비용확인·멱등 계약이 연결된 뒤 활성화됩니다.");
            return false;
        }
        const personalCustomsCode = order.recipient.personalCustomsCode?.trim().toUpperCase();
        if (!personalCustomsCode || !/^P\d{12}$/.test(personalCustomsCode)) {
            toast.info("통관부호가 일치해야 소싱라이프 결제를 진행할 수 있습니다.");
            return false;
        }

        const cachedMatch = saveSourcingMatch(order, match);
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const actualPaymentAmount = match.estimatedCost ? match.estimatedCost * (match.quantity ?? order.product.quantity) : order.expectedCost ?? 0;
        const shouldAutoDispatchToMarket = autoShipping && order.marketDeliveryMethod !== "DIRECT_DELIVERY";
        const sourcingLifeInvoice = createDummyInvoice(order.id, getOrderNumber(order), shouldAutoDispatchToMarket ? now : undefined, shouldAutoDispatchToMarket ? "auto" : undefined);
        if (!sourcingLifeInvoice.trackingNumber.trim()) {
            toast.error("소싱라이프 구매 완료 응답에 국내송장이 없어 상태를 변경할 수 없습니다.");
            return false;
        }
        const payment: SourcingPayment = {
            orderId: order.id,
            sourcingLifeOrderId: `SL-${order.id.replace("ORD-", "")}`,
            paidAt: now,
            actualPaymentAmount,
        };
        const directDeliveryMovesToShipping = Boolean(sourcingLifeInvoice.trackingNumber.trim() || order.domesticInvoice?.trackingNumber?.trim())
            && order.marketOrderStatus === "DELIVERING"
            && order.marketDeliveryMethod === "DIRECT_DELIVERY";

        saveSourcingPayment(payment);
        saveSyncedInvoice(sourcingLifeInvoice);
        const createCompletedOrder = (item: Order): Order => ({
                    ...item,
                    status: (sourcingLifeInvoice.uploadedToMarketAt && item.marketDeliveryMethod !== "DIRECT_DELIVERY") || directDeliveryMovesToShipping
                        ? "SHIPPING" as OrderStatus
                        : "READY_TO_SHIP" as OrderStatus,
                    marketOrderStatus: sourcingLifeInvoice.uploadedToMarketAt ? "DELIVERING" as const : item.marketOrderStatus,
                    marketDeliveryMethod: sourcingLifeInvoice.uploadedToMarketAt && item.marketDeliveryMethod !== "DIRECT_DELIVERY" ? "DELIVERY" as const : item.marketDeliveryMethod,
                    sourcingLifeSyncStatus: "INVOICE_RECEIVED" as const,
                    sourcingProgressStage: "SOURCED" as const,
                    sourcingLifeOrderId: payment.sourcingLifeOrderId,
                    sourcingLifeSyncedAt: sourcingLifeInvoice.receivedAt,
                    sourcingLifeMatch: cachedMatch.match,
                    sourcingLifeActualPayment: {
                        amount: payment.actualPaymentAmount,
                        currency: "KRW" as const,
                        paidAt: now,
                    },
                    domesticInvoice: {
                        carrier: sourcingLifeInvoice.carrier,
                        trackingNumber: sourcingLifeInvoice.trackingNumber,
                        receivedAt: sourcingLifeInvoice.receivedAt,
                        uploadedToMarketAt: sourcingLifeInvoice.uploadedToMarketAt,
                        source: "sourcing_life" as const,
                        uploadMode: sourcingLifeInvoice.uploadMode,
                    },
                });
        setAllOrders((current) => current.map((item) => item.id === order.id ? createCompletedOrder(item) : item));
        setActiveSourcingOrder((current) => current?.id === order.id ? createCompletedOrder(current) : current);
        if (sourcingLifeInvoice.uploadedToMarketAt) {
            toast.success(`${order.marketOrderId} 주문의 송장을 마켓에 자동 전송하고 마켓과 내부 상태를 배송중으로 변경했습니다.`);
            return true;
        }
        if (directDeliveryMovesToShipping) {
            toast.success(`${order.marketOrderId} 주문의 소싱라이프 결제와 송장을 반영하고 내부 배송중으로 이동했습니다.`);
            return true;
        }
        toast.success(`${order.marketOrderId} 주문의 소싱라이프 결제와 송장을 반영하고 발송대기로 이동했습니다.`);
        return true;
    }, [autoShipping, saveSourcingMatch]);

    const handleCompleteManualPurchase = useCallback((order: Order, invoice: { carrier: string; trackingNumber: string }) => {
        if (order.dataSource === "api") {
            toast.info("실주문의 직접구매 국내송장 원장은 다음 구현 단계입니다. 데모 상태로 변경하지 않았습니다.");
            return;
        }
        if (!invoice.trackingNumber.trim()) {
            toast.info(order.marketDeliveryMethod === "DIRECT_DELIVERY"
                ? "직접전달 주문의 내부 배송 추적에도 국내송장번호가 필요합니다."
                : "직접구매 국내송장 등록에는 국내송장번호가 필요합니다.");
            return;
        }

        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const shouldAutoDispatchToMarket = autoShipping && order.marketDeliveryMethod !== "DIRECT_DELIVERY";
        const syncedInvoice: SyncedInvoice = {
            orderId: order.id,
            carrier: invoice.carrier,
            trackingNumber: invoice.trackingNumber.trim(),
            receivedAt: now,
            uploadedToMarketAt: shouldAutoDispatchToMarket ? now : undefined,
            source: "manual",
            uploadMode: shouldAutoDispatchToMarket ? "auto" : undefined,
        };
        const directDeliveryMovesToShipping = order.marketOrderStatus === "DELIVERING"
            && order.marketDeliveryMethod === "DIRECT_DELIVERY"
            && Boolean(syncedInvoice?.trackingNumber?.trim() || order.domesticInvoice?.trackingNumber?.trim());

        saveSyncedInvoice(syncedInvoice);
        setAllOrders((current) => current.map((item) => {
            if (item.id !== order.id) return item;

            return {
                ...item,
                status: shouldAutoDispatchToMarket || directDeliveryMovesToShipping ? "SHIPPING" as OrderStatus : "READY_TO_SHIP" as OrderStatus,
                marketOrderStatus: shouldAutoDispatchToMarket ? "DELIVERING" as const : item.marketOrderStatus,
                marketDeliveryMethod: shouldAutoDispatchToMarket ? "DELIVERY" as const : item.marketDeliveryMethod,
                sourcingLifeSyncStatus: "NOT_LINKED" as const,
                sourcingProgressStage: "EXTERNAL_PURCHASE" as const,
                sourcingLifeOrderId: undefined,
                sourcingLifeActualPayment: undefined,
                domesticInvoice: {
                    carrier: syncedInvoice.carrier,
                    trackingNumber: syncedInvoice.trackingNumber,
                    receivedAt: syncedInvoice.receivedAt,
                    uploadedToMarketAt: syncedInvoice.uploadedToMarketAt,
                    source: "manual" as const,
                    uploadMode: syncedInvoice.uploadMode,
                },
            };
        }));

        if (shouldAutoDispatchToMarket) {
            toast.success(`${order.marketOrderId} 주문의 직접구매 국내송장을 마켓에 자동 전송하고 마켓과 내부 상태를 배송중으로 변경했습니다.`);
            return;
        }
        if (directDeliveryMovesToShipping) {
            toast.success(`${order.marketOrderId} 주문의 직접구매 국내송장을 저장하고 내부 배송중으로 이동했습니다.`);
            return;
        }
        toast.success(`${order.marketOrderId} 주문의 직접구매 국내송장번호를 저장했습니다. 발송대기에서 마켓 발송을 진행하세요.`);
    }, [autoShipping]);

    const handleSourcingAndAcceptOrder = useCallback((order: Order, match: SourcingLifeMatch) => {
        if (order.dataSource === "api") {
            toast.info("실주문 소싱 매핑 저장 API가 연결되기 전에는 소싱+주문확인을 실행하지 않습니다.");
            return;
        }
        const cachedMatch = saveSourcingMatch(order, match);
        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? {
                    ...item,
                    status: "PREPARING" as OrderStatus,
                    sourcingLifeSyncStatus: "MATCH_SAVED" as const,
                    sourcingProgressStage: "MATCHED" as const,
                    sourcingLifeSyncedAt: cachedMatch.savedAt,
                    sourcingLifeMatch: cachedMatch.match,
                }
                : item
        )));
        toast.success(`${order.marketOrderId} 주문을 소싱 매칭 후 주문확인하고 상품준비로 이동했습니다.`);
    }, [saveSourcingMatch]);

    const handleAcceptOrder = useCallback(async (order: Order) => {
        if (order.dataSource === "api") {
            try {
                const accepted = await enqueueApiCommand(order, "ORDER_CONFIRM", {}, `confirm:v${order.version}`);
                toast.info(`${order.marketOrderId} 주문확인 명령을 접수했습니다. 최종 성공은 워커 대사 후 반영됩니다. (${accepted.command.status})`);
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "주문확인 명령을 접수하지 못했습니다.");
            }
            return;
        }

        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? {
                    ...item,
                    status: "PREPARING" as OrderStatus,
                    sourcingLifeSyncStatus: item.sourcingLifeMatch ? "MATCH_SAVED" as const : item.sourcingLifeSyncStatus,
                    sourcingProgressStage: item.sourcingLifeMatch ? "MATCHED" as const : item.sourcingProgressStage,
                }
                : item
        )));
        toast.success(`${order.marketOrderId} 주문을 주문확인하고 상품준비로 이동했습니다.`);
    }, [enqueueApiCommand]);

    const handleBulkAcceptOrders = useCallback(async (orderIds: string[]) => {
        const targetIds = new Set(orderIds);

        if (targetIds.size === 0) {
            toast.info("주문확인할 신규주문이 없습니다.");
            return;
        }

        const liveOrders = allOrders.filter((order) => targetIds.has(order.id) && order.dataSource === "api");
        if (liveOrders.length > 0) {
            const results = await Promise.allSettled(liveOrders.map((order) => (
                enqueueApiCommand(order, "ORDER_CONFIRM", {}, `confirm:v${order.version}`)
            )));
            const accepted = results.filter((result) => result.status === "fulfilled").length;
            const failed = results.length - accepted;
            if (accepted > 0) toast.info(`${accepted}건의 주문확인 명령을 접수했습니다.${failed ? ` ${failed}건은 실패했습니다.` : ""}`);
            else toast.error("주문확인 명령을 접수하지 못했습니다.");
            return;
        }

        setAllOrders((current) => current.map((item) => (
            targetIds.has(item.id) && item.status === "NEW"
                ? {
                    ...item,
                    status: "PREPARING" as OrderStatus,
                    sourcingLifeSyncStatus: item.sourcingLifeMatch ? "MATCH_SAVED" as const : item.sourcingLifeSyncStatus,
                    sourcingProgressStage: item.sourcingLifeMatch ? "MATCHED" as const : item.sourcingProgressStage,
                }
                : item
        )));
        toast.success(`${targetIds.size}건을 주문확인하고 상품준비로 이동했습니다.`);
    }, [allOrders, enqueueApiCommand]);

    const handleCancelOrder = useCallback(async (
        order: Order,
        intent: SellerCancelIntent,
    ): Promise<boolean> => {
        if (order.marketDeliveryMethod === "DIRECT_DELIVERY") {
            toast.error("마켓 직접전달 주문은 주문취소할 수 없습니다.");
            return false;
        }

        const validated = validateSellerCancelDraft({
            reasonCode: intent.reasonCode,
            reasonDetail: intent.reasonDetail,
            quantity: String(intent.quantity ?? ""),
            orderedQuantity: order.product.quantity,
        });
        if (!validated.ok) {
            toast.error(Object.values(validated.errors)[0] ?? "판매자 취소 입력값을 확인해 주세요.");
            return false;
        }

        if (order.dataSource === "api") {
            try {
                await enqueueApiCommand(
                    order,
                    "SELLER_CANCEL",
                    { ...buildSellerCancelCommandPayload(validated.value, order.product.quantity) },
                    `seller-cancel:v${order.version}`,
                );
                toast.info(`${order.marketOrderId} 판매자취소 명령을 접수했습니다. 최종 성공은 마켓 대사 후 반영됩니다.`);
                return true;
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "판매자취소 명령을 접수하지 못했습니다.");
                return false;
            }
        }

        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? createSellerCanceledOrder(item, now)
                : item
        )));
        toast.success(`${order.marketOrderId} 주문을 판매자취소로 처리했습니다.`);
        return true;
    }, [enqueueApiCommand]);

    const handleBulkCancelOrders = useCallback(async (
        orderIds: string[],
        intent: SellerCancelIntent,
    ): Promise<boolean | SellerCancelSubmitResult> => {
        const targetIds = new Set(orderIds);
        const targetOrders = allOrders.filter((order) => (
            targetIds.has(order.id)
            && order.status === "NEW"
            && order.marketDeliveryMethod !== "DIRECT_DELIVERY"
        ));

        if (targetOrders.length === 0) {
            toast.info("주문취소할 신규주문을 선택하세요.");
            return false;
        }

        const validatedTargets = targetOrders.map((order) => ({
            order,
            validation: validateSellerCancelDraft({
                reasonCode: intent.reasonCode,
                reasonDetail: intent.reasonDetail,
                quantity: String(order.product.quantity),
                orderedQuantity: order.product.quantity,
            }),
        }));
        const invalid = validatedTargets.find(({ validation }) => !validation.ok);
        if (invalid && !invalid.validation.ok) {
            toast.error(Object.values(invalid.validation.errors)[0] ?? "일괄 취소 수량을 확인해 주세요.");
            return false;
        }

        const liveTargets = validatedTargets.filter(({ order }) => order.dataSource === "api");
        if (liveTargets.length > 0) {
            const results = await Promise.allSettled(liveTargets.map(({ order, validation }) => (
                validation.ok
                    ? enqueueApiCommand(
                        order,
                        "SELLER_CANCEL",
                        { ...buildSellerCancelCommandPayload(validation.value, order.product.quantity) },
                        `seller-cancel:v${order.version}`,
                    )
                    : Promise.reject(new Error("판매자 취소 입력값이 올바르지 않습니다."))
            )));
            const accepted = results.filter((result) => result.status === "fulfilled").length;
            const failures = results.flatMap((result, index) => {
                if (result.status === "fulfilled") return [];
                const order = liveTargets[index].order;
                const reason = result.reason instanceof Error
                    ? result.reason.message
                    : "알 수 없는 접수 오류";
                return [`${order.marketOrderId}: ${reason}`];
            });
            if (failures.length === 0) {
                toast.info(`${accepted}건의 판매자취소 명령을 접수했습니다.`);
                return true;
            }

            const visibleFailures = failures.slice(0, 3).join(" / ");
            const hiddenFailureCount = failures.length - Math.min(failures.length, 3);
            const failureSummary = `${visibleFailures}${hiddenFailureCount > 0 ? ` / 외 ${hiddenFailureCount}건` : ""}`;
            const message = [
                `${accepted}건 접수, ${failures.length}건 실패했습니다.`,
                `실패 주문: ${failureSummary}`,
                "창을 유지했습니다. 원인을 수정한 뒤 다시 실행하세요. 이미 접수된 주문은 같은 멱등키로 중복 처리되지 않습니다.",
            ].join(" ");
            toast.error(message);
            return { accepted: false, message };
        }

        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        setAllOrders((current) => current.map((item) => (
            targetIds.has(item.id) && item.status === "NEW"
                ? createSellerCanceledOrder(item, now)
                : item
        )));
        toast.success(`${targetOrders.length}건을 판매자취소로 처리했습니다.`);
        return true;
    }, [allOrders, enqueueApiCommand]);

    const handleApproveCancelClaim = useCallback((order: Order) => {
        if (order.dataSource === "api") {
            toast.info("실주문 취소승인 어댑터는 아직 활성화되지 않아 상태를 변경하지 않았습니다.");
            return;
        }
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");

        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? {
                    ...item,
                    claimStatus: "취소승인 전송완료",
                    claimProcessedAt: now,
                    failureReason: "구매자 취소요청 승인 완료",
                }
                : item
        )));
        toast.success(`${order.marketOrderId} 주문의 취소승인을 마켓에 전송했습니다.`);
    }, []);

    const handleRejectCancelClaim = useCallback((order: Order) => {
        if (order.dataSource === "api") {
            toast.info("실주문 취소거부 어댑터는 아직 활성화되지 않아 상태를 변경하지 않았습니다.");
            return;
        }
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");

        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? {
                    ...item,
                    claimStatus: "취소거부 전송완료",
                    claimProcessedAt: now,
                    failureReason: "구매자 취소요청 거부 완료",
                }
                : item
        )));
        toast.success(`${order.marketOrderId} 주문의 취소거부를 마켓에 전송했습니다.`);
    }, []);

    const handleSendInvoice = useCallback(async (orderIds: string[], mode: "auto" | "manual" = "manual") => {
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const selectedOrders = allOrders.filter((order) => orderIds.includes(order.id));
        const unpaidOrders = selectedOrders.filter((order) => !hasCompletedPurchase(order));
        const targetOrders = selectedOrders.filter((order) => hasCompletedPurchase(order) && order.domesticInvoice && !order.domesticInvoice.uploadedToMarketAt && order.marketDeliveryMethod !== "DIRECT_DELIVERY");

        if (targetOrders.length === 0) {
            toast.info(unpaidOrders.length > 0
                ? "결제가 완료되지 않은 주문은 배송중으로 처리할 수 없습니다."
                : "배송중 처리할 국내송장번호가 없습니다.");
            return;
        }

        const liveOrders = targetOrders.filter((order) => order.dataSource === "api");
        if (liveOrders.length > 0) {
            const results = await Promise.allSettled(liveOrders.map((order) => enqueueApiCommand(
                order,
                "INVOICE_SUBMIT",
                {
                    carrierCode: toMarketCarrierCode(order.domesticInvoice!.carrier),
                    trackingNumber: order.domesticInvoice!.trackingNumber,
                    dispatchAt: new Date().toISOString(),
                },
                `invoice:${order.domesticInvoice!.carrier}:${order.domesticInvoice!.trackingNumber}`,
            )));
            const accepted = results.filter((result) => result.status === "fulfilled").length;
            const failed = results.length - accepted;
            if (accepted > 0) toast.info(`${accepted}건의 송장 전송 명령을 접수했습니다.${failed ? ` ${failed}건은 실패했습니다.` : ""}`);
            else toast.error("송장 전송 명령을 접수하지 못했습니다.");
            return;
        }

        const invoices = targetOrders.map((order) => ({
            orderId: order.id,
            carrier: order.domesticInvoice!.carrier,
            trackingNumber: order.domesticInvoice!.trackingNumber,
            receivedAt: order.domesticInvoice!.receivedAt,
            uploadedToMarketAt: now,
            source: order.domesticInvoice!.source,
            uploadMode: mode,
        }));

        invoices.forEach(saveSyncedInvoice);
        setAllOrders((current) => applyCachedState(current, [], [], invoices));
        toast.success(`배송중 처리 완료: ${invoices.length}건을 마켓에 전송하고 배송중으로 이동했습니다.`);
    }, [allOrders, enqueueApiCommand]);

    const handleSendSingleInvoice = useCallback(async (order: Order, carrier?: string, trackingNumber?: string) => {
        if (!hasCompletedPurchase(order)) {
            toast.info("결제가 완료되지 않은 주문은 배송중으로 처리할 수 없습니다.");
            return;
        }
        const normalizedTrackingNumber = (trackingNumber ?? order.domesticInvoice?.trackingNumber ?? "").trim();

        if (!normalizedTrackingNumber) {
            toast.info("배송중 처리할 국내송장번호가 없습니다.");
            return;
        }

        if (order.dataSource === "api") {
            const resolvedCarrier = carrier ?? order.domesticInvoice?.carrier ?? "CJ대한통운";
            try {
                await enqueueApiCommand(order, "INVOICE_SUBMIT", {
                    carrierCode: toMarketCarrierCode(resolvedCarrier),
                    trackingNumber: normalizedTrackingNumber,
                    dispatchAt: new Date().toISOString(),
                }, `invoice:${resolvedCarrier}:${normalizedTrackingNumber}`);
                toast.info(`${order.marketOrderId} 송장 전송 명령을 접수했습니다. 최종 성공은 마켓 대사 후 반영됩니다.`);
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "송장 전송 명령을 접수하지 못했습니다.");
            }
            return;
        }

        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const invoice: SyncedInvoice = {
            orderId: order.id,
            carrier: carrier ?? order.domesticInvoice?.carrier ?? "CJ대한통운",
            trackingNumber: normalizedTrackingNumber,
            receivedAt: order.domesticInvoice?.receivedAt ?? now,
            uploadedToMarketAt: now,
            source: order.domesticInvoice?.source ?? "manual",
            uploadMode: "manual",
        };

        saveSyncedInvoice(invoice);
        setAllOrders((current) => applyCachedState(current, [], [], [invoice]));
        toast.success(`배송중 처리 완료: ${order.marketOrderId} 주문을 마켓에 전송하고 배송중으로 이동했습니다.`);
    }, [enqueueApiCommand]);

    const handleDispatchDirectDelivery = useCallback(async (order: Order) => {
        if (order.dataSource === "api") {
            try {
                await enqueueApiCommand(order, "DIRECT_DELIVERY", {
                    dispatchAt: new Date().toISOString(),
                }, `direct-delivery:v${order.version}`);
                toast.info(`${order.marketOrderId} 직접전달 명령을 접수했습니다. 구매·국내송장 조건 충족 여부는 워커가 다시 확인합니다.`);
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "직접전달 명령을 접수하지 못했습니다.");
            }
            return;
        }

        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? {
                    ...item,
                    status: item.status === "READY_TO_SHIP" && hasCompletedPurchase(item) && item.domesticInvoice?.trackingNumber?.trim() ? "SHIPPING" as OrderStatus : item.status,
                    marketOrderStatus: "DELIVERING" as const,
                    marketDeliveryMethod: "DIRECT_DELIVERY" as const,
                }
                : item
        )));
        if (order.status === "READY_TO_SHIP" && hasCompletedPurchase(order) && order.domesticInvoice?.trackingNumber?.trim()) {
            toast.success(`${order.marketOrderId} 주문을 직접전달로 처리하고 실제 국내송장을 확인해 배송중으로 이동했습니다.`);
            return;
        }
        toast.success(`${order.marketOrderId} 주문을 직접전달로 마켓 발송처리했습니다. 남은 구매·송장 업무에 따라 내부 작업 단계를 유지합니다.`);
    }, [enqueueApiCommand]);

    const handleSaveInvoice = useCallback(async (order: Order, carrier: string, trackingNumber: string) => {
        if (order.marketDeliveryMethod === "DIRECT_DELIVERY" && !hasCompletedPurchase(order)) {
            toast.info("직접전달 주문은 소싱라이프 또는 외부 구매 완료 후 국내송장을 저장할 수 있습니다.");
            return;
        }
        if (!trackingNumber.trim()) {
            toast.info("국내송장번호를 입력하세요.");
            return;
        }

        if (order.dataSource === "api") {
            if (!order.version) {
                toast.error("주문 버전이 없어 송장을 저장할 수 없습니다. 새로고침해 주세요.");
                return;
            }

            const receivedAt = new Date().toISOString();
            try {
                const saved = await apiFetch<{
                    carrierCode: string;
                    trackingNumber: string;
                    receivedAt: string;
                    version: string;
                }>(`/api/order-items/${order.id}/domestic-invoice`, {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        expectedVersion: order.version,
                        carrierCode: toMarketCarrierCode(carrier),
                        trackingNumber: trackingNumber.trim(),
                        receivedAt,
                    }),
                });
                setAllOrders((current) => current.map((item) => item.id === order.id ? {
                    ...item,
                    version: saved.version,
                    domesticInvoice: {
                        carrier: saved.carrierCode,
                        trackingNumber: saved.trackingNumber,
                        receivedAt: saved.receivedAt,
                        source: "manual",
                    },
                } : item));
                toast.success(`${order.marketOrderId} 국내송장을 원장에 저장했습니다. 마켓 전송은 별도 명령으로 실행하세요.`);
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "국내송장을 저장하지 못했습니다.");
            }
            return;
        }

        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const invoice: SyncedInvoice = {
            orderId: order.id,
            carrier,
            trackingNumber: trackingNumber.trim(),
            receivedAt: order.domesticInvoice?.receivedAt ?? now,
            source: order.domesticInvoice?.source ?? "manual",
        };

        saveSyncedInvoice(invoice);
        setAllOrders((current) => applyCachedState(current, [], [], [invoice]));
        if (shouldMoveDirectDeliveryToShipping(order, true)) {
            toast.success(`${order.marketOrderId} 주문의 국내송장번호를 저장하고 배송중으로 이동했습니다.`);
            return;
        }
        toast.success(`${order.marketOrderId} 주문의 국내송장번호를 저장했습니다. 배송중 처리 전까지 발송대기에 유지됩니다.`);
        if (autoShipping && order.marketDeliveryMethod !== "DIRECT_DELIVERY") {
            window.setTimeout(() => handleSendInvoice([order.id], "auto"), 0);
        }
    }, [autoShipping, handleSendInvoice]);

    const handleSaveRecipientInfo = useCallback((order: Order, recipient: Recipient) => {
        if (order.dataSource === "api") {
            toast.info("실주문 배송정보 수정은 암호화 수취인 API가 연결된 뒤 활성화됩니다.");
            return;
        }
        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? {
                    ...item,
                    recipient,
                }
                : item
        )));
        toast.success(`${order.marketOrderId} 주문의 배송정보를 수정했습니다.`);
    }, []);

    const handleLiveSourcingMappingSaved = useCallback((
        order: Order,
        mapping: SavedLiveSourcingMapping,
    ) => {
        setAllOrders((current) => current.map((item) => item.id === order.id ? {
            ...item,
            version: mapping.orderItemVersion,
            sourcingLifeSyncStatus: "MATCH_SAVED",
            sourcingProgressStage: mapping.verificationProvenance === "SERVER_VERIFIED"
                ? "MATCHED"
                : "MATCH_PENDING_REVIEW",
            sourcingLifeSyncedAt: new Date().toISOString(),
            sourcingLifeMatch: {
                optionId: mapping.externalSkuId,
                optionName: Object.entries(mapping.selectedOption)
                    .map(([key, value]) => `${key}=${value}`)
                    .join(", "),
                quantity: item.product.quantity,
                estimatedCost: undefined,
            },
        } : item));
        void orderPageQuery.refetch();
    }, [orderPageQuery]);

    const orderColumnActions = useMemo<OrderColumnActions>(() => ({
            onOpenSourcing: setActiveSourcingOrder,
            onLiveSourcingMappingSaved: handleLiveSourcingMappingSaved,
            onSaveSourcingMatch: handleSaveSourcingMatch,
            onCreateSourcingPaymentWait: handleCreateSourcingPaymentWait,
            onCompleteSourcingPayment: handleCompleteSourcingPayment,
            onCompleteManualPurchase: handleCompleteManualPurchase,
            onSourcingAndAcceptOrder: handleSourcingAndAcceptOrder,
            onAcceptOrder: handleAcceptOrder,
            onCancelOrder: handleCancelOrder,
            onApproveCancelClaim: handleApproveCancelClaim,
            onRejectCancelClaim: handleRejectCancelClaim,
            onDispatchDirectDelivery: handleDispatchDirectDelivery,
            onSendInvoice: handleSendSingleInvoice,
            onSaveInvoice: handleSaveInvoice,
            onSaveRecipientInfo: handleSaveRecipientInfo,
        }),
        [handleLiveSourcingMappingSaved, handleSaveSourcingMatch, handleCreateSourcingPaymentWait, handleCompleteSourcingPayment, handleCompleteManualPurchase, handleSourcingAndAcceptOrder, handleAcceptOrder, handleCancelOrder, handleApproveCancelClaim, handleRejectCancelClaim, handleDispatchDirectDelivery, handleSendSingleInvoice, handleSaveInvoice, handleSaveRecipientInfo],
    );
    const orderColumns = useMemo(
        () => createColumns(orderColumnActions),
        [orderColumnActions],
    );

    const selectedOrders = useMemo(() => {
        return orders.filter((order) => rowSelection[order.id]);
    }, [orders, rowSelection]);
    const selectedOrderIds = selectedOrders.map((order) => order.id);
    const hasSelectedOrders = selectedOrderIds.length > 0;

    const sendVisibleInvoices = () => {
        handleSendInvoice(hasSelectedOrders ? selectedOrderIds : visibleBaseOrders.map((order) => order.id));
    };

    const invoiceActionOrders = hasSelectedOrders ? selectedOrders : visibleBaseOrders;
    const hasSendableInvoice = invoiceActionOrders.some((order) => order.domesticInvoice && !order.domesticInvoice.uploadedToMarketAt && order.marketDeliveryMethod !== "DIRECT_DELIVERY");
    const selectedCancelableNewOrders = selectedOrders.filter((order) => (
        order.status === "NEW" && order.marketDeliveryMethod !== "DIRECT_DELIVERY"
    ));
    const hasSelectedCancelableNewOrders = selectedCancelableNewOrders.length > 0;
    const acceptVisibleOrders = () => {
        if (!hasSelectedOrders) {
            toast.info("주문확인할 주문을 선택하세요.");
            return;
        }

        const targetOrders = selectedOrders;
        handleBulkAcceptOrders(targetOrders.filter((order) => order.status === "NEW").map((order) => order.id));
    };
    const cancelSelectedNewOrders = (
        intent: SellerCancelIntent,
    ): boolean | Promise<boolean | SellerCancelSubmitResult> => {
        if (!hasSelectedOrders) {
            toast.info("주문취소할 주문을 선택하세요.");
            return false;
        }

        return handleBulkCancelOrders(
            selectedCancelableNewOrders.map((order) => order.id),
            intent,
        );
    };

    const commonAction = (
        <div className="flex min-w-0 items-center gap-3">
            {collectionStatus ? (
                <span className="max-w-[320px] truncate text-xs text-slate-500" aria-live="polite" title={collectionStatus}>
                    {collectionStatus}
                </span>
            ) : null}
            <Button variant="outline" className="h-10 border-slate-200 bg-white shadow-none hover:border-sky-200 hover:bg-sky-50" disabled={collectingOrders} onClick={handleCollectOrders}>
                {collectingOrders ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                {collectingOrders ? "주문수집 중" : "주문수집"}
            </Button>
        </div>
    );

    const actionContent = activeView === "new" ? (
        <>
            <Button onClick={acceptVisibleOrders} disabled={!hasSelectedOrders}>
                주문확인
            </Button>
            <Button variant="outline" className="border-red-200 bg-white text-red-600 shadow-none hover:border-red-300 hover:bg-red-50 hover:text-red-700" onClick={() => setBulkCancelConfirmOpen(true)} disabled={!hasSelectedCancelableNewOrders}>
                주문취소
            </Button>
        </>
    ) : activeView === "preparing" ? (
        null
    ) : activeView === "waiting" ? (
        <Button className="h-10 bg-sky-600 shadow-sm hover:bg-sky-700" onClick={sendVisibleInvoices} disabled={!hasSendableInvoice}>
            배송중 처리
        </Button>
    ) : (
        null
    );

    const stateFilterContent = activeView === "claims" ? (
        <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border bg-white p-1">
                <Button
                    type="button"
                    size="sm"
                    variant={claimTypeFilter === "all" ? "default" : "ghost"}
                    className="h-8 whitespace-nowrap px-3"
                    onClick={() => setClaimTypeFilter("all")}
                >
                    전체 {claimTypeCounts.all}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={claimTypeFilter === "CANCEL" ? "default" : "ghost"}
                    className="h-8 whitespace-nowrap px-3"
                    onClick={() => setClaimTypeFilter("CANCEL")}
                >
                    취소 {claimTypeCounts.cancel}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={claimTypeFilter === "RETURN" ? "default" : "ghost"}
                    className="h-8 whitespace-nowrap px-3"
                    onClick={() => setClaimTypeFilter("RETURN")}
                >
                    반품 {claimTypeCounts.return}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={claimTypeFilter === "EXCHANGE" ? "default" : "ghost"}
                    className="h-8 whitespace-nowrap px-3"
                    onClick={() => setClaimTypeFilter("EXCHANGE")}
                >
                    교환 {claimTypeCounts.exchange}
                </Button>
            </div>
        </div>
    ) : (
        null
    );

    const optionContent = activeView === "preparing" || activeView === "waiting" ? (
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <Switch id="auto-shipping" checked={autoShipping} onCheckedChange={handleAutoShippingChange} />
            <Label htmlFor="auto-shipping" className="whitespace-nowrap text-xs text-slate-700">
                자동 배송중 처리 {autoShipping ? "ON" : "OFF"}
            </Label>
        </div>
    ) : (
        null
    );
    const stageFilterContent = (
        <div className="flex flex-wrap items-center gap-2">
            <Select value={sellerFilter} onValueChange={setSellerFilter}>
                <SelectTrigger className="h-10 w-[220px] border-slate-200 bg-white shadow-sm">
                    <SelectValue placeholder="판매처 전체" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">판매처 전체</SelectItem>
                    {sellerOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            <span className="flex min-w-0 items-center gap-2">
                                <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-sm border text-[10px] font-black leading-none", MARKET_BADGE_CLASSES[option.marketType])}>
                                    {MARKET_ABBREVIATIONS[option.marketType]}
                                </span>
                                <span className="truncate">{option.storeName}</span>
                            </span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Select value={activeStatusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                <SelectTrigger className="h-10 w-[150px] border-slate-200 bg-white shadow-sm">
                    <SelectValue placeholder="상태 전체" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">상태 전체</SelectItem>
                    {statusOptions.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );

    const title = activeView === "claims" ? "취소/반품/교환" : "주문관리";
    const tableColumns = orderColumns;

    return (
        <div className="min-h-svh bg-white">
            <div className="border-b border-slate-100 px-6 py-5 xl:px-8">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-4xl">
                        <h1 className="text-[24px] font-extrabold tracking-tight text-slate-950">{title}</h1>
                    </div>
                </div>
            </div>

            <div className="space-y-3 px-6 py-4 xl:px-8">
                <OrderSearch
                    baseData={visibleBaseOrders}
                    onSearch={setOrders}
                    commonAction={commonAction}
                />

                {!isClaimView && (
                    <div className="flex flex-wrap items-center gap-6 border-b border-slate-100 pt-2">
                        {collectionTabs.map((tab) => {
                            const isActive = activeView === tab.view;
                            return (
                                <Link
                                    key={tab.view}
                                    href={tab.href}
                                    className={cn(
                                        "flex h-10 items-center gap-2 border-b-2 border-transparent text-sm font-bold text-slate-500 transition hover:text-slate-900",
                                        isActive && "border-emerald-500 text-emerald-600",
                                    )}
                                >
                                    <span>{viewLabels[tab.view]}</span>
                                    <span className={cn(
                                        "rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500",
                                        isActive && "bg-emerald-50 text-emerald-600",
                                    )}>
                                        {statusCounts[tab.view]}
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                )}

                {(actionContent || stateFilterContent || optionContent || stageFilterContent) && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            {actionContent}
                        </div>
                        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                            {stageFilterContent}
                            {stateFilterContent}
                            {optionContent}
                        </div>
                    </div>
                )}
            </div>

            {isClaimView && (
                <div className="mx-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 xl:mx-8">
                    취소/반품/교환은 구매자가 요청했거나 마켓에서 수집된 클레임만 확인합니다. 판매자 직접 주문취소 건은 이 목록에 노출하지 않습니다.
                </div>
            )}

            <div className="px-6 pb-6 xl:px-8">
                <OrderTable
                    data={orders}
                    columns={tableColumns}
                    selectable={!isClaimView}
                    onRowSelectionChange={setRowSelection}
                    onSaveRecipientInfo={handleSaveRecipientInfo}
                    renderDetailActions={(order) => (
                        <OrderProcessActions order={order} actions={orderColumnActions} placement="detail" />
                    )}
                />
                {hasLiveOrders && orderPageQuery.hasNextPage ? (
                    <div className="flex justify-center border-t border-slate-100 pt-4">
                        <Button
                            variant="outline"
                            disabled={orderPageQuery.isFetchingNextPage}
                            onClick={() => orderPageQuery.fetchNextPage()}
                        >
                            {orderPageQuery.isFetchingNextPage ? "불러오는 중..." : "다음 주문 100건 불러오기"}
                        </Button>
                    </div>
                ) : null}
            </div>

            <SellerCancelDialog
                open={bulkCancelConfirmOpen}
                onOpenChange={setBulkCancelConfirmOpen}
                orderLabel="선택 주문"
                selectionCount={selectedCancelableNewOrders.length}
                hasLiveOrders={selectedCancelableNewOrders.some((order) => order.dataSource === "api")}
                onSubmit={cancelSelectedNewOrders}
            />
            <SellerCancelDialog
                open={sourcingCancelOrder !== null}
                onOpenChange={(open) => {
                    if (!open) setSourcingCancelOrder(null);
                }}
                orderLabel={sourcingCancelOrder?.marketOrderId ?? "선택 주문"}
                orderedQuantity={sourcingCancelOrder?.product.quantity}
                hasLiveOrders={sourcingCancelOrder?.dataSource === "api"}
                onSubmit={(intent) => (
                    sourcingCancelOrder ? handleCancelOrder(sourcingCancelOrder, intent) : false
                )}
            />
            <SourcingWorkflowDialog
                key={activeSourcingOrder?.id ?? "closed-sourcing-workflow"}
                order={activeSourcingOrder}
                open={activeSourcingOrder !== null}
                mode={getSourcingDialogMode(activeSourcingOrder)}
                onOpenChange={(open) => {
                    if (!open) setActiveSourcingOrder(null);
                }}
                onConfirmMatch={activeSourcingOrder?.status === "NEW" ? handleSourcingAndAcceptOrder : handleSaveSourcingMatch}
                onRequestCancel={(order) => {
                    setActiveSourcingOrder(null);
                    setSourcingCancelOrder(order);
                }}
                onCreatePaymentWait={handleCreateSourcingPaymentWait}
                onCompletePayment={handleCompleteSourcingPayment}
            />
        </div>
    );
}
