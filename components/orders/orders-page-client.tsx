"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { withBrowserSecurity } from "@/lib/client/http";
import type { SavedLiveSourcingMapping } from "@/components/orders/live-sourcing-mapping-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { OrderSearch } from "@/components/orders/shared/order-search";
import { OrderTable } from "@/components/orders/shared/order-table";
import { createColumns, getProcessActionVisibility, OrderProcessActions, type OrderColumnActions } from "@/components/orders/shared/columns";
import { hasStartedDomesticShipping, isDirectDeliveryEligible, ShippingProcessDialog, supportsDirectDelivery, supportsOverseasOtherDelivery, type ShippingProcessMethod } from "@/components/orders/shipping-process-dialog";
import { SourcingWorkflowDialog } from "@/components/orders/sourcing-workflow-dialog";
import {
    SellerCancelDialog,
    buildSellerCancelCommandPayload,
    validateSellerCancelDraft,
    type SellerCancelIntent,
    type SellerCancelSubmitResult,
} from "@/components/orders/seller-cancel-dialog";
import { ORDER_STATUSES } from "@/lib/constants/orders";
import {
    createDemoSellerCancelClaim,
    DEMO_SELLER_CANCEL_STORAGE_KEY,
    type DemoClaimDetail,
} from "@/lib/mock-data/claims";
import { mockLinkedStores } from "@/lib/mock-data/market-stores";
import {
    advanceDemoSourcingRefund,
    createSourcingRefundRequest,
    getSourcingRefundAvailability,
    prepareOrderForResourcingAfterRefund,
    submitDemoReturnLogistics,
    type SourcingReturnLogisticsDraft,
} from "@/lib/sourcing-refund";
import { getSourcingProgressViewMeta, hasCompletedSourcingPurchase, resolveSourcingProgressStage } from "@/lib/sourcing-progress";
import { ClaimType, MarketType, Order, OrderStatus, Recipient, SourcingForwarderSelection, SourcingLifeMatch, SourcingProgressStage, SourcingRefundDraft } from "@/types/order";

export type OrdersView = "all" | "new" | "preparing" | "waiting" | "shipping" | "delivered" | "claims";
type ClaimTypeFilter = "all" | ClaimType;
type OrderListStatus = Exclude<SourcingProgressStage, "MATCH_PENDING_REVIEW"> | "PURCHASE_CONFIRMED";
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
    uploadMode?: "auto" | "manual" | "crawler";
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
    initialOrders: Order[];
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
    paymentShippingFee?: string;
    internalWorkStatus: "NEW" | "PREPARING" | "READY_TO_SHIP" | "SHIPPING" | "DELIVERED" | "CANCELED" | "ON_HOLD";
    sourcingStatus: string;
    sourcingVerificationProvenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED" | null;
    marketFulfillmentStatus: string | null;
    marketDeliveryMethod: string | null;
    marketCarrierCode: string | null;
    marketTrackingNumber: string | null;
    marketShippingRegisteredAt: string | null;
    shippingProcessStarted: boolean;
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
    settings?: {
        shippingProcessPreference?: ShippingProcessMethod;
    };
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
    MATCHED: "매칭완료",
    PAYMENT_WAITING: "결제대기",
    EXTERNAL_PURCHASE: "결제완료",
    SOURCED: "결제완료",
    CHINA_SHIPPING: "중국배송중",
    CUSTOMS_CLEARANCE: "통관 중",
    DOMESTIC_SHIPPING: "국내 배송중",
    DELIVERED: "배송완료",
    PURCHASE_CONFIRMED: "구매확정",
};

const ALL_STATUS_FILTER_VALUES = (Object.keys(STATUS_FILTER_LABELS) as OrderListStatus[])
    .filter((value) => value !== "EXTERNAL_PURCHASE");

const STATUS_FILTER_VALUES_BY_VIEW: Record<OrdersView, readonly OrderListStatus[]> = {
    all: ALL_STATUS_FILTER_VALUES,
    new: ["MATCH_REQUIRED"],
    preparing: ["MATCH_REQUIRED", "MATCHED", "PAYMENT_WAITING"],
    waiting: ["SOURCED", "CHINA_SHIPPING", "CUSTOMS_CLEARANCE", "DOMESTIC_SHIPPING"],
    shipping: ["SOURCED", "CHINA_SHIPPING", "CUSTOMS_CLEARANCE", "DOMESTIC_SHIPPING"],
    delivered: ["DELIVERED", "PURCHASE_CONFIRMED"],
    claims: ["MATCH_REQUIRED", "MATCHED", "PAYMENT_WAITING", "SOURCED", "CHINA_SHIPPING", "CUSTOMS_CLEARANCE", "DOMESTIC_SHIPPING", "DELIVERED"],
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
    const visibleSourcingStage: Exclude<SourcingProgressStage, "MATCH_PENDING_REVIEW"> = sourcingStage === "MATCH_PENDING_REVIEW"
        ? "MATCH_REQUIRED"
        : sourcingStage;
    const statuses: OrderListStatus[] = [
        order.status === "DELIVERED"
            ? "DELIVERED"
            : visibleSourcingStage === "EXTERNAL_PURCHASE" ? "SOURCED" : visibleSourcingStage,
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

function hasCompletedMarketDispatch(order: Order) {
    return order.marketOrderStatus === "DELIVERING"
        || order.marketOrderStatus === "DELIVERED"
        || order.marketOrderStatus === "PURCHASE_DECIDED";
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
                status: hasCompletedMarketDispatch(nextOrder) ? "SHIPPING" as OrderStatus : "READY_TO_SHIP" as OrderStatus,
                sourcingLifeSyncStatus: "PAID" as const,
                sourcingProgressStage: "SOURCED" as const,
                sourcingLifeOrderId: payment.sourcingLifeOrderId,
                sourcingLifeSyncedAt: payment.paidAt,
                taoWorldPurchase: nextOrder.taoWorldPurchase ?? createDemoTaoWorldPurchase(
                    nextOrder.id,
                    payment.paidAt,
                    payment.actualPaymentAmount,
                ),
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
                status: uploadedToMarketAt ? "SHIPPING" as OrderStatus : nextOrder.status,
                marketOrderStatus: uploadedToMarketAt ? "DELIVERING" as const : nextOrder.marketOrderStatus,
                marketDeliveryMethod: uploadedToMarketAt ? "DELIVERY" as const : nextOrder.marketDeliveryMethod,
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

        return nextOrder;
    });
}

function createDummyInvoice(orderId: string, index: number, uploadedToMarketAt?: string, uploadMode?: "auto" | "manual" | "crawler"): SyncedInvoice {
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

function createDemoTaoWorldPurchase(orderId: string, paidAt: string, amountKrw: number): NonNullable<Order["taoWorldPurchase"]> {
    const digits = orderId.replace(/\D/g, "").slice(-12).padStart(12, "0");
    return {
        distributorId: "2100000927014",
        purchaseOrderId: `2608284${digits}`,
        purchaseOrderLineId: `2000${digits}`,
        payOrderId: `2597049${digits}`,
        currency: "CNY",
        paidAmountCny: Number(Math.max(0.01, amountKrw / 190).toFixed(2)),
        paidAt: paidAt.includes("T") ? paidAt : paidAt.replace(" ", "T") + ":00.000Z",
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

function saveDemoSellerCancelClaim(order: Order, canceledAt: string, reason: string): void {
    if (typeof window === "undefined") return;

    let current: DemoClaimDetail[] = [];
    try {
        const stored = window.localStorage.getItem(DEMO_SELLER_CANCEL_STORAGE_KEY);
        const parsed: unknown = stored ? JSON.parse(stored) : [];
        current = Array.isArray(parsed) ? parsed as DemoClaimDetail[] : [];
    } catch {
        current = [];
    }

    const nextClaim = createDemoSellerCancelClaim(order, canceledAt, reason);
    const withoutSameOrder = current.filter((claim) => claim.salesOrderId !== order.id);
    window.localStorage.setItem(DEMO_SELLER_CANCEL_STORAGE_KEY, JSON.stringify([nextClaim, ...withoutSameOrder]));
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

export function mapApiManagedOrderStatus(
    status: ApiOrderItem["internalWorkStatus"],
    sourcingStatus: string,
): OrderStatus {
    void sourcingStatus;
    return mapApiOrderStatus(status);
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
        status: mapApiManagedOrderStatus(item.internalWorkStatus, item.sourcingStatus),
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
        paymentShippingFee: Number(item.paymentShippingFee ?? 0),
        platformFee: 0,
        expectedSettlement: Number(item.itemTotal),
        sourcingLifeSyncStatus: mapApiSourcingStatus(item.sourcingStatus),
        sourcingProgressStage: item.sourcingVerificationProvenance === "MANUAL_UNVERIFIED"
            ? "MATCH_PENDING_REVIEW"
            : mapApiProgress(item.sourcingStatus),
        marketOrderStatus: mapApiMarketOrderStatus(item.marketFulfillmentStatus),
        marketDeliveryMethod: item.marketDeliveryMethod === "DIRECT_DELIVERY"
            ? "DIRECT_DELIVERY"
            : item.marketDeliveryMethod === "OVERSEAS_OTHER_DELIVERY"
                ? "OVERSEAS_OTHER_DELIVERY"
                : item.marketDeliveryMethod === "DELIVERY" ? "DELIVERY" : undefined,
        marketShippingReference: item.marketDeliveryMethod === "OVERSEAS_OTHER_DELIVERY" && item.marketTrackingNumber ? {
            carrier: item.marketCarrierCode === "CH1" ? "해외기타택배" : item.marketCarrierCode ?? "해외기타택배",
            trackingNumber: item.marketTrackingNumber,
            registeredAt: item.marketShippingRegisteredAt ?? order.orderedAt,
        } : undefined,
        shippingProcessStarted: item.shippingProcessStarted,
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

function getSourcingDialogMode(order: Order | null): "match-only" | "payment" | "progress" {
    if (!order || order.status === "NEW") return "match-only";
    const progressView = getSourcingProgressViewMeta(order);
    return progressView && progressView.stage !== "PAYMENT_WAITING" ? "progress" : "payment";
}

export function OrdersPageClient({ activeView, initialOrders }: OrdersPageClientProps) {
    const [allOrders, setAllOrders] = useState<Order[]>(initialOrders);
    const previousOrderStatusesRef = useRef(new Map(initialOrders.map((order) => [order.id, order.status])));
    const [transitionedOrderIds, setTransitionedOrderIds] = useState<Set<string>>(new Set());
    const [activeSourcingOrder, setActiveSourcingOrder] = useState<Order | null>(null);
    const [sourcingCancelOrder, setSourcingCancelOrder] = useState<Order | null>(null);
    const [collectingOrders, setCollectingOrders] = useState(false);
    const [collectionStatus, setCollectionStatus] = useState<string | null>(null);
    const [autoShipping, setAutoShipping] = useState(false);
    const [claimTypeFilter, setClaimTypeFilter] = useState<ClaimTypeFilter>("all");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
    const [bulkCancelConfirmOpen, setBulkCancelConfirmOpen] = useState(false);
    const [bulkShippingOrders, setBulkShippingOrders] = useState<Order[]>([]);
    const isClaimView = activeView === "claims";

    useEffect(() => {
        try {
            setAutoShipping(window.localStorage.getItem(AUTO_SHIPPING_STORAGE_KEY) === "true");
        } catch {
            toast.warning("자동 배송중 처리 설정을 불러오지 못했습니다.");
        }
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            try {
                const stored = window.localStorage.getItem(DEMO_SELLER_CANCEL_STORAGE_KEY);
                const parsed: unknown = stored ? JSON.parse(stored) : [];
                if (!Array.isArray(parsed)) return;

                const canceledAtByOrderId = new Map(
                    (parsed as DemoClaimDetail[]).map((claim) => [claim.salesOrderId, claim.completedAt ?? claim.requestedAt]),
                );
                setAllOrders((current) => current.map((order) => {
                    const canceledAt = canceledAtByOrderId.get(order.id);
                    return canceledAt ? createSellerCanceledOrder(order, canceledAt) : order;
                }));
            } catch {
                // A damaged demo cache must not block the built-in order scenarios.
            }
        }, 0);

        return () => window.clearTimeout(timer);
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
    const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = orderPageQuery;

    useEffect(() => {
        if (
            hasNextPage
            && !isFetchingNextPage
            && !isFetchNextPageError
        ) {
            void fetchNextPage();
        }
    }, [
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError,
    ]);
    const marketAccountsQuery = useQuery({
        queryKey: ["market-accounts", "shipping-process-preferences"],
        queryFn: () => apiFetch<ApiMarketAccountSummary[]>("/api/market-accounts"),
        retry: false,
    });
    const shippingPreferenceByAccount = useMemo(() => new Map(
        (marketAccountsQuery.data ?? []).map((account) => [
            account.id,
            account.settings?.shippingProcessPreference,
        ]),
    ), [marketAccountsQuery.data]);
    const getShippingProcessDefault = useCallback((order: Order): ShippingProcessMethod => {
        if (order.marketDeliveryMethod === "DIRECT_DELIVERY" && supportsDirectDelivery(order)) return "DIRECT_DELIVERY";
        if (order.marketDeliveryMethod === "OVERSEAS_OTHER_DELIVERY" && supportsOverseasOtherDelivery(order)) return "OVERSEAS_OTHER_DELIVERY";
        if (order.marketDeliveryMethod === "DELIVERY") return "DELIVERY";
        const preference = order.marketAccountId
            ? shippingPreferenceByAccount.get(order.marketAccountId)
            : undefined;
        if (supportsOverseasOtherDelivery(order) && preference === "OVERSEAS_OTHER_DELIVERY") {
            return "OVERSEAS_OTHER_DELIVERY";
        }
        if (supportsDirectDelivery(order) && preference === "DIRECT_DELIVERY") {
            return "DIRECT_DELIVERY";
        }
        return "DELIVERY";
    }, [shippingPreferenceByAccount]);
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
    const statusOptions = useMemo(() => getOrderStatusFilterOptions(activeView), [activeView]);
    const activeStatusFilter = statusFilter === "all" || STATUS_FILTER_VALUES_BY_VIEW[activeView].includes(statusFilter)
        ? statusFilter
        : "all";
    const stageFilteredOrders = useMemo(() => {
        return filteredBaseOrders.filter((order) => {
            const matchesStatus = activeStatusFilter === "all" || getOrderListStatuses(order).includes(activeStatusFilter);
            return matchesStatus;
        });
    }, [activeStatusFilter, filteredBaseOrders]);
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
        const previousStatuses = previousOrderStatusesRef.current;
        const transitionedIds = allOrders.flatMap((order) => {
            const previousStatus = previousStatuses.get(order.id);
            return previousStatus && previousStatus !== order.status ? [order.id] : [];
        });

        previousOrderStatusesRef.current = new Map(allOrders.map((order) => [order.id, order.status]));
        if (transitionedIds.length > 0) {
            setTransitionedOrderIds((current) => new Set([...current, ...transitionedIds]));
        }
    }, [allOrders]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            window.localStorage.removeItem(SYNC_STORAGE_KEY);
            window.localStorage.removeItem(MATCH_STORAGE_KEY);
            window.localStorage.removeItem(PAYMENT_STORAGE_KEY);
            if (hasLiveOrders) {
                setAllOrders(toUiOrders(apiOrders));
            }
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
        type: "ORDER_CONFIRM" | "INVOICE_SUBMIT" | "DIRECT_DELIVERY" | "SHIPPING_PROCESS" | "SELLER_CANCEL",
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
        const selectedMethod = getShippingProcessDefault(order);
        const hasOverseasReference = Boolean(order.marketShippingReference?.trackingNumber.trim());
        const shouldAutoDispatchToMarket = autoShipping
            && selectedMethod !== "DELIVERY"
            && (selectedMethod !== "OVERSEAS_OTHER_DELIVERY" || hasOverseasReference);
        const sourcingLifeInvoice = createDummyInvoice(order.id, getOrderNumber(order));
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
        saveSourcingPayment(payment);
        saveSyncedInvoice(sourcingLifeInvoice);
        const createCompletedOrder = (item: Order): Order => ({
                    ...item,
                    status: (shouldAutoDispatchToMarket || hasCompletedMarketDispatch(item)) ? "SHIPPING" as OrderStatus : "READY_TO_SHIP" as OrderStatus,
                    marketOrderStatus: shouldAutoDispatchToMarket ? "DELIVERING" as const : item.marketOrderStatus,
                    marketDeliveryMethod: selectedMethod,
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
                    taoWorldPurchase: item.taoWorldPurchase ?? createDemoTaoWorldPurchase(
                        item.id,
                        now,
                        payment.actualPaymentAmount,
                    ),
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
        if (shouldAutoDispatchToMarket) {
            toast.success(`${order.marketOrderId} 주문의 구매를 완료하고 ${selectedMethod === "DIRECT_DELIVERY" ? "직접전달" : "해외기타배송"} 방식으로 마켓과 내부 상태를 배송중으로 변경했습니다.`);
            return true;
        }
        if (order.marketDeliveryMethod === "DIRECT_DELIVERY" && hasCompletedMarketDispatch(order)) {
            toast.success(`${order.marketOrderId} 주문의 결제와 송장을 반영했습니다. 마켓 직접전달 상태를 유지하며 배송중에서 관리합니다.`);
            return true;
        }
        toast.success(`${order.marketOrderId} 주문의 소싱라이프 구매가 완료되었습니다. 마켓은 아직 발송 전이므로 발송대기에서 관리합니다.`);
        return true;
    }, [autoShipping, getShippingProcessDefault, saveSourcingMatch]);

    const handleCompleteManualPurchase = useCallback((order: Order) => {
        if (order.dataSource === "api") {
            toast.info("실제 주문의 직접구매 배송처리는 현재 준비 중입니다. 주문 상태는 변경되지 않았습니다.");
            return;
        }

        const configuredMethod = getShippingProcessDefault(order);
        const configuredMethodLabel = configuredMethod === "DIRECT_DELIVERY"
            ? "직접전달"
            : configuredMethod === "OVERSEAS_OTHER_DELIVERY"
                ? "해외기타배송"
                : "송장입력";
        setAllOrders((current) => current.map((item) => {
            if (item.id !== order.id) return item;

            return {
                ...item,
                status: "READY_TO_SHIP" as OrderStatus,
                marketDeliveryMethod: configuredMethod,
                marketShippingReference: undefined,
                sourcingLifeSyncStatus: "NOT_LINKED" as const,
                sourcingProgressStage: "EXTERNAL_PURCHASE" as const,
                sourcingLifeOrderId: undefined,
                sourcingLifeActualPayment: undefined,
                domesticInvoice: undefined,
            };
        }));

        toast.success(`${order.marketOrderId} 주문의 직접구매를 완료했습니다. ${configuredMethodLabel} 기본값으로 발송대기에서 관리합니다.`);
    }, [getShippingProcessDefault]);

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

        const now = new Date().toISOString();
        saveDemoSellerCancelClaim(order, now, intent.reasonDetail);
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

        const now = new Date().toISOString();
        targetOrders.forEach((targetOrder) => saveDemoSellerCancelClaim(targetOrder, now, intent.reasonDetail));
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

    const handleProcessShipping = useCallback(async (
        order: Order,
        requestedMethod?: ShippingProcessMethod,
        overseasTrackingNumber?: string,
    ) => {
        const marketDispatchCompleted = hasCompletedMarketDispatch(order);
        const hasDomesticInvoice = Boolean(order.domesticInvoice?.carrier?.trim() && order.domesticInvoice.trackingNumber?.trim());
        const manualPurchaseInvoiceReady = order.sourcingProgressStage === "EXTERNAL_PURCHASE" && hasDomesticInvoice;
        const resolvedMethod = marketDispatchCompleted
            ? order.marketDeliveryMethod ?? "DELIVERY"
            : requestedMethod ?? getShippingProcessDefault(order);
        const resolvedOverseasTracking = overseasTrackingNumber?.trim()
            || order.marketShippingReference?.trackingNumber?.trim();

        if (!hasCompletedPurchase(order)) {
            toast.info("배송중 처리는 소싱라이프 결제 또는 직접구매 배송처리를 완료한 뒤 사용할 수 있습니다.");
            return;
        }

        if (!marketDispatchCompleted && resolvedMethod === "DELIVERY" && !hasDomesticInvoice) {
            toast.info("송장으로 처리하려면 국내송장이 필요합니다.");
            return;
        }
        if (!marketDispatchCompleted
            && resolvedMethod === "DELIVERY"
            && !hasStartedDomesticShipping(order)
            && !manualPurchaseInvoiceReady) {
            toast.info("국내배송이 시작된 뒤에만 실제 송장을 마켓에 전송할 수 있습니다.");
            return;
        }
        if (!marketDispatchCompleted && resolvedMethod === "DIRECT_DELIVERY" && !isDirectDeliveryEligible(order)) {
            toast.info("직접전달은 네이버·11번가 주문에서만 사용할 수 있습니다.");
            return;
        }
        if (!marketDispatchCompleted && resolvedMethod === "OVERSEAS_OTHER_DELIVERY" && !supportsOverseasOtherDelivery(order)) {
            toast.info("해외기타배송은 네이버 주문에서만 사용할 수 있습니다.");
            return;
        }
        if (!marketDispatchCompleted && resolvedMethod === "OVERSEAS_OTHER_DELIVERY" && !resolvedOverseasTracking) {
            toast.info("해외기타배송으로 처리하려면 해외 운송장번호가 필요합니다.");
            return;
        }

        if (order.dataSource === "api") {
            setAllOrders((current) => current.map((item) => item.id === order.id
                ? { ...item, shippingProcessStarted: true }
                : item));
            try {
                await enqueueApiCommand(order, "SHIPPING_PROCESS", {
                    requestedMethod: resolvedMethod,
                    dispatchAt: new Date().toISOString(),
                    ...(resolvedMethod === "OVERSEAS_OTHER_DELIVERY" ? {
                        carrierCode: "CH1",
                        trackingNumber: resolvedOverseasTracking,
                    } : {}),
                }, `shipping-process:${resolvedMethod}:${resolvedMethod === "OVERSEAS_OTHER_DELIVERY" ? resolvedOverseasTracking : order.domesticInvoice?.trackingNumber ?? "none"}:v${order.version}`);
                toast.info(`${order.marketOrderId} 배송중 처리 명령을 접수했습니다. 백엔드가 마켓 발송 여부를 확인해 재전송 없이 처리합니다.`);
            } catch (error) {
                setAllOrders((current) => current.map((item) => item.id === order.id
                    ? { ...item, shippingProcessStarted: false }
                    : item));
                toast.error(error instanceof Error ? error.message : "배송중 처리 명령을 접수하지 못했습니다.");
            }
            return;
        }

        if (marketDispatchCompleted) {
            setAllOrders((current) => current.map((item) => (
                item.id === order.id
                    ? { ...item, status: "SHIPPING" as OrderStatus }
                    : item
            )));
            toast.success(`${order.marketOrderId} 주문을 마켓 재전송 없이 내부 배송중으로 변경했습니다.`);
            return;
        }

        if (resolvedMethod !== "DELIVERY") {
            const methodLabel = resolvedMethod === "DIRECT_DELIVERY" ? "직접전달" : "해외기타배송";
            const now = new Date().toISOString().slice(0, 16).replace("T", " ");
            setAllOrders((current) => current.map((item) => (
                item.id === order.id
                    ? {
                        ...item,
                        status: "SHIPPING" as OrderStatus,
                        marketOrderStatus: "DELIVERING" as const,
                        marketDeliveryMethod: resolvedMethod,
                        marketShippingReference: resolvedMethod === "OVERSEAS_OTHER_DELIVERY" ? {
                            carrier: "해외기타택배",
                            trackingNumber: resolvedOverseasTracking!,
                            registeredAt: now,
                        } : item.marketShippingReference,
                    }
                    : item
            )));
            toast.success(`${order.marketOrderId} 주문을 ${methodLabel}로 마켓 처리하고 내부도 배송중으로 이동했습니다.`);
            return;
        }

        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const invoice: SyncedInvoice = {
            orderId: order.id,
            carrier: order.domesticInvoice!.carrier,
            trackingNumber: order.domesticInvoice!.trackingNumber,
            receivedAt: order.domesticInvoice!.receivedAt,
            uploadedToMarketAt: now,
            source: order.domesticInvoice!.source ?? "manual",
            uploadMode: "manual",
        };
        saveSyncedInvoice(invoice);
        setAllOrders((current) => applyCachedState(current, [], [], [invoice]));
        toast.success(`배송중 처리 완료: ${order.marketOrderId} 주문을 송장으로 처리했습니다.`);
    }, [enqueueApiCommand, getShippingProcessDefault]);

    const handleSaveInvoice = useCallback((order: Order, carrier: string, trackingNumber: string) => {
        const pendingManualPurchase = order.status === "READY_TO_SHIP"
            && order.sourcingProgressStage === "EXTERNAL_PURCHASE";

        if (pendingManualPurchase) {
            if (order.dataSource === "api") {
                toast.info("실주문 운송장 수정 API가 연결된 뒤 사용할 수 있습니다.");
                return;
            }

            const now = new Date().toISOString().slice(0, 16).replace("T", " ");
            const invoice: SyncedInvoice = {
                orderId: order.id,
                carrier,
                trackingNumber: trackingNumber.trim(),
                receivedAt: order.domesticInvoice?.receivedAt ?? now,
                source: "manual",
                uploadMode: "manual",
            };
            saveSyncedInvoice(invoice);
            setAllOrders((current) => current.map((item) => item.id === order.id ? {
                ...item,
                domesticInvoice: {
                    carrier: invoice.carrier,
                    trackingNumber: invoice.trackingNumber,
                    receivedAt: invoice.receivedAt,
                    source: "manual" as const,
                    uploadMode: "manual" as const,
                },
            } : item));
            toast.success(`${order.marketOrderId} 주문의 운송장을 수정했습니다. 배송중 처리는 별도로 진행해주세요.`);
            return;
        }

        if (!hasStartedDomesticShipping(order)) {
            toast.info("국내배송이 시작된 뒤에만 마켓 운송장을 수정할 수 있습니다.");
            return;
        }

        if (order.dataSource === "api") {
            toast.info("운송장 수정은 마켓 API가 아닌 2차 로그인 인증·판매자센터 크롤링 작업입니다. 크롤링 커넥터 연결 후 실행할 수 있습니다.");
            return;
        }

        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const replacesProvisionalMarketMethod = hasCompletedMarketDispatch(order)
            && (order.marketDeliveryMethod === "DIRECT_DELIVERY" || order.marketDeliveryMethod === "OVERSEAS_OTHER_DELIVERY");
        const invoice: SyncedInvoice = {
            orderId: order.id,
            carrier,
            trackingNumber: trackingNumber.trim(),
            receivedAt: order.domesticInvoice?.receivedAt ?? now,
            uploadedToMarketAt: replacesProvisionalMarketMethod ? now : order.domesticInvoice?.uploadedToMarketAt,
            source: order.domesticInvoice?.source ?? "manual",
            uploadMode: replacesProvisionalMarketMethod ? "crawler" : order.domesticInvoice?.uploadMode,
        };

        saveSyncedInvoice(invoice);
        setAllOrders((current) => applyCachedState(current, [], [], [invoice]));
        toast.success(replacesProvisionalMarketMethod
            ? `${order.marketOrderId} 주문을 2차 로그인 인증·크롤링으로 실제 송장 방식에 갱신했습니다.`
            : `${order.marketOrderId} 주문의 운송장을 수정했습니다.`);
    }, []);

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

    const handleRequestSourcingRefund = useCallback((order: Order, draft: SourcingRefundDraft): boolean => {
        const availability = getSourcingRefundAvailability(order);
        if (!availability.canRequest) {
            toast.info(availability.reason ?? "이미 접수된 소싱환불이 있습니다.");
            return false;
        }
        if (order.dataSource === "api") {
            toast.info("실주문 환불은 TaoWorld 어댑터와 message/query 대사가 연결된 뒤 활성화됩니다.");
            return false;
        }

        try {
            const sourcingRefund = createSourcingRefundRequest(order, draft);
            setAllOrders((current) => current.map((item) => item.id === order.id ? {
                ...item,
                sourcingRefund,
            } : item));
            setActiveSourcingOrder((current) => current?.id === order.id ? {
                ...current,
                sourcingRefund,
            } : current);
            toast.success("TaoWorld submit 데모 응답을 생성했습니다. 마켓 클레임 상태는 변경하지 않았습니다.");
            return true;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "소싱환불 요청을 접수하지 못했습니다.");
            return false;
        }
    }, []);

    const handleAdvanceSourcingRefund = useCallback((order: Order): void => {
        if (!order.sourcingRefund || order.dataSource === "api") return;
        const advanceOrderRefund = (item: Order): Order => item.sourcingRefund ? {
            ...item,
            sourcingRefund: advanceDemoSourcingRefund(item.sourcingRefund),
        } : item;
        setAllOrders((current) => current.map((item) => item.id === order.id ? advanceOrderRefund(item) : item));
        setActiveSourcingOrder((current) => current?.id === order.id ? advanceOrderRefund(current) : current);
        toast.success("message_type=9 수신 후 query한 데모 상태로 갱신했습니다.");
    }, []);

    const handleSubmitSourcingReturnLogistics = useCallback((order: Order, draft: SourcingReturnLogisticsDraft): boolean => {
        if (!order.sourcingRefund || order.dataSource === "api") return false;
        try {
            const nextRefund = submitDemoReturnLogistics(order.sourcingRefund, draft);
            setAllOrders((current) => current.map((item) => item.id === order.id ? {
                ...item,
                sourcingRefund: nextRefund,
            } : item));
            setActiveSourcingOrder((current) => current?.id === order.id ? {
                ...current,
                sourcingRefund: nextRefund,
            } : current);
            toast.success("TaoWorld submit/logistics 데모 응답을 저장했습니다.");
            return true;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "반품 송장을 등록하지 못했습니다.");
            return false;
        }
    }, []);

    const handleRestartSourcingAfterRefund = useCallback((order: Order): void => {
        if (order.dataSource === "api") {
            toast.info("실주문 재소싱은 환불 완료 확인과 기존 구매 연결 해제 API가 연결된 뒤 활성화됩니다.");
            return;
        }

        try {
            const restartedOrder = prepareOrderForResourcingAfterRefund(order);
            setAllOrders((current) => current.map((item) => item.id === order.id ? restartedOrder : item));
            setActiveSourcingOrder(restartedOrder);
            toast.success("기존 환불 내역을 보존하고 새 소싱처 선택을 시작합니다.");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "다시 소싱을 시작하지 못했습니다.");
        }
    }, []);

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
            onProcessShipping: handleProcessShipping,
            getShippingProcessDefault,
            onSaveInvoice: handleSaveInvoice,
            onSaveRecipientInfo: handleSaveRecipientInfo,
            onRestartSourcingAfterRefund: handleRestartSourcingAfterRefund,
        }),
        [handleLiveSourcingMappingSaved, handleSaveSourcingMatch, handleCreateSourcingPaymentWait, handleCompleteSourcingPayment, handleCompleteManualPurchase, handleSourcingAndAcceptOrder, handleAcceptOrder, handleCancelOrder, handleApproveCancelClaim, handleRejectCancelClaim, handleProcessShipping, getShippingProcessDefault, handleSaveInvoice, handleSaveRecipientInfo, handleRestartSourcingAfterRefund],
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

    const shippingActionOrders = (hasSelectedOrders ? selectedOrders : visibleBaseOrders)
        .filter((order) => getProcessActionVisibility(order, "list").showShippingProcess);
    const hasProcessableShipping = shippingActionOrders.length > 0;
    const openBulkShippingProcess = () => {
        if (!hasProcessableShipping) {
            toast.info("배송중 처리할 주문이 없습니다.");
            return;
        }
        if (shippingActionOrders.every(hasCompletedMarketDispatch)) {
            void Promise.all(shippingActionOrders.map((order) => handleProcessShipping(order)));
            return;
        }
        setBulkShippingOrders(shippingActionOrders);
    };
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
                <span className="max-w-[320px] truncate text-xs text-muted-foreground" aria-live="polite" title={collectionStatus}>
                    {collectionStatus}
                </span>
            ) : null}
            <Button variant="outline" className="h-10 border-border bg-card shadow-none hover:border-border hover:bg-muted" disabled={collectingOrders} onClick={handleCollectOrders}>
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
            <Button variant="outline" className="border-border bg-card text-foreground shadow-none hover:border-border hover:bg-muted hover:text-foreground" onClick={() => setBulkCancelConfirmOpen(true)} disabled={!hasSelectedCancelableNewOrders}>
                주문취소
            </Button>
        </>
    ) : activeView === "preparing" ? (
        null
    ) : activeView === "waiting" ? (
        <Button className="h-10 bg-primary shadow-sm hover:bg-primary" onClick={openBulkShippingProcess} disabled={!hasProcessableShipping}>
            배송중 처리
        </Button>
    ) : (
        null
    );

    const stateFilterContent = activeView === "claims" ? (
        <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={claimTypeFilter}
            onValueChange={(value) => value && setClaimTypeFilter(value as ClaimTypeFilter)}
        >
                <ToggleGroupItem value="all">
                    전체 {claimTypeCounts.all}
                </ToggleGroupItem>
                <ToggleGroupItem value="CANCEL">
                    취소 {claimTypeCounts.cancel}
                </ToggleGroupItem>
                <ToggleGroupItem value="RETURN">
                    반품 {claimTypeCounts.return}
                </ToggleGroupItem>
                <ToggleGroupItem value="EXCHANGE">
                    교환 {claimTypeCounts.exchange}
                </ToggleGroupItem>
        </ToggleGroup>
    ) : (
        null
    );

    const optionContent = activeView === "preparing" || activeView === "waiting" ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 shadow-sm">
            <Switch id="auto-shipping" checked={autoShipping} onCheckedChange={handleAutoShippingChange} />
            <Label htmlFor="auto-shipping" className="whitespace-nowrap text-xs text-foreground">
                자동 배송중 처리 {autoShipping ? "ON" : "OFF"}
            </Label>
        </div>
    ) : (
        null
    );
    const stageFilterContent = (
        <div className="flex flex-wrap items-center gap-2">
            <Select value={activeStatusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                <SelectTrigger className="h-8 w-[150px] border-border bg-card shadow-sm">
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
        <div className="min-h-full p-4 sm:p-6 lg:p-8">
            <PageHeader
                title={title}
                eyebrow="COMMERCE LIFE · WORK QUEUE"
                description="마켓 주문을 수집하고 소싱·결제·배송 상태를 하나의 운영 작업 큐에서 처리합니다."
            />

            <Card className="mt-6 gap-0 overflow-hidden py-0">
            <CardHeader className="space-y-3 border-b border-border p-4 sm:p-5">
                <OrderSearch
                    baseData={visibleBaseOrders}
                    onSearch={setOrders}
                    linkedStores={mockLinkedStores.map((store) => ({
                        key: `${store.marketType}:${store.storeName}`,
                        marketType: store.marketType,
                        storeName: store.storeName,
                    }))}
                    middleContent={stageFilterContent}
                    commonAction={commonAction}
                />

                {!isClaimView && (
                    <div className="flex flex-wrap items-center gap-6 border-b border-border pt-2">
                        {collectionTabs.map((tab) => {
                            const isActive = activeView === tab.view;
                            return (
                                <Button key={tab.view} asChild size="sm" variant={isActive ? "secondary" : "ghost"}>
                                <Link href={tab.href}>
                                    <span>{viewLabels[tab.view]}</span>
                                    <Badge variant="outline">
                                        {statusCounts[tab.view]}
                                    </Badge>
                                </Link>
                                </Button>
                            );
                        })}
                    </div>
                )}

                {(actionContent || stateFilterContent || optionContent) && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            {actionContent}
                        </div>
                        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                            {stateFilterContent}
                            {optionContent}
                        </div>
                    </div>
                )}
            </CardHeader>

            {isClaimView && (
                <Alert className="mx-4 mt-4 w-auto sm:mx-5">
                    <AlertDescription>취소/반품/교환은 구매자가 요청했거나 마켓에서 수집된 클레임만 확인합니다. 판매자 직접 주문취소 건은 이 목록에 노출하지 않습니다.</AlertDescription>
                </Alert>
            )}

            <CardContent className="p-4 sm:p-5">
                <OrderTable
                    data={orders}
                    columns={tableColumns}
                    highlightedOrderIds={transitionedOrderIds}
                    selectable={!isClaimView}
                    onRowSelectionChange={setRowSelection}
                    onSaveRecipientInfo={handleSaveRecipientInfo}
                    renderDetailActions={(order) => (
                        <OrderProcessActions order={order} actions={orderColumnActions} placement="detail" />
                    )}
                />
            </CardContent>
            </Card>

            <SellerCancelDialog
                open={bulkCancelConfirmOpen}
                onOpenChange={setBulkCancelConfirmOpen}
                orderLabel="선택 주문"
                selectionCount={selectedCancelableNewOrders.length}
                hasLiveOrders={selectedCancelableNewOrders.some((order) => order.dataSource === "api")}
                onSubmit={cancelSelectedNewOrders}
            />
            <ShippingProcessDialog
                open={bulkShippingOrders.length > 0}
                orders={bulkShippingOrders}
                onOpenChange={(open) => {
                    if (!open) setBulkShippingOrders([]);
                }}
                onConfirm={async (method, overseasTrackingNumber) => {
                    await Promise.all(bulkShippingOrders.map((order) => handleProcessShipping(order, method, overseasTrackingNumber)));
                    setBulkShippingOrders([]);
                }}
                resolveMethod={getShippingProcessDefault}
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
                onRequestSourcingRefund={handleRequestSourcingRefund}
                onAdvanceSourcingRefund={handleAdvanceSourcingRefund}
                onSubmitSourcingReturnLogistics={handleSubmitSourcingReturnLogistics}
            />
        </div>
    );
}
