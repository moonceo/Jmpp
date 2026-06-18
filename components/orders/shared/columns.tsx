"use client";

import { useRef, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SourcingWorkflowDialog } from "@/components/orders/sourcing-workflow-dialog";
import { MARKET_LABELS, ORDER_STATUS_LABELS, SOURCING_LIFE_STATUS_LABELS } from "@/lib/constants/orders";
import { cn } from "@/lib/utils";
import { Order, Recipient, SourcingLifeMatch } from "@/types/order";

interface OrderColumnActions {
    onSaveSourcingMatch: (order: Order, match: SourcingLifeMatch) => void;
    onCompleteSourcingPayment: (order: Order, match: SourcingLifeMatch) => void;
    onCompleteManualPurchase: (order: Order, invoice?: ManualPurchaseInvoice, sendNow?: boolean) => void;
    onSourcingAndAcceptOrder: (order: Order, match: SourcingLifeMatch) => void;
    onAcceptOrder: (order: Order) => void;
    onCancelOrder: (order: Order) => void;
    onApproveCancelClaim: (order: Order) => void;
    onRejectCancelClaim: (order: Order) => void;
    onSendInvoice: (order: Order, carrier?: string, trackingNumber?: string) => void;
    onSaveInvoice: (order: Order, carrier: string, trackingNumber: string) => void;
    onSaveRecipientInfo: (order: Order, recipient: Recipient) => void;
}

interface ManualPurchaseInvoice {
    carrier: string;
    trackingNumber: string;
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
            <button type="button" className="relative h-10 w-10 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm transition hover:border-sky-300 hover:ring-2 hover:ring-sky-100" onClick={() => setOpen(true)}>
                <Image src={order.product.thumbnail} alt={order.product.name} fill sizes="48px" className="object-cover" />
            </button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>이미지 크게 보기</DialogTitle>
                        <DialogDescription>{order.product.name}</DialogDescription>
                    </DialogHeader>
                    <div className="relative aspect-square overflow-hidden rounded-md border bg-white">
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
                    <a className="line-clamp-2 text-[13px] font-semibold leading-4 text-slate-900 hover:text-sky-700 hover:underline" href={order.product.marketLink} target="_blank" rel="noopener noreferrer">
                        {order.product.name}
                        <ExternalLink className="ml-1 inline h-3 w-3" />
                    </a>
                ) : (
                    <div className="line-clamp-2 text-[13px] font-semibold leading-4 text-slate-900">{order.product.name}</div>
                )}
                <div className="line-clamp-1 text-xs text-slate-500">{order.product.optionName}</div>
                <div className="text-[11px] font-medium text-slate-500">수량 {order.product.quantity}</div>
                <div className="inline-flex max-w-full items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
                    <span className="shrink-0">마켓 주문번호 :</span>
                    <span className="truncate font-mono">{order.marketOrderId}</span>
                </div>
            </div>
        </div>
    );
}

function MarketAccountCell({ order }: { order: Order }) {
    return (
        <div className="min-w-0 space-y-0.5">
            <div className="inline-flex max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{MARKET_LABELS[order.marketType]}</div>
            <div className="truncate text-xs leading-4 text-slate-600">{order.storeName}</div>
        </div>
    );
}

function OrderDateCell({ value }: { value: string }) {
    const [date, time] = value.split(" ");

    return (
        <div className="space-y-0.5 text-xs tabular-nums">
            <div className="font-medium text-slate-800">{date}</div>
            <div className="font-mono text-[11px] text-slate-500">{time ?? "-"}</div>
        </div>
    );
}

function SourcingLifeInfoCell({ order }: { order: Order }) {
    if (!order.sourcingLifeOrderId) {
        const isMatched = order.sourcingLifeSyncStatus === "MATCH_SAVED" || order.sourcingLifeSyncStatus === "PAYMENT_READY";

        return (
            <div className={cn("truncate text-xs font-semibold", isMatched ? "text-emerald-700" : "font-mono text-slate-900")}>
                {isMatched ? "매칭완료" : "-"}
            </div>
        );
    }

    const orderUrl = `/sourcing-life-order-detail.html?orderId=${encodeURIComponent(order.sourcingLifeOrderId)}`;

    return (
        <a
            className="block truncate font-mono text-xs font-semibold text-sky-700 underline-offset-2 hover:underline"
            href={orderUrl}
            target="_blank"
            rel="noopener noreferrer"
        >
            {order.sourcingLifeOrderId}
        </a>
    );
}

function DeliveryInfoCell({ order, actions }: { order: Order; actions: OrderColumnActions }) {
    const customs = customsState(order.recipient.personalCustomsCode);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState(order.recipient.name);
    const [phone, setPhone] = useState(order.recipient.phone);
    const [zipCode, setZipCode] = useState(order.recipient.zipCode ?? "");
    const [address, setAddress] = useState(order.recipient.address);
    const [detailAddress, setDetailAddress] = useState(order.recipient.detailAddress ?? "");
    const [deliveryMessage, setDeliveryMessage] = useState(order.recipient.deliveryMessage ?? "");
    const [customsCode, setCustomsCode] = useState(order.recipient.personalCustomsCode ?? "");
    const normalizedCode = customsCode.trim().toUpperCase();
    const editorCustoms = customsState(normalizedCode);
    const canSave = Boolean(name.trim() && phone.trim() && address.trim() && /^P\d{12}$/.test(normalizedCode));

    const openEditor = () => {
        setName(order.recipient.name);
        setPhone(order.recipient.phone);
        setZipCode(order.recipient.zipCode ?? "");
        setAddress(order.recipient.address);
        setDetailAddress(order.recipient.detailAddress ?? "");
        setDeliveryMessage(order.recipient.deliveryMessage ?? "");
        setCustomsCode(order.recipient.personalCustomsCode ?? "");
        setOpen(true);
    };

    const saveRecipientInfo = () => {
        if (!canSave) {
            toast.info("수령인, 연락처, 주소, 개인통관부호를 확인하세요.");
            return;
        }

        actions.onSaveRecipientInfo(order, {
            name: name.trim(),
            phone: phone.trim(),
            zipCode: zipCode.trim() || undefined,
            address: address.trim(),
            detailAddress: detailAddress.trim() || undefined,
            deliveryMessage: deliveryMessage.trim() || undefined,
            personalCustomsCode: normalizedCode,
        });
        setOpen(false);
    };

    return (
        <div className="min-w-0 space-y-1 text-xs">
            <div className="truncate font-semibold text-slate-900">{order.recipient.name}</div>
            <div className="truncate font-mono text-[11px] text-slate-500">{order.recipient.phone}</div>
            <div className="truncate leading-4 text-slate-600">{[order.recipient.zipCode, order.recipient.address, order.recipient.detailAddress].filter(Boolean).join(" ")}</div>
            <div className="flex min-w-0 items-center gap-1.5 border-t border-slate-100 pt-1">
                <span className="truncate font-mono text-[11px] text-slate-700">{order.recipient.personalCustomsCode ?? "-"}</span>
                <Badge
                    variant="outline"
                    className={cn(
                        "shrink-0 text-[10px]",
                        customs === "통관부호 일치"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700",
                    )}
                >
                    {customs}
                </Badge>
                <Button size="sm" variant="outline" className="ml-auto h-6 shrink-0 border-slate-200 bg-white px-2 text-[11px] shadow-none" onClick={openEditor}>
                    수정
                </Button>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>배송정보 수정</DialogTitle>
                        <DialogDescription>수령인 배송정보와 개인통관부호를 함께 수정합니다.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                        <div className="grid grid-cols-2 gap-2">
                            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="수령인명" />
                            <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="수령인 연락처" />
                        </div>
                        <Input value={zipCode} onChange={(event) => setZipCode(event.target.value)} placeholder="우편번호" />
                        <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="주소" />
                        <Input value={detailAddress} onChange={(event) => setDetailAddress(event.target.value)} placeholder="상세주소" />
                        <Input value={deliveryMessage} onChange={(event) => setDeliveryMessage(event.target.value)} placeholder="배송메시지" />
                        <Input
                            value={customsCode}
                            onChange={(event) => setCustomsCode(event.target.value.toUpperCase())}
                            placeholder="개인통관부호 P123456789012"
                            className="font-mono"
                        />
                        <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="text-xs text-slate-600">개인통관부호 상태</div>
                            <Badge
                                variant="outline"
                                className={cn(
                                    "text-[11px]",
                                    editorCustoms === "통관부호 일치"
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                        : "border-amber-200 bg-amber-50 text-amber-700",
                                )}
                            >
                                {editorCustoms}
                            </Badge>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>취소</Button>
                        <Button disabled={!canSave} onClick={saveRecipientInfo}>저장</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
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
                            <div key={label} className="rounded-md border bg-slate-50 px-3 py-2 text-sm">
                                <div className="text-xs text-slate-500">{label}</div>
                                <div className="mt-1 break-words font-medium text-slate-900">{value}</div>
                            </div>
                        ))}
                    </div>
                    {isCancelClaim ? (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            현재 진행단계와 소싱라이프 결제/송장 여부를 확인한 뒤 취소승인 또는 취소거부를 선택해 마켓에 전송합니다.
                        </div>
                    ) : (
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            현재 진행단계와 주문 정보를 확인합니다. 반품/교환의 승인, 회수, 재발송 처리는 다음 클레임 처리 단계에서 확장합니다.
                        </div>
                    )}
                    <DialogFooter>
                        {isCancelClaim && isProcessed && (
                            <Badge variant="outline" className="mr-auto border-emerald-200 bg-emerald-50 text-emerald-700">
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

function InvoiceInlineInput({
    order,
    carrier,
    trackingNumber,
    onCarrierChange,
    onTrackingNumberChange,
    onSaveInvoice,
}: {
    order: Order;
    carrier: string;
    trackingNumber: string;
    onCarrierChange: (carrier: string) => void;
    onTrackingNumberChange: (trackingNumber: string) => void;
    onSaveInvoice: OrderColumnActions["onSaveInvoice"];
}) {
    const lastSavedRef = useRef(`${order.domesticInvoice?.carrier ?? ""}:${order.domesticInvoice?.trackingNumber ?? ""}`);
    const canEdit = order.status === "READY_TO_SHIP";
    const shouldAutoSave = order.status === "READY_TO_SHIP";
    const changedTrackingNumber = order.domesticInvoice?.changedTrackingNumber?.trim();

    const saveIfReady = (nextCarrier = carrier, nextTrackingNumber = trackingNumber) => {
        const normalizedTrackingNumber = nextTrackingNumber.trim();
        const nextSavedKey = `${nextCarrier}:${normalizedTrackingNumber}`;

        if (!shouldAutoSave || !normalizedTrackingNumber || lastSavedRef.current === nextSavedKey) return;

        lastSavedRef.current = nextSavedKey;
        onSaveInvoice(order, nextCarrier, normalizedTrackingNumber);
    };

    if (!canEdit) {
        return (
            <div className="space-y-1.5 text-xs">
                <div>
                    <div className="font-semibold text-slate-900">{order.domesticInvoice?.carrier || "-"}</div>
                    <div className="mt-0.5 font-mono text-sky-700">{order.domesticInvoice?.trackingNumber || "-"}</div>
                </div>
                {changedTrackingNumber && (
                    <div className="border-t border-slate-100 pt-1.5">
                        <div className="text-[10px] font-semibold text-slate-500">변경된 송장번호</div>
                        <div className="mt-0.5 font-mono text-[11px] font-semibold text-amber-700">{changedTrackingNumber}</div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-[minmax(74px,0.9fr)_minmax(74px,1fr)] gap-1">
            <Select
                value={carrier}
                onValueChange={(nextCarrier) => {
                    onCarrierChange(nextCarrier);
                    saveIfReady(nextCarrier, trackingNumber);
                }}
            >
                <SelectTrigger size="sm" className="!h-8 !min-h-8 w-full px-2 !py-0 text-[11px] leading-none">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="CJ대한통운">CJ대한통운</SelectItem>
                    <SelectItem value="롯데택배">롯데택배</SelectItem>
                    <SelectItem value="한진택배">한진택배</SelectItem>
                    <SelectItem value="우체국택배">우체국택배</SelectItem>
                </SelectContent>
            </Select>
            <Input
                value={trackingNumber}
                onChange={(event) => {
                    const nextTrackingNumber = event.target.value.replace(/\D/g, "");
                    onTrackingNumberChange(nextTrackingNumber);
                    saveIfReady(carrier, nextTrackingNumber);
                }}
                onBlur={() => saveIfReady()}
                onKeyDown={(event) => {
                    if (event.key === "Enter") saveIfReady();
                }}
                placeholder="송장번호"
                inputMode="numeric"
                className="!h-8 !min-h-8 w-full px-2 !py-0 font-mono text-[11px] leading-none"
            />
        </div>
    );
}

function InvoiceActionsCell({ order, actions }: { order: Order; actions: OrderColumnActions }) {
    const invoiceKey = `${order.domesticInvoice?.carrier ?? ""}:${order.domesticInvoice?.trackingNumber ?? ""}:${order.domesticInvoice?.changedCarrier ?? ""}:${order.domesticInvoice?.changedTrackingNumber ?? ""}`;
    const [syncedInvoiceKey, setSyncedInvoiceKey] = useState(invoiceKey);
    const [carrier, setCarrier] = useState(order.domesticInvoice?.carrier || "CJ대한통운");
    const [trackingNumber, setTrackingNumber] = useState(order.domesticInvoice?.trackingNumber || "");

    if (syncedInvoiceKey !== invoiceKey) {
        setSyncedInvoiceKey(invoiceKey);
        setCarrier(order.domesticInvoice?.carrier || "CJ대한통운");
        setTrackingNumber(order.domesticInvoice?.trackingNumber || "");
    }

    return (
        <div className="space-y-1.5">
            <InvoiceInlineInput
                order={order}
                carrier={carrier}
                trackingNumber={trackingNumber}
                onCarrierChange={setCarrier}
                onTrackingNumberChange={setTrackingNumber}
                onSaveInvoice={actions.onSaveInvoice}
            />
        </div>
    );
}

function SourcingButton({ order, actions }: { order: Order; actions: OrderColumnActions }) {
    const [open, setOpen] = useState(false);
    const enabled = order.status === "NEW" || order.status === "PREPARING";
    const buttonLabel = order.status === "NEW" ? "매칭하기" : "소싱하기";

    return (
        <>
            <Button size="sm" variant={enabled ? "default" : "ghost"} className="h-[29px] w-full whitespace-nowrap px-1.5 text-[11px] shadow-sm" disabled={!enabled} onClick={() => setOpen(true)}>
                {buttonLabel}
            </Button>
            <SourcingWorkflowDialog
                order={order}
                open={open}
                mode={order.status === "NEW" ? "match-only" : "payment"}
                onOpenChange={setOpen}
                onConfirmMatch={order.status === "NEW" ? actions.onSourcingAndAcceptOrder : actions.onSaveSourcingMatch}
                onCompletePayment={actions.onCompleteSourcingPayment}
            />
        </>
    );
}

function ManualPurchaseButton({ order, actions }: { order: Order; actions: OrderColumnActions }) {
    const [open, setOpen] = useState(false);
    const [carrier, setCarrier] = useState("CJ대한통운");
    const [trackingNumber, setTrackingNumber] = useState("");
    const normalizedTrackingNumber = trackingNumber.trim();
    const hasInvoice = Boolean(normalizedTrackingNumber);

    const completeToWaiting = () => {
        actions.onCompleteManualPurchase(order, hasInvoice ? { carrier, trackingNumber: normalizedTrackingNumber } : undefined, false);
        setOpen(false);
    };

    const completeToShipping = () => {
        if (!hasInvoice) {
            toast.info("국내송장번호를 입력하세요.");
            return;
        }

        actions.onCompleteManualPurchase(order, { carrier, trackingNumber: normalizedTrackingNumber }, true);
        setOpen(false);
    };

    return (
        <>
            <Button size="sm" variant="outline" className="h-[29px] w-full whitespace-nowrap border-slate-200 bg-white px-1.5 text-[10px] shadow-none hover:border-sky-200 hover:bg-sky-50" onClick={() => setOpen(true)}>
                수동구매 완료
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>수동구매 완료</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                            <div className="font-semibold text-slate-900">{order.product.name}</div>
                            <div className="mt-1 grid gap-1 text-slate-600">
                                <div className="truncate">옵션: {order.product.optionName}</div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <span>수량: {order.product.quantity}</span>
                                    <span className="font-mono">마켓주문번호: {order.marketOrderId}</span>
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-[150px_1fr] gap-2">
                            <Select value={carrier} onValueChange={setCarrier}>
                                <SelectTrigger className="h-9">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="CJ대한통운">CJ대한통운</SelectItem>
                                    <SelectItem value="롯데택배">롯데택배</SelectItem>
                                    <SelectItem value="한진택배">한진택배</SelectItem>
                                    <SelectItem value="우체국택배">우체국택배</SelectItem>
                                </SelectContent>
                            </Select>
                            <Input
                                value={trackingNumber}
                                onChange={(event) => setTrackingNumber(event.target.value.replace(/\D/g, ""))}
                                placeholder="국내송장번호"
                                inputMode="numeric"
                                className="h-9 font-mono"
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:flex-col sm:justify-start">
                        <Button variant="outline" className="w-full justify-center border-slate-200 bg-white shadow-none" onClick={completeToWaiting}>
                            발송대기 처리
                        </Button>
                        <Button className="w-full justify-center bg-sky-600 shadow-sm hover:bg-sky-700" disabled={!hasInvoice} onClick={completeToShipping}>
                            배송중 처리
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function ProcessActionsCell({ order, actions }: { order: Order; actions: OrderColumnActions }) {
    const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
    const canAccept = order.status === "NEW";
    const canSource = order.status === "NEW" || order.status === "PREPARING";
    const canCompleteManualPurchase = order.status === "PREPARING";
    const canCancel = order.status === "NEW" || order.status === "PREPARING" || order.status === "READY_TO_SHIP";
    const canSendInvoice = order.status === "READY_TO_SHIP";
    const hasDomesticInvoice = Boolean(order.domesticInvoice?.trackingNumber?.trim());

    if (order.status === "CLAIM") {
        return <ClaimActionDialog order={order} actions={actions} />;
    }

    if (!canAccept && !canSource && !canCompleteManualPurchase && !canCancel && !canSendInvoice) {
        return <span className="text-xs text-slate-400">-</span>;
    }

    return (
        <div className="flex flex-col items-stretch gap-1">
            {canAccept && (
                <Button size="sm" className="h-[29px] w-full whitespace-nowrap px-1.5 text-[11px] shadow-sm" onClick={() => actions.onAcceptOrder(order)}>
                    주문확인
                </Button>
            )}
            {canSource && <SourcingButton order={order} actions={actions} />}
            {canCompleteManualPurchase && <ManualPurchaseButton order={order} actions={actions} />}
            {canSendInvoice && (
                <Button
                    size="sm"
                    className="h-[29px] w-full whitespace-nowrap bg-sky-600 px-1.5 text-[11px] shadow-sm hover:bg-sky-700"
                    disabled={!hasDomesticInvoice}
                    onClick={() => actions.onSendInvoice(order, order.domesticInvoice?.carrier, order.domesticInvoice?.trackingNumber)}
                >
                    배송중 처리
                </Button>
            )}
            {canCancel && (
                <>
                    <Button size="sm" variant="outline" className="h-[29px] w-full whitespace-nowrap border-red-200 bg-white px-1.5 text-[11px] text-red-600 shadow-none hover:border-red-300 hover:bg-red-50 hover:text-red-700" onClick={() => setCancelConfirmOpen(true)}>
                        주문취소
                    </Button>
                    <Dialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
                        <DialogContent className="max-w-md">
                            <DialogHeader>
                                <DialogTitle>주문취소 확인</DialogTitle>
                                <DialogDescription>
                                    {order.marketOrderId} 주문을 주문취소 처리합니다. 계속 진행할까요?
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setCancelConfirmOpen(false)}>
                                    닫기
                                </Button>
                                <Button
                                    className="bg-red-600 hover:bg-red-700"
                                    onClick={() => {
                                        actions.onCancelOrder(order);
                                        setCancelConfirmOpen(false);
                                    }}
                                >
                                    주문취소
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </>
            )}
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
        { id: "process", header: "처리하기", cell: ({ row }) => <ProcessActionsCell order={row.original} actions={actions} /> },
        { accessorKey: "orderDate", header: "주문일시", cell: ({ row }) => <OrderDateCell value={row.original.orderDate} /> },
        { id: "productInfo", header: "상품정보", cell: ({ row }) => <ProductInfoCell order={row.original} /> },
        { id: "invoice", header: "택배정보", cell: ({ row }) => <InvoiceActionsCell order={row.original} actions={actions} /> },
        { id: "deliveryInfo", header: "배송정보", cell: ({ row }) => <DeliveryInfoCell order={row.original} actions={actions} /> },
        { id: "marketAccount", header: "판매처", cell: ({ row }) => <MarketAccountCell order={row.original} /> },
        { id: "sourcingLifeInfo", header: "소싱라이프", cell: ({ row }) => <SourcingLifeInfoCell order={row.original} /> },
    ];

    return columns;
}
