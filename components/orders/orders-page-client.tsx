"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { OrderSearch } from "@/components/orders/shared/order-search";
import { OrderTable } from "@/components/orders/shared/order-table";
import { createColumns } from "@/components/orders/shared/columns";
import { ORDER_STATUSES } from "@/lib/constants/orders";
import { mockOrders } from "@/lib/mock-data/orders";
import { cn } from "@/lib/utils";
import { ClaimType, Order, OrderStatus, Recipient, SourcingLifeMatch } from "@/types/order";

export type OrdersView = "all" | "new" | "preparing" | "waiting" | "shipping" | "delivered" | "claims";
type WaitingInvoiceFilter = "all" | "with" | "without";
type ClaimTypeFilter = "all" | ClaimType;

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

const SYNC_STORAGE_KEY = "jumunpangpang.syncedInvoices";
const MATCH_STORAGE_KEY = "jumunpangpang.sourcingMatches";
const PAYMENT_STORAGE_KEY = "jumunpangpang.sourcingPayments";

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

const collectionTabs: Array<{ view: Exclude<OrdersView, "all" | "claims">; href: string }> = [
    { view: "new", href: "/orders?view=new" },
    { view: "preparing", href: "/orders?view=preparing" },
    { view: "waiting", href: "/orders?view=waiting" },
    { view: "shipping", href: "/orders?view=shipping" },
    { view: "delivered", href: "/orders?view=delivered" },
];

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
                sourcingLifeSyncedAt: cachedMatch.savedAt,
                sourcingLifeMatch: cachedMatch.match,
            }
            : order;

        if (payment) {
            nextOrder = {
                ...nextOrder,
                status: "READY_TO_SHIP" as OrderStatus,
                sourcingLifeSyncStatus: "PAID" as const,
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
            nextOrder = {
                ...nextOrder,
                status: invoice.uploadedToMarketAt ? "SHIPPING" as OrderStatus : nextOrder.status,
                sourcingLifeSyncStatus: isSourcingLifeInvoice ? "INVOICE_RECEIVED" as const : nextOrder.sourcingLifeSyncStatus,
                sourcingLifeSyncedAt: isSourcingLifeInvoice ? invoice.receivedAt : nextOrder.sourcingLifeSyncedAt,
                domesticInvoice: {
                    carrier: invoice.carrier,
                    trackingNumber: invoice.trackingNumber,
                    receivedAt: invoice.receivedAt,
                    uploadedToMarketAt: invoice.uploadedToMarketAt,
                    source: invoice.source ?? (isSourcingLifeInvoice ? "sourcing_life" : "manual"),
                    uploadMode: invoice.uploadMode,
                },
            };
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

function hasSourcingLifeInvoiceOnPayment(order: Order) {
    const orderNumber = getOrderNumber(order);
    return order.product.quantity > 1 || orderNumber % 4 === 0;
}

function createSellerCanceledOrder(order: Order, canceledAt: string): Order {
    return {
        ...order,
        status: "CANCELED" as OrderStatus,
        previousStatus: order.status === "CLAIM" || order.status === "CANCELED" ? order.previousStatus : order.status,
        sourcingLifeSyncStatus: "HOLD" as const,
        sellerCancelReason: "판매자 주문취소",
        sellerCanceledAt: canceledAt,
        failureReason: "판매자 주문취소 완료",
    };
}

export function OrdersPageClient({ activeView }: OrdersPageClientProps) {
    const [allOrders, setAllOrders] = useState<Order[]>(mockOrders);
    const [autoDomesticCollection, setAutoDomesticCollection] = useState(false);
    const [autoInvoiceSend, setAutoInvoiceSend] = useState(false);
    const [autoSourcingLifeShipping, setAutoSourcingLifeShipping] = useState(false);
    const [waitingInvoiceFilter, setWaitingInvoiceFilter] = useState<WaitingInvoiceFilter>("all");
    const [claimTypeFilter, setClaimTypeFilter] = useState<ClaimTypeFilter>("all");
    const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
    const [bulkCancelConfirmOpen, setBulkCancelConfirmOpen] = useState(false);
    const isClaimView = activeView === "claims";

    const filteredBaseOrders = useMemo(() => {
        const statuses = viewStatuses[activeView];
        return allOrders.filter((order) => {
            const matchesStatus = statuses.includes(order.status);
            return matchesStatus;
        });
    }, [activeView, allOrders]);
    const visibleBaseOrders = useMemo(() => {
        if (activeView === "claims") {
            let claimOrders = filteredBaseOrders;

            if (claimTypeFilter !== "all") {
                claimOrders = claimOrders.filter((order) => order.claimType === claimTypeFilter);
            }

            return claimOrders;
        }

        if (activeView !== "waiting" || waitingInvoiceFilter === "all") return filteredBaseOrders;

        return filteredBaseOrders.filter((order) => (
            waitingInvoiceFilter === "with" ? Boolean(order.domesticInvoice) : !order.domesticInvoice
        ));
    }, [activeView, claimTypeFilter, filteredBaseOrders, waitingInvoiceFilter]);
    const claimTypeCounts = useMemo(() => {
        return filteredBaseOrders.reduce((counts, order) => {
            if (order.claimType === "CANCEL") counts.cancel += 1;
            if (order.claimType === "RETURN") counts.return += 1;
            if (order.claimType === "EXCHANGE") counts.exchange += 1;
            return counts;
        }, { all: filteredBaseOrders.length, cancel: 0, return: 0, exchange: 0 });
    }, [filteredBaseOrders]);
    const waitingInvoiceCounts = useMemo(() => {
        return filteredBaseOrders.reduce((counts, order) => {
            if (order.domesticInvoice) counts.with += 1;
            else counts.without += 1;
            return counts;
        }, { all: filteredBaseOrders.length, with: 0, without: 0 });
    }, [filteredBaseOrders]);
    const statusCounts = useMemo(() => {
        return collectionTabs.reduce<Record<Exclude<OrdersView, "all" | "claims">, number>>((counts, tab) => {
            counts[tab.view] = allOrders.filter((order) => viewStatuses[tab.view].includes(order.status)).length;
            return counts;
        }, {
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
            setAllOrders(mockOrders);
        }, 0);

        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setOrders(visibleBaseOrders);
            setRowSelection({});
        }, 0);

        return () => window.clearTimeout(timer);
    }, [visibleBaseOrders]);

    const handleCollectOrders = () => {
        toast.success("활성화된 모든 연동 계정을 대상으로 주문수집을 실행했습니다.");
    };

    const saveSourcingMatch = useCallback((order: Order, match: SourcingLifeMatch) => {
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const cachedMatch = { orderId: order.id, match, savedAt: now };
        saveCachedMatch(cachedMatch);
        setAllOrders((current) => applyCachedState(current, [cachedMatch], [], []));
        return cachedMatch;
    }, []);

    const handleSaveSourcingMatch = useCallback((order: Order, match: SourcingLifeMatch) => {
        saveSourcingMatch(order, match);
        toast.success("소싱상품 매칭과 옵션을 저장했습니다.");
    }, [saveSourcingMatch]);

    const handleCompleteSourcingPayment = useCallback((order: Order, match: SourcingLifeMatch) => {
        const cachedMatch = saveSourcingMatch(order, match);
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const actualPaymentAmount = match.estimatedCost ? match.estimatedCost * (match.quantity ?? order.product.quantity) : order.expectedCost ?? 0;
        const sourcingLifeInvoice = hasSourcingLifeInvoiceOnPayment(order)
            ? createDummyInvoice(order.id, getOrderNumber(order), autoSourcingLifeShipping ? now : undefined, autoSourcingLifeShipping ? "auto" : undefined)
            : undefined;
        const payment: SourcingPayment = {
            orderId: order.id,
            sourcingLifeOrderId: `SL-${order.id.replace("ORD-", "")}`,
            paidAt: now,
            actualPaymentAmount,
        };

        saveSourcingPayment(payment);
        if (sourcingLifeInvoice) saveSyncedInvoice(sourcingLifeInvoice);
        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? {
                    ...item,
                    status: sourcingLifeInvoice?.uploadedToMarketAt ? "SHIPPING" as OrderStatus : "READY_TO_SHIP" as OrderStatus,
                    sourcingLifeSyncStatus: sourcingLifeInvoice ? "INVOICE_RECEIVED" as const : "PAID" as const,
                    sourcingLifeOrderId: payment.sourcingLifeOrderId,
                    sourcingLifeSyncedAt: sourcingLifeInvoice?.receivedAt ?? now,
                    sourcingLifeMatch: cachedMatch.match,
                    sourcingLifeActualPayment: {
                        amount: payment.actualPaymentAmount,
                        currency: "KRW" as const,
                        paidAt: now,
                    },
                    domesticInvoice: sourcingLifeInvoice
                        ? {
                            carrier: sourcingLifeInvoice.carrier,
                            trackingNumber: sourcingLifeInvoice.trackingNumber,
                            receivedAt: sourcingLifeInvoice.receivedAt,
                            uploadedToMarketAt: sourcingLifeInvoice.uploadedToMarketAt,
                            source: "sourcing_life" as const,
                            uploadMode: sourcingLifeInvoice.uploadMode,
                        }
                        : item.domesticInvoice,
                }
                : item
        )));
        if (sourcingLifeInvoice?.uploadedToMarketAt) {
            toast.success(`${order.marketOrderId} 주문의 소싱라이프 결제와 송장을 반영하고 배송중으로 이동했습니다.`);
            return;
        }
        if (sourcingLifeInvoice) {
            toast.success(`${order.marketOrderId} 주문의 소싱라이프 결제와 송장을 반영하고 발송대기로 이동했습니다.`);
            return;
        }
        toast.success(`${order.marketOrderId} 주문의 소싱라이프 결제 완료를 반영하고 발송대기로 이동했습니다.`);
    }, [autoSourcingLifeShipping, saveSourcingMatch]);

    const handleCompleteManualPurchase = useCallback((order: Order, invoice?: { carrier: string; trackingNumber: string }, sendNow = false) => {
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const syncedInvoice: SyncedInvoice | undefined = invoice
            ? {
                orderId: order.id,
                carrier: invoice.carrier,
                trackingNumber: invoice.trackingNumber.trim(),
                receivedAt: now,
                uploadedToMarketAt: sendNow ? now : undefined,
                source: "manual",
                uploadMode: sendNow ? "manual" : undefined,
            }
            : undefined;

        if (syncedInvoice) saveSyncedInvoice(syncedInvoice);
        setAllOrders((current) => current.map((item) => {
            if (item.id !== order.id) return item;

            return {
                ...item,
                status: sendNow ? "SHIPPING" as OrderStatus : "READY_TO_SHIP" as OrderStatus,
                sourcingLifeSyncStatus: item.sourcingLifeSyncStatus === "HOLD" ? "HOLD" as const : item.sourcingLifeSyncStatus,
                domesticInvoice: syncedInvoice
                    ? {
                        carrier: syncedInvoice.carrier,
                        trackingNumber: syncedInvoice.trackingNumber,
                        receivedAt: syncedInvoice.receivedAt,
                        uploadedToMarketAt: syncedInvoice.uploadedToMarketAt,
                        source: "manual" as const,
                        uploadMode: syncedInvoice.uploadMode,
                    }
                    : item.domesticInvoice,
            };
        }));

        if (sendNow) {
            toast.success(`${order.marketOrderId} 주문의 수동구매와 배송중 처리를 완료했습니다.`);
            return;
        }
        if (syncedInvoice) {
            toast.success(`${order.marketOrderId} 주문의 수동구매를 완료하고 송장번호를 저장했습니다.`);
            return;
        }
        toast.success(`${order.marketOrderId} 주문의 수동구매를 완료하고 발송대기로 이동했습니다.`);
    }, []);

    const handleSourcingAndAcceptOrder = useCallback((order: Order, match: SourcingLifeMatch) => {
        const cachedMatch = saveSourcingMatch(order, match);
        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? {
                    ...item,
                    status: "PREPARING" as OrderStatus,
                    sourcingLifeSyncStatus: "MATCH_SAVED" as const,
                    sourcingLifeSyncedAt: cachedMatch.savedAt,
                    sourcingLifeMatch: cachedMatch.match,
                }
                : item
        )));
        toast.success(`${order.marketOrderId} 주문을 소싱 매칭 후 주문확인하고 상품준비로 이동했습니다.`);
    }, [saveSourcingMatch]);

    const handleAcceptOrder = useCallback((order: Order) => {
        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? {
                    ...item,
                    status: "PREPARING" as OrderStatus,
                    sourcingLifeSyncStatus: item.sourcingLifeMatch ? "MATCH_SAVED" as const : item.sourcingLifeSyncStatus,
                }
                : item
        )));
        toast.success(`${order.marketOrderId} 주문을 주문확인하고 상품준비로 이동했습니다.`);
    }, []);

    const handleBulkAcceptOrders = useCallback((orderIds: string[]) => {
        const targetIds = new Set(orderIds);

        if (targetIds.size === 0) {
            toast.info("주문확인할 신규주문이 없습니다.");
            return;
        }

        setAllOrders((current) => current.map((item) => (
            targetIds.has(item.id) && item.status === "NEW"
                ? {
                    ...item,
                    status: "PREPARING" as OrderStatus,
                    sourcingLifeSyncStatus: item.sourcingLifeMatch ? "MATCH_SAVED" as const : item.sourcingLifeSyncStatus,
                }
                : item
        )));
        toast.success(`${targetIds.size}건을 주문확인하고 상품준비로 이동했습니다.`);
    }, []);

    const handleCancelOrder = useCallback((order: Order) => {
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? createSellerCanceledOrder(item, now)
                : item
        )));
        toast.success(`${order.marketOrderId} 주문을 판매자취소로 처리했습니다.`);
    }, []);

    const handleBulkCancelOrders = useCallback((orderIds: string[]) => {
        const targetIds = new Set(orderIds);
        const targetOrders = allOrders.filter((order) => targetIds.has(order.id) && order.status === "NEW");

        if (targetOrders.length === 0) {
            toast.info("주문취소할 신규주문을 선택하세요.");
            return;
        }

        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        setAllOrders((current) => current.map((item) => (
            targetIds.has(item.id) && item.status === "NEW"
                ? createSellerCanceledOrder(item, now)
                : item
        )));
        toast.success(`${targetOrders.length}건을 판매자취소로 처리했습니다.`);
    }, [allOrders]);

    const handleApproveCancelClaim = useCallback((order: Order) => {
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");

        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? {
                    ...item,
                    claimStatus: "취소승인 전송완료",
                    claimProcessedAt: now,
                    failureReason: "구매자 취소요청 승인 완료",
                    sourcingLifeSyncStatus: "HOLD" as const,
                }
                : item
        )));
        toast.success(`${order.marketOrderId} 주문의 취소승인을 마켓에 전송했습니다.`);
    }, []);

    const handleRejectCancelClaim = useCallback((order: Order) => {
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");

        setAllOrders((current) => current.map((item) => (
            item.id === order.id
                ? {
                    ...item,
                    claimStatus: "취소거부 전송완료",
                    claimProcessedAt: now,
                    failureReason: "구매자 취소요청 거부 완료",
                    sourcingLifeSyncStatus: "HOLD" as const,
                }
                : item
        )));
        toast.success(`${order.marketOrderId} 주문의 취소거부를 마켓에 전송했습니다.`);
    }, []);

    const handleSendInvoice = useCallback((orderIds: string[], mode: "auto" | "manual" = "manual") => {
        const now = new Date().toISOString().slice(0, 16).replace("T", " ");
        const targetOrders = allOrders.filter((order) => orderIds.includes(order.id) && order.domesticInvoice && !order.domesticInvoice.uploadedToMarketAt);

        if (targetOrders.length === 0) {
            toast.info("배송중 처리할 국내송장번호가 없습니다.");
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
    }, [allOrders]);

    const handleSendSingleInvoice = useCallback((order: Order, carrier?: string, trackingNumber?: string) => {
        const normalizedTrackingNumber = (trackingNumber ?? order.domesticInvoice?.trackingNumber ?? "").trim();

        if (!normalizedTrackingNumber) {
            toast.info("배송중 처리할 국내송장번호가 없습니다.");
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
    }, []);

    const handleSaveInvoice = useCallback((order: Order, carrier: string, trackingNumber: string) => {
        if (!trackingNumber.trim()) {
            toast.info("국내송장번호를 입력하세요.");
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
        toast.success(`${order.marketOrderId} 주문의 국내송장번호를 저장했습니다. 배송중 처리 전까지 배송중으로 이동하지 않습니다.`);
        if (autoInvoiceSend) {
            window.setTimeout(() => handleSendInvoice([order.id], "auto"), 0);
        }
    }, [autoInvoiceSend, handleSendInvoice]);

    const handleSaveRecipientInfo = useCallback((order: Order, recipient: Recipient) => {
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

    const orderColumns = useMemo(
        () => createColumns({
            onSaveSourcingMatch: handleSaveSourcingMatch,
            onCompleteSourcingPayment: handleCompleteSourcingPayment,
            onCompleteManualPurchase: handleCompleteManualPurchase,
            onSourcingAndAcceptOrder: handleSourcingAndAcceptOrder,
            onAcceptOrder: handleAcceptOrder,
            onCancelOrder: handleCancelOrder,
            onApproveCancelClaim: handleApproveCancelClaim,
            onRejectCancelClaim: handleRejectCancelClaim,
            onSendInvoice: handleSendSingleInvoice,
            onSaveInvoice: handleSaveInvoice,
            onSaveRecipientInfo: handleSaveRecipientInfo,
        }),
        [handleSaveSourcingMatch, handleCompleteSourcingPayment, handleCompleteManualPurchase, handleSourcingAndAcceptOrder, handleAcceptOrder, handleCancelOrder, handleApproveCancelClaim, handleRejectCancelClaim, handleSendSingleInvoice, handleSaveInvoice, handleSaveRecipientInfo],
    );

    const waitingOrders = useMemo(() => {
        return allOrders.filter((order) => order.status === "READY_TO_SHIP");
    }, [allOrders]);

    const selectedOrders = useMemo(() => {
        return orders.filter((order) => rowSelection[order.id]);
    }, [orders, rowSelection]);
    const selectedOrderIds = selectedOrders.map((order) => order.id);
    const hasSelectedOrders = selectedOrderIds.length > 0;

    const collectDomesticInvoices = useCallback((mode: "auto" | "manual", orderIds?: string[]) => {
        const sourceOrders = orderIds?.length
            ? waitingOrders.filter((order) => orderIds.includes(order.id))
            : waitingOrders;
        const targets = sourceOrders.filter((order) => !order.domesticInvoice && order.sourcingLifeOrderId);

        if (targets.length === 0) {
            if (mode === "manual") toast.info("소싱라이프 주문번호가 있고 국내송장이 없는 주문만 송장 수집할 수 있습니다.");
            return;
        }

        const invoices = targets.map((order, index) => createDummyInvoice(order.id, index, undefined, mode));

        invoices.forEach(saveSyncedInvoice);
        setAllOrders((current) => applyCachedState(current, [], [], invoices));

        if (mode === "manual") {
            toast.success(`송장 수집 완료: 국내송장 ${invoices.length}건을 소싱라이프 주문번호 기준으로 가져왔습니다.`);
        }
        if (autoInvoiceSend) {
            window.setTimeout(() => handleSendInvoice(invoices.map((invoice) => invoice.orderId), "auto"), 0);
        }
    }, [autoInvoiceSend, handleSendInvoice, waitingOrders]);

    useEffect(() => {
        if (!autoDomesticCollection || activeView !== "waiting") return;

        const timer = window.setInterval(() => {
            collectDomesticInvoices("auto");
        }, 8000);

        return () => window.clearInterval(timer);
    }, [activeView, autoDomesticCollection, collectDomesticInvoices]);

    const sendVisibleInvoices = () => {
        handleSendInvoice(hasSelectedOrders ? selectedOrderIds : visibleBaseOrders.map((order) => order.id));
    };

    const invoiceActionOrders = hasSelectedOrders ? selectedOrders : visibleBaseOrders;
    const collectActionOrders = hasSelectedOrders ? selectedOrders : visibleBaseOrders;
    const hasSendableInvoice = invoiceActionOrders.some((order) => order.domesticInvoice && !order.domesticInvoice.uploadedToMarketAt);
    const hasCollectableInvoice = collectActionOrders.some((order) => !order.domesticInvoice && order.sourcingLifeOrderId);
    const selectedCancelableNewOrders = selectedOrders.filter((order) => order.status === "NEW");
    const hasSelectedCancelableNewOrders = selectedCancelableNewOrders.length > 0;
    const acceptVisibleOrders = () => {
        if (!hasSelectedOrders) {
            toast.info("주문확인할 주문을 선택하세요.");
            return;
        }

        const targetOrders = selectedOrders;
        handleBulkAcceptOrders(targetOrders.filter((order) => order.status === "NEW").map((order) => order.id));
    };
    const cancelSelectedNewOrders = () => {
        if (!hasSelectedOrders) {
            toast.info("주문취소할 주문을 선택하세요.");
            return;
        }

        handleBulkCancelOrders(selectedCancelableNewOrders.map((order) => order.id));
        setBulkCancelConfirmOpen(false);
    };

    const commonAction = (
        <Button variant="outline" className="h-10 border-slate-200 bg-white shadow-none hover:border-sky-200 hover:bg-sky-50" onClick={handleCollectOrders}>
            주문수집
        </Button>
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
        <>
            <Select value={waitingInvoiceFilter} onValueChange={(value) => setWaitingInvoiceFilter(value as WaitingInvoiceFilter)}>
                <SelectTrigger className="h-10 w-[150px] border-slate-200 bg-white shadow-sm">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                    <SelectItem value="all">전체 {waitingInvoiceCounts.all}</SelectItem>
                    <SelectItem value="with">송장 있음 {waitingInvoiceCounts.with}</SelectItem>
                    <SelectItem value="without">송장 없음 {waitingInvoiceCounts.without}</SelectItem>
                </SelectContent>
            </Select>
            <Button variant="outline" className="h-10 border-slate-200 bg-white shadow-none hover:border-sky-200 hover:bg-sky-50" onClick={() => collectDomesticInvoices("manual", hasSelectedOrders ? selectedOrderIds : visibleBaseOrders.map((order) => order.id))} disabled={!hasCollectableInvoice}>
                소싱라이프 송장 수집
            </Button>
            <Button className="h-10 bg-sky-600 shadow-sm hover:bg-sky-700" onClick={sendVisibleInvoices} disabled={!hasSendableInvoice}>
                배송중 처리
            </Button>
        </>
    ) : activeView === "claims" ? (
        <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 flex items-center gap-1 rounded-md border bg-white p-1">
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

    const optionContent = activeView === "preparing" ? (
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <Switch id="auto-sourcing-life-shipping-preparing" checked={autoSourcingLifeShipping} onCheckedChange={setAutoSourcingLifeShipping} />
            <Label htmlFor="auto-sourcing-life-shipping-preparing" className="whitespace-nowrap text-xs text-slate-700">
                소싱라이프 송장 수신 시 자동 배송중 처리 {autoSourcingLifeShipping ? "ON" : "OFF"}
            </Label>
        </div>
    ) : activeView === "waiting" ? (
        <>
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <Switch id="auto-domestic-collection-waiting" checked={autoDomesticCollection} onCheckedChange={setAutoDomesticCollection} />
                <Label htmlFor="auto-domestic-collection-waiting" className="whitespace-nowrap text-xs text-slate-700">
                    소싱라이프 송장 자동 수집 {autoDomesticCollection ? "ON" : "OFF"}
                </Label>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <Switch id="auto-invoice-send-waiting" checked={autoInvoiceSend} onCheckedChange={setAutoInvoiceSend} />
                <Label htmlFor="auto-invoice-send-waiting" className="whitespace-nowrap text-xs text-slate-700">
                    자동 배송중 처리 {autoInvoiceSend ? "ON" : "OFF"}
                </Label>
            </div>
        </>
    ) : (
        null
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

                {(actionContent || optionContent) && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            {actionContent}
                        </div>
                        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
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
                <OrderTable data={orders} columns={tableColumns} selectable={!isClaimView} onRowSelectionChange={setRowSelection} onSaveRecipientInfo={handleSaveRecipientInfo} />
            </div>

            <Dialog open={bulkCancelConfirmOpen} onOpenChange={setBulkCancelConfirmOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>주문취소 확인</DialogTitle>
                        <DialogDescription>
                            선택한 신규주문 {selectedCancelableNewOrders.length}건을 주문취소 처리합니다. 계속 진행할까요?
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setBulkCancelConfirmOpen(false)}>
                            닫기
                        </Button>
                        <Button className="bg-red-600 hover:bg-red-700" onClick={cancelSelectedNewOrders} disabled={!hasSelectedCancelableNewOrders}>
                            주문취소
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
