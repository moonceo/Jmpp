"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Globe2, LockKeyhole, PackageCheck, Settings2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { hasCompletedSourcingPurchase } from "@/lib/sourcing-progress";
import { cn } from "@/lib/utils";
import type { Order } from "@/types/order";

export type ShippingProcessMethod = "DELIVERY" | "DIRECT_DELIVERY" | "OVERSEAS_OTHER_DELIVERY";

interface ShippingProcessDialogProps {
    open: boolean;
    orders: Order[];
    onOpenChange: (open: boolean) => void;
    onConfirm: (method?: ShippingProcessMethod, overseasTrackingNumber?: string) => void | Promise<void>;
    resolveMethod?: (order: Order) => ShippingProcessMethod;
}

export function supportsDirectDelivery(order: Pick<Order, "marketType" | "dataSource">) {
    return order.marketType === "naver" || order.marketType === "11st";
}

export function isDirectDeliveryEligible(
    order: Pick<Order, "marketType" | "dataSource"> & Partial<Pick<Order, "marketDeliveryMethod">>,
) {
    return supportsDirectDelivery(order);
}

export function supportsOverseasOtherDelivery(order: Pick<Order, "marketType" | "dataSource">) {
    return order.marketType === "naver";
}

export function hasCompletedMarketShipping(order: Pick<Order, "marketOrderStatus">) {
    return order.marketOrderStatus === "DELIVERING"
        || order.marketOrderStatus === "DELIVERED"
        || order.marketOrderStatus === "PURCHASE_DECIDED";
}

export function hasStartedDomesticShipping(order: Pick<Order, "sourcingProgressStage">) {
    return order.sourcingProgressStage === "DOMESTIC_SHIPPING";
}

export function ShippingProcessDialog({
    open,
    orders,
    onOpenChange,
    onConfirm,
    resolveMethod,
}: ShippingProcessDialogProps) {
    const purchaseIncompleteOrders = useMemo(() => orders.filter((order) => !hasCompletedSourcingPurchase(order)), [orders]);
    const pendingOrders = useMemo(() => orders.filter((order) => !hasCompletedMarketShipping(order)), [orders]);
    const canUseStoreDefaults = pendingOrders.length > 1 && Boolean(resolveMethod);
    const [selectedMethod, setSelectedMethod] = useState<ShippingProcessMethod | "STORE_DEFAULT">("DELIVERY");
    const [overseasTrackingNumber, setOverseasTrackingNumber] = useState("");
    useEffect(() => {
        if (!open) return;
        const first = pendingOrders[0];
        setSelectedMethod(canUseStoreDefaults
            ? "STORE_DEFAULT"
            : first ? resolveMethod?.(first) ?? first.marketDeliveryMethod ?? "DELIVERY" : "DELIVERY");
        setOverseasTrackingNumber(first?.marketShippingReference?.trackingNumber ?? "");
    }, [canUseStoreDefaults, open, pendingOrders, resolveMethod]);

    const resolvedMethods = useMemo(() => new Map(pendingOrders.map((order) => [
        order.id,
        selectedMethod === "STORE_DEFAULT"
            ? resolveMethod?.(order) ?? order.marketDeliveryMethod ?? "DELIVERY"
            : selectedMethod,
    ])), [pendingOrders, resolveMethod, selectedMethod]);
    const missingInvoiceOrders = useMemo(() => pendingOrders.filter((order) => (
        resolvedMethods.get(order.id) === "DELIVERY"
        && !Boolean(order.domesticInvoice?.carrier?.trim() && order.domesticInvoice.trackingNumber?.trim())
    )), [pendingOrders, resolvedMethods]);
    const domesticShippingNotStartedOrders = useMemo(() => pendingOrders.filter((order) => (
        resolvedMethods.get(order.id) === "DELIVERY" && !hasStartedDomesticShipping(order)
    )), [pendingOrders, resolvedMethods]);
    const invalidDirectOrders = useMemo(() => pendingOrders.filter((order) => (
        resolvedMethods.get(order.id) === "DIRECT_DELIVERY" && !isDirectDeliveryEligible(order)
    )), [pendingOrders, resolvedMethods]);
    const invalidOverseasOrders = useMemo(() => pendingOrders.filter((order) => (
        resolvedMethods.get(order.id) === "OVERSEAS_OTHER_DELIVERY" && !supportsOverseasOtherDelivery(order)
    )), [pendingOrders, resolvedMethods]);
    const missingOverseasReferences = useMemo(() => pendingOrders.filter((order, index) => (
        resolvedMethods.get(order.id) === "OVERSEAS_OTHER_DELIVERY"
        && !(index === 0 && pendingOrders.length === 1 ? overseasTrackingNumber.trim() : order.marketShippingReference?.trackingNumber?.trim())
    )), [overseasTrackingNumber, pendingOrders, resolvedMethods]);
    const canSubmit = purchaseIncompleteOrders.length === 0
        && pendingOrders.length > 0
        && missingInvoiceOrders.length === 0
        && domesticShippingNotStartedOrders.length === 0
        && invalidDirectOrders.length === 0
        && invalidOverseasOrders.length === 0
        && missingOverseasReferences.length === 0;
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        setSubmitting(true);
        try {
            await onConfirm(
                selectedMethod === "STORE_DEFAULT" ? undefined : selectedMethod,
                overseasTrackingNumber.trim() || undefined,
            );
            onOpenChange(false);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>배송중 처리 확인</DialogTitle>
                    <DialogDescription>
                        소싱라이프 결제 또는 직접구매 완료가 확인된 주문만 실제 마켓 발송 방식으로 처리합니다.
                    </DialogDescription>
                </DialogHeader>

                <div className={cn("grid gap-2", canUseStoreDefaults ? "sm:grid-cols-4" : "sm:grid-cols-3")}>
                    {([
                        ...(canUseStoreDefaults ? [{ value: "STORE_DEFAULT" as const, label: "스토어별 기본값", description: "연동 설정을 주문별 적용", icon: Settings2 }] : []),
                        { value: "DIRECT_DELIVERY" as const, label: "직접전달", description: "송장 확정 전 우선 발송 처리", icon: PackageCheck },
                        { value: "OVERSEAS_OTHER_DELIVERY" as const, label: "해외기타배송", description: "해외 송장으로 우선 발송 처리", icon: Globe2 },
                        { value: "DELIVERY" as const, label: "송장입력", description: "국내배송이 시작된 실제 송장", icon: Truck },
                    ]).map((option) => {
                        const Icon = option.icon;
                        const selected = selectedMethod === option.value;
                        const disabled = option.value === "DIRECT_DELIVERY"
                            ? pendingOrders.some((order) => !isDirectDeliveryEligible(order))
                            : option.value === "OVERSEAS_OTHER_DELIVERY"
                                && pendingOrders.some((order) => !supportsOverseasOtherDelivery(order));
                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={disabled}
                                className={cn(
                                    "relative rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                                    selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:bg-muted/50",
                                )}
                                onClick={() => setSelectedMethod(option.value)}
                            >
                                {selected ? <CheckCircle2 className="absolute right-3 top-3 size-4 text-primary" /> : null}
                                <Icon className="mb-3 size-5" />
                                <div className="text-sm font-bold text-foreground">{option.label}</div>
                                <div className="mt-1 text-xs leading-5 text-muted-foreground">{disabled ? "선택 주문의 마켓에서 미지원" : option.description}</div>
                            </button>
                        );
                    })}
                </div>

                {selectedMethod === "OVERSEAS_OTHER_DELIVERY" && orders.length === 1 ? (
                    <div className="space-y-2">
                        <div className="text-xs font-semibold text-foreground">해외 운송장번호</div>
                        <Input
                            value={overseasTrackingNumber}
                            onChange={(event) => setOverseasTrackingNumber(event.target.value)}
                            placeholder="해외 운송장번호를 입력하세요"
                            className="font-mono"
                        />
                    </div>
                ) : null}

                <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    선택 {orders.length}건 · 마켓 발송 필요 {pendingOrders.length}건 · 이미 마켓 배송중 {orders.length - pendingOrders.length}건
                </div>

                <div className="flex gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    <LockKeyhole className="mt-0.5 size-4 shrink-0" />
                    <span>세 방식 모두 구매 완료가 선행조건입니다. 국내송장은 배대지 주문서 생성 직후 내부에 표시하되 마켓에는 보내지 않습니다. 직접전달·해외기타배송 선처리 주문은 실제 국내배송 시작 후 운송장 수정으로 갱신합니다.</span>
                </div>

                {purchaseIncompleteOrders.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
                        구매 미완료 주문 {purchaseIncompleteOrders.length}건이 포함되어 있습니다. 먼저 소싱라이프 결제 또는 직접구매 배송처리를 완료하세요.
                    </div>
                ) : null}

                {missingInvoiceOrders.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
                        송장전송 대상 {missingInvoiceOrders.length}건에 국내 택배사 또는 송장번호가 없습니다.
                    </div>
                ) : null}
                {domesticShippingNotStartedOrders.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
                        국내배송이 시작되지 않은 주문 {domesticShippingNotStartedOrders.length}건은 송장을 마켓에 전송할 수 없습니다.
                    </div>
                ) : null}
                {invalidDirectOrders.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
                        직접전달을 지원하지 않는 마켓 주문이 {invalidDirectOrders.length}건 포함되어 있습니다.
                    </div>
                ) : null}
                {invalidOverseasOrders.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
                        해외기타배송은 네이버 주문에서만 사용할 수 있습니다.
                    </div>
                ) : null}
                {missingOverseasReferences.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
                        해외기타배송 대상 {missingOverseasReferences.length}건에 해외 운송장번호가 없습니다.
                    </div>
                ) : null}

                <DialogFooter>
                    <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>취소</Button>
                    <Button disabled={submitting || !canSubmit} onClick={submit}>
                        {submitting ? "처리 중" : "배송중 처리"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
