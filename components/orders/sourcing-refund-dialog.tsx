"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, RotateCcw, Truck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
    SOURCING_REFUND_GOODS_STATUS_LABELS,
    SOURCING_REFUND_STATUS_LABELS,
    SOURCING_REFUND_TYPE_LABELS,
    TAOWORLD_GOODS_STATUS_CODES,
    TAOWORLD_REFUND_TYPE_CODES,
    TAOWORLD_RETURN_LOGISTICS_OPTIONS,
    recommendedSourcingRefundGoodsStatus,
    recommendedSourcingRefundType,
    renderTaoWorldRefundOrder,
    validateSourcingRefundDraft,
    type SourcingReturnLogisticsDraft,
} from "@/lib/sourcing-refund";
import type {
    Order,
    SourcingRefundDraft,
    SourcingRefundGoodsStatus,
    SourcingRefundType,
} from "@/types/order";

interface SourcingRefundDialogProps {
    order: Order;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (order: Order, draft: SourcingRefundDraft) => boolean | Promise<boolean>;
    onAdvance: (order: Order) => void;
    onSubmitReturnLogistics: (order: Order, draft: SourcingReturnLogisticsDraft) => boolean;
}

const goodsStatuses = Object.keys(SOURCING_REFUND_GOODS_STATUS_LABELS) as SourcingRefundGoodsStatus[];

function formatKrw(value?: number): string {
    return typeof value === "number" ? `${value.toLocaleString()}원` : "-";
}

function formatCny(value?: number): string {
    return typeof value === "number" ? `¥${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-";
}

export function SourcingRefundDialog({
    order,
    open,
    onOpenChange,
    onSubmit,
    onAdvance,
    onSubmitReturnLogistics,
}: SourcingRefundDialogProps) {
    const defaultType = recommendedSourcingRefundType(order);
    const defaultGoodsStatus = recommendedSourcingRefundGoodsStatus(order);
    const [type, setType] = useState<SourcingRefundType>(defaultType);
    const [goodsStatus, setGoodsStatus] = useState<SourcingRefundGoodsStatus>(defaultGoodsStatus);
    const rendered = useMemo(
        () => renderTaoWorldRefundOrder(order, type, goodsStatus),
        [goodsStatus, order, type],
    );
    const [reasonId, setReasonId] = useState("");
    const [refundDescription, setRefundDescription] = useState("");
    const [refundFeeCny, setRefundFeeCny] = useState("");
    const [refundImageUrl, setRefundImageUrl] = useState("");
    const [marketClaimId, setMarketClaimId] = useState("");
    const [separateFlowConfirmed, setSeparateFlowConfirmed] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const refund = order.sourcingRefund;

    useEffect(() => {
        if (!open || refund) return;
        setType(defaultType);
        setGoodsStatus(defaultGoodsStatus);
        setRefundDescription("");
        setMarketClaimId("");
        setRefundImageUrl("");
        setSeparateFlowConfirmed(false);
    }, [defaultGoodsStatus, defaultType, open, order.id, refund]);

    useEffect(() => {
        if (!rendered) return;
        setReasonId((current) => rendered.reasons.some((reason) => reason.reasonId === current)
            ? current
            : rendered.reasons[0]?.reasonId ?? "");
        setRefundFeeCny((current) => current || String(rendered.maxRefundFeeCny));
    }, [rendered]);

    const selectedReason = rendered?.reasons.find((reason) => reason.reasonId === reasonId);
    const draft = useMemo<SourcingRefundDraft>(() => ({
        purchaseOrderLineId: rendered?.purchaseOrderLineId ?? "",
        type,
        goodsStatus,
        reasonId,
        reasonLabel: selectedReason?.reasonLabel ?? "",
        refundFeeCny: Number(refundFeeCny),
        currency: "CNY",
        refundDescription,
        refundImageUrls: refundImageUrl.trim() ? [refundImageUrl.trim()] : undefined,
        marketClaimId,
    }), [goodsStatus, marketClaimId, reasonId, refundDescription, refundFeeCny, refundImageUrl, rendered?.purchaseOrderLineId, selectedReason?.reasonLabel, type]);
    const validationMessage = validateSourcingRefundDraft(order, draft);

    async function submit(): Promise<void> {
        if (validationMessage || !separateFlowConfirmed || order.dataSource === "api") return;
        setSubmitting(true);
        try {
            const accepted = await onSubmit(order, draft);
            if (accepted) onOpenChange(false);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[92svh] overflow-y-auto p-0 sm:max-w-4xl">
                <DialogHeader className="border-b border-border px-6 py-5 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                        <DialogTitle>{refund ? "소싱 반품·환불 진행" : "소싱 반품·환불 신청"}</DialogTitle>
                        <Badge variant="outline">API 계약 데모</Badge>
                    </div>
                    <DialogDescription>
                        실제 호출 없이 TaoWorld의 render → submit → message_type=9·query → 반품 물류 계약을 그대로 재현합니다.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 px-6 py-5">
                    <Alert>
                        <AlertCircle />
                        <AlertTitle>마켓 클레임과 타오바오 소싱 환불은 별도 처리입니다</AlertTitle>
                        <AlertDescription>
                            이 화면은 중국 구매 주문라인의 환불만 처리합니다. 구매자 환불과 마켓 주문 취소는 취소·반품·교환에서 별도로 완료해야 합니다.
                        </AlertDescription>
                    </Alert>

                    <div className="grid overflow-hidden rounded-lg border sm:grid-cols-2 lg:grid-cols-4">
                        <Summary label="TaoWorld 구매주문" value={order.taoWorldPurchase?.purchaseOrderId ?? refund?.providerPurchaseOrderId ?? "-"} mono />
                        <Summary label="구매 주문라인" value={order.taoWorldPurchase?.purchaseOrderLineId ?? refund?.purchaseOrderLineId ?? "-"} mono />
                        <Summary label="TaoWorld 결제금액" value={formatCny(order.taoWorldPurchase?.paidAmountCny)} />
                        <Summary label="국내 결제 참고금액" value={formatKrw(order.sourcingLifeActualPayment?.amount)} />
                    </div>

                    {refund ? (
                        <RefundProgress
                            order={order}
                            onAdvance={() => onAdvance(order)}
                            onSubmitReturnLogistics={(draftValue) => onSubmitReturnLogistics(order, draftValue)}
                        />
                    ) : (
                        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-base">1. 환불 조건 조회</CardTitle>
                                    <p className="text-sm text-muted-foreground">`/order/refund/render` 응답으로 입력 가능한 조건을 구성합니다.</p>
                                </CardHeader>
                                <CardContent className="grid gap-4 sm:grid-cols-2">
                                    <Field label="환불 유형 · refundType">
                                        <Select value={type} onValueChange={(value) => {
                                            setType(value as SourcingRefundType);
                                            setRefundFeeCny("");
                                        }}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="REFUND_ONLY">1 · {SOURCING_REFUND_TYPE_LABELS.REFUND_ONLY}</SelectItem>
                                                <SelectItem value="RETURN_AND_REFUND">2 · {SOURCING_REFUND_TYPE_LABELS.RETURN_AND_REFUND}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    <Field label="상품 상태 · goodsStatus">
                                        <Select value={goodsStatus} onValueChange={(value) => {
                                            setGoodsStatus(value as SourcingRefundGoodsStatus);
                                            setRefundFeeCny("");
                                        }}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {goodsStatuses.map((status) => (
                                                    <SelectItem key={status} value={status}>
                                                        {TAOWORLD_GOODS_STATUS_CODES[status]} · {SOURCING_REFUND_GOODS_STATUS_LABELS[status]}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    <Field label="환불 사유 · reasonId" className="sm:col-span-2">
                                        <Select value={reasonId} onValueChange={setReasonId}>
                                            <SelectTrigger><SelectValue placeholder="render 응답 사유 선택" /></SelectTrigger>
                                            <SelectContent>
                                                {rendered?.reasons.map((reason) => (
                                                    <SelectItem key={reason.reasonId} value={reason.reasonId}>
                                                        {reason.reasonLabel} · {reason.reasonId}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                </CardContent>
                            </Card>

                            <Card className="bg-muted">
                                <CardHeader>
                                    <CardTitle className="text-base">render 데모 응답</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3 text-sm">
                                    <ApiValue label="purchaseOrderLineId" value={rendered?.purchaseOrderLineId ?? "-"} />
                                    <ApiValue label="refundType" value={String(rendered?.refundType ?? TAOWORLD_REFUND_TYPE_CODES[type])} />
                                    <ApiValue label="goodsStatus" value={String(rendered?.goodsStatus ?? TAOWORLD_GOODS_STATUS_CODES[goodsStatus])} />
                                    <ApiValue label="maxRefundFee" value={formatCny(rendered?.maxRefundFeeCny)} />
                                    <ApiValue label="currency" value={rendered?.currency ?? "CNY"} />
                                </CardContent>
                            </Card>

                            <Card className="lg:col-span-2">
                                <CardHeader>
                                    <CardTitle className="text-base">2. 환불 요청 작성</CardTitle>
                                    <p className="text-sm text-muted-foreground">`/order/refund/submit`에 전달할 데모 요청값입니다.</p>
                                </CardHeader>
                                <CardContent className="grid gap-4 sm:grid-cols-2">
                                    <Field label="환불 요청금액 · refundFee (CNY)">
                                        <Input
                                            inputMode="decimal"
                                            value={refundFeeCny}
                                            onChange={(event) => setRefundFeeCny(event.target.value.replace(/[^0-9.]/g, ""))}
                                        />
                                        <p className="mt-2 text-xs text-muted-foreground">최대 {formatCny(rendered?.maxRefundFeeCny)} · 원화는 정산 참고값으로만 표시합니다.</p>
                                    </Field>
                                    <Field label="마켓 클레임 ID (내부 연결용·선택)">
                                        <Input value={marketClaimId} onChange={(event) => setMarketClaimId(event.target.value)} placeholder="TaoWorld 전송값이 아닙니다" />
                                    </Field>
                                    <Field label="환불 설명 · refundDesc" className="sm:col-span-2">
                                        <Textarea value={refundDescription} onChange={(event) => setRefundDescription(event.target.value)} placeholder="중국 판매자가 확인할 상품 상태와 요청 내용을 입력하세요." />
                                    </Field>
                                    <Field label="증빙 이미지 URL · refundImages (선택)" className="sm:col-span-2">
                                        <Input value={refundImageUrl} onChange={(event) => setRefundImageUrl(event.target.value)} placeholder="https://..." />
                                    </Field>
                                </CardContent>
                            </Card>

                            <Label className="flex items-start gap-3 rounded-lg border bg-muted p-4 text-sm leading-5 lg:col-span-2">
                                <Checkbox checked={separateFlowConfirmed} onCheckedChange={(value) => setSeparateFlowConfirmed(value === true)} />
                                <span>마켓 클레임과 국내 구매자 환불은 자동 완료되지 않으며, TaoWorld 환불 결과와 별도로 대사해야 함을 확인했습니다.</span>
                            </Label>

                            {validationMessage ? <p className="text-sm font-medium text-foreground lg:col-span-2">{validationMessage}</p> : null}
                            {order.dataSource === "api" ? (
                                <p className="text-sm text-muted-foreground lg:col-span-2">실주문에는 데모 요청을 기록하지 않습니다. TaoWorld 어댑터 연결 전까지 전송 버튼을 비활성화합니다.</p>
                            ) : null}
                        </div>
                    )}
                </div>

                <DialogFooter className="border-t border-border px-6 py-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
                    {!refund ? (
                        <Button
                            onClick={submit}
                            disabled={Boolean(validationMessage) || !separateFlowConfirmed || submitting || order.dataSource === "api"}
                        >
                            {submitting ? "요청 생성 중..." : order.dataSource === "api" ? "실전송 비활성" : "환불 요청 데모"}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function RefundProgress({
    order,
    onAdvance,
    onSubmitReturnLogistics,
}: {
    order: Order;
    onAdvance: () => void;
    onSubmitReturnLogistics: (draft: SourcingReturnLogisticsDraft) => boolean;
}) {
    const refund = order.sourcingRefund;
    const [companyCode, setCompanyCode] = useState<string>(TAOWORLD_RETURN_LOGISTICS_OPTIONS[0].code);
    const [trackingNumber, setTrackingNumber] = useState("");
    const [buyerPhone, setBuyerPhone] = useState("");
    const [description, setDescription] = useState("");
    if (!refund) return null;
    const company = TAOWORLD_RETURN_LOGISTICS_OPTIONS.find((option) => option.code === companyCode) ?? TAOWORLD_RETURN_LOGISTICS_OPTIONS[0];
    const terminal = refund.status === "REFUNDED" || refund.status === "REJECTED";
    const canAdvance = ["REQUESTED", "PROVIDER_REVIEW", "RETURN_IN_TRANSIT", "REFUND_PENDING"].includes(refund.status);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted p-4">
                <div>
                    <div className="text-xs font-semibold text-muted-foreground">query 기준 현재 상태</div>
                    <div className="mt-1 text-base font-bold">{SOURCING_REFUND_STATUS_LABELS[refund.status]}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="bg-card">refundStatus {refund.providerStatusCode}</Badge>
                    <Badge variant="outline" className="bg-card">{SOURCING_REFUND_TYPE_LABELS[refund.type]}</Badge>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
                <ProgressStep icon={<CheckCircle2 className="size-4" />} label="submit 접수" detail={refund.requestedAt} active />
                <ProgressStep icon={<RefreshCw className="size-4" />} label="message·query" detail={`refundId ${refund.providerRefundId}`} active={!terminal && refund.status !== "REQUESTED"} />
                <ProgressStep icon={<RotateCcw className="size-4" />} label="반품 물류" detail={refund.type === "RETURN_AND_REFUND" ? refund.returnLogistics?.trackingNumber ?? "필요 시 등록" : "해당 없음"} active={refund.status === "RETURN_REQUIRED" || refund.status === "RETURN_IN_TRANSIT"} />
                <ProgressStep icon={<Clock3 className="size-4" />} label="환불 완료" detail={formatCny(refund.approvedRefundFeeCny)} active={refund.status === "REFUND_PENDING" || refund.status === "REFUNDED"} />
            </div>

            <div className="grid overflow-hidden rounded-lg border sm:grid-cols-2 lg:grid-cols-4">
                <Summary label="refundId" value={refund.providerRefundId} mono />
                <Summary label="purchaseOrderLineId" value={refund.purchaseOrderLineId} mono />
                <Summary label="요청 사유" value={`${refund.reasonLabel} · ${refund.reasonId}`} />
                <Summary label="요청금액" value={`${formatCny(refund.refundFeeCny)} ${refund.currency}`} />
                <Summary label="상품 상태" value={`${TAOWORLD_GOODS_STATUS_CODES[refund.goodsStatus]} · ${SOURCING_REFUND_GOODS_STATUS_LABELS[refund.goodsStatus]}`} />
                <Summary label="예상 국내 환급" value={formatKrw(refund.estimatedRefundKrw)} />
                <Summary label="예상 국내 차감" value={formatKrw(refund.estimatedDeductionKrw)} />
                <Summary label="마켓 클레임" value={refund.marketClaimId ?? "연결 없음"} mono />
            </div>

            {refund.status === "RETURN_REQUIRED" ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base"><Truck className="size-4" />중국 반품 송장 등록</CardTitle>
                        <p className="text-sm text-muted-foreground">`/order/refund/render/logistics`에서 받은 택배사 코드로 `/submit/logistics` 요청을 구성합니다.</p>
                    </CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-2">
                        <Field label="반품 택배사 · logisticsCompanyCode">
                            <Select value={companyCode} onValueChange={setCompanyCode}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {TAOWORLD_RETURN_LOGISTICS_OPTIONS.map((option) => (
                                        <SelectItem key={option.code} value={option.code}>{option.name} · {option.code}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="반품 송장번호 · logisticsNo">
                            <Input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} />
                        </Field>
                        <Field label="반품자 전화번호 · buyerPhone">
                            <Input value={buyerPhone} onChange={(event) => setBuyerPhone(event.target.value)} />
                        </Field>
                        <Field label="반품 설명 · returnGoodsDesc">
                            <Input value={description} onChange={(event) => setDescription(event.target.value)} />
                        </Field>
                        <Button
                            className="sm:col-span-2"
                            onClick={() => onSubmitReturnLogistics({
                                companyCode: company.code,
                                companyName: company.name,
                                trackingNumber,
                                buyerPhone,
                                description,
                            })}
                        >
                            submit/logistics 데모
                        </Button>
                    </CardContent>
                </Card>
            ) : null}

            {refund.returnLogistics ? (
                <Alert>
                    <Truck />
                    <AlertTitle>중국 반품 송장 등록 완료</AlertTitle>
                    <AlertDescription>{refund.returnLogistics.companyName} · {refund.returnLogistics.trackingNumber}</AlertDescription>
                </Alert>
            ) : null}

            {refund.providerMessage ? (
                <Alert className={refund.status === "REJECTED" || refund.status === "RECONCILIATION_REQUIRED" ? "border-foreground bg-muted" : undefined}>
                    <AlertCircle />
                    <AlertTitle>TaoWorld query 결과</AlertTitle>
                    <AlertDescription>{refund.providerMessage}</AlertDescription>
                </Alert>
            ) : null}

            {canAdvance ? (
                <Button variant="outline" className="w-full" onClick={onAdvance}>
                    <RefreshCw /> message_type=9 수신·query 데모
                </Button>
            ) : null}
        </div>
    );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    return <div className={className}><Label className="mb-2 block">{label}</Label>{children}</div>;
}

function Summary({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
    return (
        <div className="min-w-0 border-b px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <div className="text-xs font-semibold text-muted-foreground">{label}</div>
            <div className={`mt-1 break-words text-sm font-semibold ${mono ? "font-mono" : ""}`}>{value}</div>
        </div>
    );
}

function ApiValue({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-3 border-b pb-2 last:border-b-0 last:pb-0">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="break-all text-right font-mono text-xs font-semibold">{value}</span>
        </div>
    );
}

function ProgressStep({ icon, label, detail, active }: { icon: React.ReactNode; label: string; detail: string; active: boolean }) {
    return (
        <div className={`rounded-lg border p-4 ${active ? "bg-muted" : "bg-card"}`}>
            <div className="flex items-center gap-2 text-sm font-bold">{icon}{label}</div>
            <div className="mt-2 break-all text-xs text-muted-foreground">{detail}</div>
        </div>
    );
}
