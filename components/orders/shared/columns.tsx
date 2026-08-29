"use client";

import { useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, ExternalLink, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { RecipientEditDialog } from "@/components/orders/recipient-edit-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    SellerCancelDialog,
    type SellerCancelIntent,
} from "@/components/orders/seller-cancel-dialog";
import {
    LiveSourcingMappingDialog,
    type SavedLiveSourcingMapping,
} from "@/components/orders/live-sourcing-mapping-dialog";
import { OrderHistoryDialog } from "@/components/orders/order-history-dialog";
import {
    hasCompletedMarketShipping,
    hasStartedDomesticShipping,
    isDirectDeliveryEligible,
    ShippingProcessDialog,
    type ShippingProcessMethod,
} from "@/components/orders/shipping-process-dialog";
import { MARKET_ABBREVIATIONS, MARKET_BADGE_CLASSES, MARKET_LABELS, ORDER_STATUS_LABELS, SOURCING_LIFE_STATUS_LABELS } from "@/lib/constants/orders";
import { getDeliveryHistoryView } from "@/lib/delivery-history";
import { calculateOrderMargin } from "@/lib/order-margin";
import { getOrderShippingInformation } from "@/lib/order-shipping-information";
import { getOrderProgressLabel } from "@/lib/order-progress-status";
import {
    canRestartSourcingAfterRefund,
    getSourcingRefundAvailability,
    isSourcingRefundActive,
} from "@/lib/sourcing-refund";
import {
    getSourcingProgressViewMeta,
    hasCompletedSourcingPurchase,
} from "@/lib/sourcing-progress";
import { cn } from "@/lib/utils";
import { Order, Recipient, SourcingForwarderSelection, SourcingLifeMatch } from "@/types/order";

export interface OrderColumnActions {
    onOpenSourcing: (order: Order) => void;
    onLiveSourcingMappingSaved: (order: Order, mapping: SavedLiveSourcingMapping) => void;
    onSaveSourcingMatch: (order: Order, match: SourcingLifeMatch) => void;
    onCreateSourcingPaymentWait: (order: Order, match: SourcingLifeMatch, forwarder: SourcingForwarderSelection) => void;
    onCompleteSourcingPayment: (order: Order, match: SourcingLifeMatch) => void;
    onCompleteManualPurchase: (order: Order, purchase: ManualPurchaseDraft) => void;
    onSourcingAndAcceptOrder: (order: Order, match: SourcingLifeMatch) => void;
    onAcceptOrder: (order: Order) => void;
    onCancelOrder: (order: Order, intent: SellerCancelIntent) => boolean | Promise<boolean>;
    onApproveCancelClaim: (order: Order) => void;
    onRejectCancelClaim: (order: Order) => void;
    onProcessShipping: (order: Order, method?: ShippingProcessMethod, overseasTrackingNumber?: string) => void | Promise<void>;
    getShippingProcessDefault?: (order: Order) => ShippingProcessMethod;
    onSaveInvoice: (order: Order, carrier: string, trackingNumber: string) => void;
    onSaveRecipientInfo: (order: Order, recipient: Recipient) => void;
    onRestartSourcingAfterRefund: (order: Order) => void;
}

interface ManualPurchaseDraft {
    method: ShippingProcessMethod;
    carrier?: string;
    trackingNumber?: string;
}

const progressStatus = (order: Order) => order.previousStatus ?? order.status;

const isCancelClaimProcessed = (order: Order) => (
    order.claimStatus === "취소승인 전송완료"
    || order.claimStatus === "취소거부 전송완료"
);

const claimActionLabel = (order: Order) => {
    if (order.claimType === "CANCEL") return "취소처리";
    if (order.claimType === "RETURN") return "반품처리";
    if (order.claimType === "EXCHANGE") return "교환처리";
    return "클레임처리";
};

const customsState = (code?: string) => {
    return code?.trim() && /^P\d{12}$/.test(code.trim().toUpperCase()) ? "통관부호 일치" : "통관부호 불일치";
};

const hasValidPersonalCustomsCode = (code?: string) => Boolean(code?.trim() && /^P\d{12}$/.test(code.trim().toUpperCase()));

function ProductImageDialog({ order }: { order: Order }) {
    const [open, setOpen] = useState(false);

    const copyImage = async () => {
        try {
            await navigator.clipboard.writeText(order.product.thumbnail);
            toast.success("상품 이미지 주소를 복사했습니다.");
        } catch {
            toast.error("이미지 복사에 실패했습니다.");
        }
    };

    return (
        <>
            <Button type="button" variant="outline" size="icon" className="relative h-10 w-10 overflow-hidden rounded-md p-0 shadow-sm transition hover:ring-2 hover:ring-ring" onClick={() => setOpen(true)}>
                <Image src={order.product.thumbnail} alt={order.product.name} fill sizes="48px" className="object-cover" />
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>이미지 크게 보기</DialogTitle>
                        <DialogDescription>{order.product.name}</DialogDescription>
                    </DialogHeader>
                    <div className="relative aspect-square overflow-hidden rounded-md border bg-card">
                        <Image src={order.product.thumbnail} alt={order.product.name} fill sizes="560px" className="object-contain" />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={copyImage}>
                            이미지 복사
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function ProductInfoCell({ order }: { order: Order }) {
    return (
        <div className="flex min-w-0 items-start gap-2.5">
            <ProductImageDialog order={order} />
            <div className="min-w-0 space-y-1">
                {order.product.marketLink ? (
                    <a className="line-clamp-2 text-sm font-semibold leading-4 text-foreground hover:text-foreground hover:underline" href={order.product.marketLink} target="_blank" rel="noopener noreferrer">
                        {order.product.name}
                        <ExternalLink className="ml-1 inline h-3 w-3" />
                    </a>
                ) : (
                    <div className="line-clamp-2 text-sm font-semibold leading-4 text-foreground">{order.product.name}</div>
                )}
                <div className="line-clamp-1 text-xs text-muted-foreground">{order.product.optionName}</div>
                <div className="text-xs font-medium text-muted-foreground">수량 {order.product.quantity}</div>
                <div className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                    <span className="shrink-0">마켓 주문번호 :</span>
                    <span className="truncate font-mono">{order.marketOrderId}</span>
                </div>
            </div>
        </div>
    );
}

function MarginInfoCell({ order }: { order: Order }) {
    const margin = calculateOrderMargin(order);
    const formatWon = (value: number) => `${Math.abs(value).toLocaleString()}원`;
    const signedWon = (value: number) => `${value < 0 ? "-" : ""}${formatWon(value)}`;

    return (
        <div
            className="min-w-0 space-y-1.5 text-xs tabular-nums"
            title="마진금 = 결제금액 - 매칭·결제 상품가격"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">결제금액</span>
                <span className="font-bold text-foreground">{formatWon(order.paymentPrice)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border pt-1.5">
                <span className="text-muted-foreground">마진율</span>
                {margin ? (
                    <Badge
                        variant="outline"
                        className={cn(
                            "h-5 px-1.5 font-bold tabular-nums",
                            margin.marginAmount < 0 && "border-destructive/40 text-destructive",
                        )}
                    >
                        {margin.marginRate.toFixed(1)}%
                    </Badge>
                ) : <span className="font-semibold text-muted-foreground">-</span>}
            </div>
            <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">마진금</span>
                <span className={cn("font-extrabold", margin?.marginAmount !== undefined && margin.marginAmount < 0 ? "text-destructive" : "text-foreground")}>
                    {margin ? signedWon(margin.marginAmount) : "-"}
                </span>
            </div>
        </div>
    );
}

function OrderDateCell({ order }: { order: Order }) {
    const [date, time] = order.orderDate.split(" ");

    return (
        <div className="min-w-0 space-y-1.5 text-xs tabular-nums">
            <div className="space-y-0.5">
                <div className="font-medium text-foreground">{date}</div>
                <div className="font-mono text-xs text-muted-foreground">{time ?? "-"}</div>
            </div>
            <div className="flex min-w-0 items-center gap-1.5 border-t border-border pt-1.5">
                <span
                    className={cn(
                        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[10px] font-extrabold leading-none",
                        MARKET_BADGE_CLASSES[order.marketType],
                    )}
                    title={MARKET_LABELS[order.marketType]}
                >
                    {MARKET_ABBREVIATIONS[order.marketType]}
                </span>
                <span className="min-w-0 truncate font-semibold text-foreground" title={order.storeName}>{order.storeName}</span>
            </div>
        </div>
    );
}

function SourcingLifeInfoCell({ order }: { order: Order }) {
    return (
        <Badge variant="outline" className="h-7 rounded-md border-border bg-muted px-2 text-xs font-semibold text-foreground">
            {getOrderProgressLabel(order)}
        </Badge>
    );
}

function DeliveryInfoCell({ order, actions }: { order: Order; actions: OrderColumnActions }) {
    const customs = customsState(order.recipient.personalCustomsCode);

    return (
        <div className="min-w-0 space-y-1 text-xs">
            <div className="truncate font-semibold text-foreground">{order.recipient.name}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{order.recipient.phone}</div>
            <div className="flex min-w-0 items-center gap-1.5 border-t border-border pt-1">
                <Badge
                    variant="outline"
                    className={cn(
                        "shrink-0 text-xs",
                        customs === "통관부호 일치"
                            ? "border-border bg-muted text-foreground"
                            : "border-border bg-muted text-foreground",
                    )}
                >
                    {customs}
                </Badge>
                <RecipientEditDialog
                    order={order}
                    onSaveRecipientInfo={actions.onSaveRecipientInfo}
                    className="ml-auto h-6 shrink-0"
                />
            </div>
        </div>
    );
}

function ClaimActionDialog({ order, actions, variant = "cell" }: { order: Order; actions: OrderColumnActions; variant?: "cell" | "footer" }) {
    const [open, setOpen] = useState(false);
    const isCancelClaim = order.claimType === "CANCEL";
    const isProcessed = isCancelClaimProcessed(order);
    const rows = [
        ["클레임 유형", order.claimType === "CANCEL" ? "취소" : order.claimType === "RETURN" ? "반품" : order.claimType === "EXCHANGE" ? "교환" : "-"],
        ["클레임 상태", order.claimStatus ?? "-"],
        ["클레임 사유", order.claimReason ?? "-"],
        ["클레임 접수일시", order.claimRequestedAt ?? "-"],
        ["처리완료일시", order.claimProcessedAt ?? "-"],
        ["현재 진행단계", ORDER_STATUS_LABELS[progressStatus(order)]],
        ["소싱라이프 주문번호", order.sourcingLifeOrderId ?? "-"],
        ["소싱상태", SOURCING_LIFE_STATUS_LABELS[order.sourcingLifeSyncStatus]],
        ["국내송장", order.domesticInvoice ? `${order.domesticInvoice.carrier} ${order.domesticInvoice.trackingNumber}` : "-"],
    ];

    const approveCancel = () => {
        actions.onApproveCancelClaim(order);
        setOpen(false);
    };

    const rejectCancel = () => {
        actions.onRejectCancelClaim(order);
        setOpen(false);
    };

    return (
        <>
            <Button
                size={variant === "cell" ? "sm" : "default"}
                variant="default"
                className={cn(variant === "cell" && "h-8 w-full whitespace-nowrap")}
                onClick={() => setOpen(true)}
            >
                {claimActionLabel(order)}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{claimActionLabel(order)}</DialogTitle>
                        <DialogDescription>
                            {order.marketOrderId} · {MARKET_LABELS[order.marketType]} · {order.storeName}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {rows.map(([label, value]) => (
                            <div key={label} className="rounded-md border bg-muted px-3 py-2 text-sm">
                                <div className="text-xs text-muted-foreground">{label}</div>
                                <div className="mt-1 break-words font-medium text-foreground">{value}</div>
                            </div>
                        ))}
                    </div>
                    {isCancelClaim ? (
                        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                            현재 진행단계와 소싱라이프 결제/송장 여부를 확인한 뒤 취소승인 또는 취소거부를 선택해 마켓에 전송합니다.
                        </div>
                    ) : (
                        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                            현재 진행단계와 주문 정보를 확인합니다. 반품/교환의 승인, 회수, 재발송 처리는 다음 클레임 처리 단계에서 확장합니다.
                        </div>
                    )}
                    <DialogFooter>
                        {isCancelClaim && isProcessed && (
                            <Badge variant="outline" className="mr-auto border-border bg-muted text-foreground">
                                처리완료
                            </Badge>
                        )}
                        {isCancelClaim && !isProcessed && (
                            <>
                                <Button variant="outline" onClick={rejectCancel}>
                                    취소거부
                                </Button>
                                <Button onClick={approveCancel}>
                                    취소승인
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function InvoiceInfoCell({ order }: { order: Order }) {
    const shippingInformation = getOrderShippingInformation(order);
    const domesticInvoice = shippingInformation.domesticTrackingNumber
        ? `${shippingInformation.domesticCarrier ?? "택배사 미확인"} ${shippingInformation.domesticTrackingNumber}`
        : "-";

    return (
        <div className="min-w-0 space-y-2 text-xs">
            <div className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-2">
                <span className="font-semibold text-muted-foreground">국내 송장번호</span>
                <span className="truncate whitespace-nowrap font-mono font-semibold text-foreground" title={domesticInvoice}>
                    {domesticInvoice}
                </span>
            </div>
            {shippingInformation.marketProcessingLabel && (
                <Badge variant="outline" className="w-fit">
                    {shippingInformation.marketProcessingLabel}
                </Badge>
            )}
            <div className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-2">
                <span className="font-semibold text-muted-foreground">중국 송장번호</span>
                <span className="truncate font-mono text-foreground" title={shippingInformation.chinaTrackingNumber}>
                    {shippingInformation.chinaTrackingNumber || "-"}
                </span>
            </div>
        </div>
    );
}

function InvoiceEditButton({ order, actions }: { order: Order; actions: OrderColumnActions }) {
    const [open, setOpen] = useState(false);
    const [secondaryLoginVerified, setSecondaryLoginVerified] = useState(false);
    const [carrier, setCarrier] = useState(order.domesticInvoice?.carrier ?? "CJ대한통운");
    const [trackingNumber, setTrackingNumber] = useState(order.domesticInvoice?.trackingNumber ?? "");
    const pendingInvoiceEntry = order.status === "READY_TO_SHIP"
        && order.sourcingProgressStage === "EXTERNAL_PURCHASE";

    const openEditor = () => {
        setSecondaryLoginVerified(false);
        setCarrier(order.domesticInvoice?.carrier ?? "CJ대한통운");
        setTrackingNumber(order.domesticInvoice?.trackingNumber ?? "");
        setOpen(true);
    };

    const save = () => {
        if (!trackingNumber) return;
        actions.onSaveInvoice(order, carrier, trackingNumber);
        setOpen(false);
    };

    return (
        <>
            <Button
                size="sm"
                variant="outline"
                className="h-[29px] w-full whitespace-nowrap border-border bg-card px-1.5 text-xs text-foreground shadow-none hover:bg-muted"
                onClick={openEditor}
            >
                운송장 수정
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>운송장 수정</DialogTitle>
                        <DialogDescription>
                            {pendingInvoiceEntry
                                ? "직접구매 완료 후 확인된 국내 택배사와 송장번호를 저장합니다. 배송중 처리는 별도로 진행합니다."
                                : "국내배송 시작이 확인된 주문의 기존 국내송장을 마켓 판매자센터에 반영합니다."}
                        </DialogDescription>
                    </DialogHeader>
                    {pendingInvoiceEntry ? (
                        <div className="grid grid-cols-[150px_1fr] gap-2">
                            <Select value={carrier} onValueChange={setCarrier}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="CJ대한통운">CJ대한통운</SelectItem>
                                    <SelectItem value="롯데택배">롯데택배</SelectItem>
                                    <SelectItem value="한진택배">한진택배</SelectItem>
                                    <SelectItem value="우체국택배">우체국택배</SelectItem>
                                </SelectContent>
                            </Select>
                            <Input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value.replace(/\D/g, ""))} placeholder="국내송장번호" inputMode="numeric" className="h-9 font-mono" />
                        </div>
                    ) : (
                        <>
                            <div className="rounded-md border border-border bg-muted/50 px-3 py-3 text-sm">
                                <div className="text-xs font-semibold text-muted-foreground">프로그램에 수집된 국내송장</div>
                                <div className="mt-2 flex items-center justify-between gap-3">
                                    <span className="font-semibold text-foreground">{carrier}</span>
                                    <span className="font-mono font-semibold text-foreground">{trackingNumber}</span>
                                </div>
                            </div>
                            <div className="flex gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
                                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                                <span>마켓 API로 수정하지 않습니다. 2차 로그인 인증이 완료된 판매자센터 세션에서 크롤링으로 직접전달·해외기타배송 정보를 실제 송장으로 변경합니다.</span>
                            </div>
                            {secondaryLoginVerified ? <Badge variant="outline" className="w-fit">2차 로그인 인증 완료 · 크롤링 실행 준비</Badge> : null}
                        </>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
                        {pendingInvoiceEntry ? (
                            <Button disabled={!trackingNumber.trim()} onClick={save}>운송장 수정</Button>
                        ) : secondaryLoginVerified ? (
                            <Button disabled={!trackingNumber} onClick={save}>크롤링으로 운송장 수정</Button>
                        ) : (
                            <Button onClick={() => {
                                if (order.dataSource === "api") {
                                    toast.info("2차 로그인 인증·판매자센터 크롤링 커넥터가 연결된 뒤 실행할 수 있습니다.");
                                    return;
                                }
                                setSecondaryLoginVerified(true);
                                toast.success("더미 2차 로그인 인증을 완료했습니다.");
                            }}>2차 로그인 인증</Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function ShippingProcessButton({ order, actions }: { order: Order; actions: OrderColumnActions }) {
    const [open, setOpen] = useState(false);
    const configuredMethod = actions.getShippingProcessDefault?.(order) ?? "DELIVERY";

    const processExistingDispatch = () => {
        void actions.onProcessShipping(order);
    };

    return (
        <>
            <Button
                size="sm"
                className="h-[29px] w-full whitespace-nowrap bg-primary px-1.5 text-xs shadow-sm hover:bg-primary"
                onClick={() => {
                    if (hasCompletedMarketShipping(order)) {
                        processExistingDispatch();
                        return;
                    }
                    setOpen(true);
                }}
            >
                배송중 처리
            </Button>
            <ShippingProcessDialog
                open={open}
                orders={[order]}
                onOpenChange={setOpen}
                onConfirm={(method, overseasTrackingNumber) => actions.onProcessShipping(order, method, overseasTrackingNumber)}
                resolveMethod={() => configuredMethod}
            />
        </>
    );
}

export function getSourcingActionLabel(
    order: Pick<Order, "status" | "sourcingLifeSyncStatus" | "sourcingProgressStage">,
    placement: OrderActionPlacement = "detail",
) {
    if (order.status === "NEW") return "매칭하기";
    if (placement === "list") return "소싱하기";
    if (order.sourcingLifeSyncStatus === "PAYMENT_READY" || order.sourcingProgressStage === "PAYMENT_WAITING") return "결제하기";
    return "소싱하기";
}

function SourcingButton({ order, actions, placement }: { order: Order; actions: OrderColumnActions; placement: OrderActionPlacement }) {
    const buttonLabel = getSourcingActionLabel(order, placement);

    if (order.dataSource === "api") {
        return <LiveSourcingMappingDialog
            order={order}
            onSaved={(mapping) => actions.onLiveSourcingMappingSaved(order, mapping)}
            buttonLabel={buttonLabel}
        />;
    }

    return (
        <Button
            size="sm"
            className="h-[29px] w-full whitespace-nowrap px-1.5 text-xs shadow-sm"
            onClick={(event) => {
                event.stopPropagation();
                actions.onOpenSourcing(order);
            }}
        >
            {buttonLabel}
        </Button>
    );
}

function ManualPurchaseButton({ order, actions }: { order: Order; actions: OrderColumnActions }) {
    const [open, setOpen] = useState(false);
    const configuredMethod = actions.getShippingProcessDefault?.(order) ?? "DELIVERY";
    const configuredMethodLabel = configuredMethod === "DIRECT_DELIVERY"
        ? "직접전달"
        : configuredMethod === "OVERSEAS_OTHER_DELIVERY"
            ? "해외기타배송"
            : "송장입력";

    if (order.dataSource === "api") {
        return (
            <Button size="sm" variant="outline" className="h-[29px] w-full px-1.5 text-xs" disabled title="직접구매 주문의 배송정보 저장 기능은 현재 준비 중입니다.">
                직접구매 배송처리
            </Button>
        );
    }

    const completeToWaiting = () => {
        actions.onCompleteManualPurchase(order, { method: configuredMethod });
        setOpen(false);
    };

    return (
        <>
            <Button size="sm" variant="outline" className="h-[29px] w-full whitespace-nowrap border-border bg-card px-1.5 text-xs shadow-none hover:border-border hover:bg-muted" onClick={() => setOpen(true)}>
                직접구매 배송처리
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>직접구매 배송처리</DialogTitle>
                        <DialogDescription>
                            직접구매 완료를 저장하고 발송대기로 이동합니다. 배송중 처리 방식은 마켓연동에서 설정한 스토어 기본값을 사용합니다.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs">
                            <div className="font-semibold text-foreground">{order.product.name}</div>
                            <div className="mt-1 grid gap-1 text-muted-foreground">
                                <div className="truncate">옵션: {order.product.optionName}</div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <span>수량: {order.product.quantity}</span>
                                    <span className="font-mono">마켓주문번호: {order.marketOrderId}</span>
                                </div>
                            </div>
                        </div>
                        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                            <div className="text-xs font-semibold text-muted-foreground">스토어 기본 배송중 처리 방식</div>
                            <div className="mt-2 font-bold text-foreground">{configuredMethodLabel}</div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">이 화면에서는 방식을 변경하거나 운송장을 입력하지 않습니다.</div>
                        </div>
                        <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs sm:grid-cols-2">
                            <div><span className="font-semibold text-foreground">내부 소싱</span><div className="mt-1 text-muted-foreground">직접구매 완료로 기록</div></div>
                            <div><span className="font-semibold text-foreground">주문 상태</span><div className="mt-1 text-muted-foreground">발송대기로 이동</div></div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button className="w-full justify-center bg-primary shadow-sm hover:bg-primary" onClick={completeToWaiting}>
                            직접구매 배송처리
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function DeliveryStatusButton({ order }: { order: Order }) {
    const [open, setOpen] = useState(false);
    const progress = getDeliveryHistoryView(order);

    if (!progress) return null;

    return (
        <>
            <Button
                size="sm"
                variant="outline"
                className="h-[29px] w-full whitespace-nowrap border-border bg-muted px-1.5 text-xs text-foreground shadow-none hover:border-border hover:bg-muted hover:text-foreground"
                onClick={() => setOpen(true)}
            >
                배송추적
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>배송추적</DialogTitle>
                        <DialogDescription>{order.product.name}의 현재까지 확인된 배송·반품 이력을 확인합니다.</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-5">
                        <div className="rounded-lg border border-border bg-muted p-4">
                            <div className="flex items-start gap-3">
                                <Truck className="mt-0.5 size-5 shrink-0 text-foreground" />
                                <div>
                                    <div className="text-xs font-bold text-foreground">현재 배송상태 · {progress.label}</div>
                                    <div className="mt-1 font-black text-foreground">{progress.title}</div>
                                    <p className="mt-2 text-sm leading-6 text-foreground">{progress.description}</p>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-3">
                            {progress.milestones.map((step) => {
                                const completed = step.state === "COMPLETED";
                                const current = step.state === "CURRENT";
                                return (
                                    <div
                                        key={step.id}
                                        className={cn(
                                            "rounded-md border p-3",
                                            current ? "border-border bg-muted" : "border-border bg-card",
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            {completed
                                                ? <CheckCircle2 className="size-4 text-foreground" />
                                                : <PackageCheck className={cn("size-4", current ? "text-foreground" : "text-muted-foreground")} />}
                                            <span className="text-sm font-extrabold text-foreground">{step.label}</span>
                                        </div>
                                        <div className={cn(
                                            "mt-2 text-xs font-bold",
                                            completed ? "text-foreground" : current ? "text-foreground" : "text-muted-foreground",
                                        )}>
                                            {completed ? "완료" : current ? "진행 중" : "예정"}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <div className="text-sm font-extrabold text-foreground">누적 배송 이력</div>
                                <Badge variant="outline" className="border-border bg-muted text-xs text-foreground">
                                    {progress.events.length}건
                                </Badge>
                            </div>
                            {progress.events.length > 0 ? (
                                <div className="overflow-hidden rounded-md border border-border">
                                    {progress.events.map((event, index) => (
                                        <div
                                            key={event.id}
                                            className={cn(
                                                "grid gap-2 px-4 py-3 sm:grid-cols-[130px_minmax(0,1fr)]",
                                                index > 0 && "border-t border-border",
                                            )}
                                        >
                                            <div className="font-mono text-xs font-semibold text-muted-foreground">
                                                {event.occurredAt || "일시 미제공"}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Badge variant="outline" className="border-border bg-muted text-[11px] text-foreground">
                                                        {event.flow === "OUTBOUND" ? "배송" : event.flow === "RETURN" ? "반품" : "교환"}
                                                    </Badge>
                                                    <span className="text-xs font-extrabold text-foreground">{event.label}</span>
                                                </div>
                                                {event.description ? (
                                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{event.description}</p>
                                                ) : null}
                                                {(event.location || event.carrier || event.trackingNumber) ? (
                                                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground">
                                                        {event.location ? <span>{event.location}</span> : null}
                                                        {event.carrier ? <span>{event.carrier}</span> : null}
                                                        {event.trackingNumber ? <span className="font-mono">{event.trackingNumber}</span> : null}
                                                    </div>
                                                ) : null}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-md border border-dashed border-border bg-muted px-4 py-5 text-center text-xs text-muted-foreground">
                                    현재 단계는 확인되었지만 연동사에서 상세 이벤트 일시를 제공하지 않았습니다.
                                </div>
                            )}
                        </div>

                        <div className="grid overflow-hidden rounded-md border sm:grid-cols-2">
                            <div className="border-b px-4 py-3 sm:border-b-0 sm:border-r">
                                <div className="text-xs font-bold text-muted-foreground">마켓 주문번호</div>
                                <div className="mt-1 break-all font-mono text-xs font-bold text-foreground">{order.marketOrderId}</div>
                            </div>
                            <div className="px-4 py-3">
                                <div className="text-xs font-bold text-muted-foreground">국내 택배정보</div>
                                <div className="mt-1 text-xs font-bold text-foreground">
                                    {order.domesticInvoice
                                        ? `${order.domesticInvoice.carrier} ${order.domesticInvoice.trackingNumber}`
                                        : "연동된 국내 택배정보가 없습니다."}
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button onClick={() => setOpen(false)}>확인</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

type ProcessActionOrder = Pick<Order, "status" | "marketType" | "marketDeliveryMethod" | "marketOrderStatus">
    & Partial<Pick<Order,
        | "sourcingLifeSyncStatus"
        | "shippingProcessStarted"
        | "sourcingProgressStage"
        | "sourcingLifeOrderId"
        | "sourcingRefund"
        | "taoWorldPurchase"
        | "previousStatus"
        | "claimType"
        | "claimStatus"
        | "claimRequestedAt"
        | "claimProcessedAt"
        | "domesticInvoice"
        | "sourcingLifeSyncedAt"
        | "deliveryHistory"
        | "recipient"
        | "dataSource"
    >>;

export function getProcessActionAvailability(
    order: ProcessActionOrder,
) {
    const blocked = order.status === "ON_HOLD";
    const sourcingProgressView = getSourcingProgressViewMeta(order);
    const deliveryProgressView = getDeliveryHistoryView(order);
    const paymentWaiting = sourcingProgressView?.stage === "PAYMENT_WAITING";
    const purchaseCompleted = hasCompletedSourcingPurchase(order);
    const paymentStateMismatch = ["READY_TO_SHIP", "SHIPPING", "DELIVERED"].includes(order.status) && !purchaseCompleted;
    const canUseDirectDelivery = isDirectDeliveryEligible(order);
    const marketDispatchCompleted = order.marketOrderStatus === "DELIVERING"
        || order.marketOrderStatus === "DELIVERED"
        || order.marketOrderStatus === "PURCHASE_DECIDED";
    const directDeliveryCompleted = order.marketDeliveryMethod === "DIRECT_DELIVERY" && marketDispatchCompleted;
    const sourcingRefundAvailability = getSourcingRefundAvailability(order);
    const sourcingRefundActive = isSourcingRefundActive(order.sourcingRefund);
    const sourcingRefundBlocksShipping = sourcingRefundActive || order.sourcingRefund?.status === "REFUNDED";
    const customsReady = order.status !== "PREPARING"
        || !order.recipient
        || hasValidPersonalCustomsCode(order.recipient.personalCustomsCode);
    const hasDomesticInvoice = Boolean(order.domesticInvoice?.carrier && order.domesticInvoice.trackingNumber);
    return {
        canAccept: !blocked && order.status === "NEW",
        canSource: !blocked && customsReady && (order.status === "NEW" || (order.status === "PREPARING" && (!sourcingProgressView || paymentWaiting))),
        canViewSourcingProgress: !blocked && Boolean(sourcingProgressView) && !paymentWaiting && purchaseCompleted,
        sourcingProgressView,
        canViewDeliveryProgress: !blocked && Boolean(deliveryProgressView) && purchaseCompleted,
        deliveryProgressView,
        canCompleteManualPurchase: !blocked && order.dataSource !== "api" && order.status === "PREPARING" && !paymentWaiting && !purchaseCompleted,
        canCancel: !blocked
            && !marketDispatchCompleted
            && (order.status === "NEW" || order.status === "PREPARING" || order.status === "READY_TO_SHIP"),
        canSendInvoice: !blocked
            && !sourcingRefundBlocksShipping
            && !marketDispatchCompleted
            && (order.status === "READY_TO_SHIP" || order.status === "SHIPPING")
            && purchaseCompleted
            && hasDomesticInvoice,
        canEditInvoice: !blocked
            && (
                (
                    order.dataSource !== "api"
                    && order.status === "READY_TO_SHIP"
                    && purchaseCompleted
                    && order.sourcingProgressStage === "EXTERNAL_PURCHASE"
                )
                || (
                    order.status === "SHIPPING"
                    && purchaseCompleted
                    && hasDomesticInvoice
                    && hasStartedDomesticShipping(order)
                    && marketDispatchCompleted
                    && (order.marketDeliveryMethod === "DIRECT_DELIVERY"
                        || order.marketDeliveryMethod === "OVERSEAS_OTHER_DELIVERY")
                )
            ),
        canUseDirectDelivery,
        directDeliveryCompleted,
        marketDispatchCompleted,
        paymentWaiting,
        purchaseCompleted,
        paymentStateMismatch,
        sourcingRefundAvailability,
        sourcingRefundActive,
        sourcingRefundBlocksShipping,
        canDispatchDirectDelivery: !blocked
            && !sourcingRefundBlocksShipping
            && canUseDirectDelivery
            && purchaseCompleted
            && !marketDispatchCompleted
            && ["PREPARING", "READY_TO_SHIP", "SHIPPING"].includes(order.status),
        canCompleteMarketShipping: !blocked
            && !sourcingRefundBlocksShipping
            && order.status === "READY_TO_SHIP"
            && purchaseCompleted
            && marketDispatchCompleted,
        canChooseShippingProcess: !blocked
            && !sourcingRefundBlocksShipping
            && purchaseCompleted
            && ["PREPARING", "READY_TO_SHIP", "SHIPPING"].includes(order.status)
            && (!marketDispatchCompleted || order.status === "READY_TO_SHIP"),
    };
}

export type OrderActionPlacement = "list" | "detail";

export function getProcessActionVisibility(
    order: ProcessActionOrder,
    placement: OrderActionPlacement,
) {
    const availability = getProcessActionAvailability(order);
    const isDetail = placement === "detail";
    const canProcessShipping = availability.canChooseShippingProcess;

    return {
        ...availability,
        showAccept: availability.canAccept,
        showSource: availability.canSource,
        showManualPurchase: isDetail && availability.canCompleteManualPurchase,
        showShippingProcess: canProcessShipping && (isDetail || order.status === "READY_TO_SHIP"),
        showInvoiceEdit: isDetail && availability.canEditInvoice,
        showProgressView: isDetail && availability.canViewSourcingProgress,
        sourcingProgressActionLabel: availability.sourcingProgressView?.actionLabel,
        showDeliveryStatus: isDetail && availability.canViewDeliveryProgress,
        showCancel: availability.canCancel && (isDetail || order.status !== "READY_TO_SHIP"),
        showRestartSourcingAfterRefund: isDetail && canRestartSourcingAfterRefund(order),
    };
}

export function getProcessResultLabel(order: Pick<Order, "status" | "sourcingProgressStage" | "claimType" | "claimStatus" | "marketOrderStatus">) {
    if (order.status === "ON_HOLD") return "처리보류";
    if (order.status === "CANCELED") return "주문취소";
    if (order.status === "CLAIM" && order.claimStatus?.includes("완료")) {
        if (order.claimType === "RETURN") return "반품완료";
        if (order.claimType === "EXCHANGE") return "교환완료";
        return "주문취소";
    }
    return undefined;
}

export function OrderProcessActions({
    order,
    actions,
    placement = "list",
}: {
    order: Order;
    actions: OrderColumnActions;
    placement?: OrderActionPlacement;
}) {
    const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
    const {
        showAccept,
        showSource,
        showManualPurchase,
        showCancel,
        showShippingProcess,
        showInvoiceEdit,
        showProgressView,
        showDeliveryStatus,
        showRestartSourcingAfterRefund,
        sourcingProgressView,
        sourcingProgressActionLabel,
        paymentStateMismatch,
    } = getProcessActionVisibility(order, placement);
    const isDetail = placement === "detail";
    const processResultLabel = isDetail ? getProcessResultLabel(order) : undefined;
    const showClaimAction = isDetail && order.status === "CLAIM" && !processResultLabel;

    if (paymentStateMismatch) {
        if (!isDetail) return null;

        return (
            <div className="flex flex-col items-stretch gap-1">
                <Badge variant="outline" className="h-auto min-h-7 whitespace-normal border-border bg-muted px-2 py-1 text-center text-xs font-semibold leading-4 text-foreground">
                    결제상태 불일치
                </Badge>
                <OrderHistoryDialog order={order} />
            </div>
        );
    }

    return (
        <div className={cn(placement === "detail" ? "flex w-full flex-col items-stretch gap-2" : "flex flex-col items-stretch gap-1")}>
            {showClaimAction ? <ClaimActionDialog order={order} actions={actions} /> : null}
            {processResultLabel ? (
                <Badge variant="outline" className="flex h-[29px] w-full items-center justify-center rounded-md border-border bg-muted px-2 text-xs font-semibold text-foreground">
                    {processResultLabel}
                </Badge>
            ) : null}
            {showAccept && (
                <Button size="sm" className="h-[29px] w-full whitespace-nowrap px-1.5 text-xs shadow-sm" onClick={() => actions.onAcceptOrder(order)}>
                    주문확인
                </Button>
            )}
            {showSource && <SourcingButton order={order} actions={actions} placement={placement} />}
            {showManualPurchase && <ManualPurchaseButton order={order} actions={actions} />}
            {showInvoiceEdit && <InvoiceEditButton order={order} actions={actions} />}
            {showShippingProcess && <ShippingProcessButton order={order} actions={actions} />}
            {showProgressView && sourcingProgressView && (
                <Button
                    size="sm"
                    variant="outline"
                    className="h-[29px] w-full whitespace-nowrap border-border bg-muted px-1.5 text-xs text-foreground shadow-none hover:border-border hover:bg-muted hover:text-foreground"
                    onClick={() => actions.onOpenSourcing(order)}
                >
                    {sourcingProgressActionLabel}
                </Button>
            )}
            {showDeliveryStatus && <DeliveryStatusButton order={order} />}
            {showRestartSourcingAfterRefund && (
                <Button
                    size="sm"
                    className="h-[29px] w-full whitespace-nowrap px-1.5 text-xs shadow-sm"
                    onClick={() => actions.onRestartSourcingAfterRefund(order)}
                    aria-label={`${order.product.name} 다시 소싱하기`}
                >
                    다시 소싱하기
                </Button>
            )}
            {showCancel && (
                <>
                    <Button size="sm" variant="outline" className="h-[29px] w-full whitespace-nowrap border-border bg-card px-1.5 text-xs text-foreground shadow-none hover:border-border hover:bg-muted hover:text-foreground" onClick={() => setCancelConfirmOpen(true)}>
                        주문취소
                    </Button>
                    <SellerCancelDialog
                        open={cancelConfirmOpen}
                        onOpenChange={setCancelConfirmOpen}
                        orderLabel={order.marketOrderId}
                        orderedQuantity={order.product.quantity}
                        hasLiveOrders={order.dataSource === "api"}
                        onSubmit={(intent) => actions.onCancelOrder(order, intent)}
                    />
                </>
            )}
            {isDetail ? <OrderHistoryDialog order={order} /> : null}
        </div>
    );
}

export function createColumns(actions: OrderColumnActions): ColumnDef<Order>[] {
    const columns: ColumnDef<Order>[] = [
        {
            id: "select",
            header: ({ table }) => (
                <Checkbox checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")} onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)} aria-label="전체 선택" />
            ),
            cell: ({ row }) => (
                <Checkbox checked={row.getIsSelected()} onCheckedChange={(value) => row.toggleSelected(!!value)} aria-label="주문 선택" />
            ),
            enableSorting: false,
            enableHiding: false,
        },
        { id: "process", header: "처리하기", cell: ({ row }) => <OrderProcessActions order={row.original} actions={actions} /> },
        { accessorKey: "orderDate", header: "주문일시", cell: ({ row }) => <OrderDateCell order={row.original} /> },
        { id: "sourcingLifeInfo", header: "진행상태", cell: ({ row }) => <SourcingLifeInfoCell order={row.original} /> },
        { id: "productInfo", header: "상품정보", cell: ({ row }) => <ProductInfoCell order={row.original} /> },
        { id: "marginInfo", header: "결제가격/마진", cell: ({ row }) => <MarginInfoCell order={row.original} /> },
        { id: "invoice", header: "택배정보", cell: ({ row }) => <InvoiceInfoCell order={row.original} /> },
        { id: "deliveryInfo", header: "배송정보", cell: ({ row }) => <DeliveryInfoCell order={row.original} actions={actions} /> },
    ];

    return columns;
}
