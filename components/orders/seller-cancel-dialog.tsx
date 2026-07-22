"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export const NAVER_SELLER_CANCEL_REASON_OPTIONS = [
    { value: "INTENT_CHANGED", label: "구매 의사 취소" },
    { value: "COLOR_AND_SIZE", label: "색상 및 사이즈 변경" },
    { value: "WRONG_ORDER", label: "다른 상품 잘못 주문" },
    { value: "PRODUCT_UNSATISFIED", label: "서비스 불만족" },
    { value: "DELAYED_DELIVERY", label: "배송 지연" },
    { value: "SOLD_OUT", label: "상품 품절" },
    { value: "INCORRECT_INFO", label: "상품 정보 상이" },
] as const;

export type NaverSellerCancelReason =
    (typeof NAVER_SELLER_CANCEL_REASON_OPTIONS)[number]["value"];

export const MAX_SELLER_CANCEL_QUANTITY = 100_000;

export interface SellerCancelIntent {
    reasonCode: NaverSellerCancelReason;
    reasonDetail: string;
    quantity?: number;
}

export interface SellerCancelSubmitResult {
    accepted: boolean;
    message?: string;
}

export function buildSellerCancelCommandPayload(
    intent: SellerCancelIntent,
    orderedQuantity: number,
): SellerCancelIntent {
    if (intent.quantity !== orderedQuantity) return intent;
    return {
        reasonCode: intent.reasonCode,
        reasonDetail: intent.reasonDetail,
    };
}

interface SellerCancelValidationErrors {
    reasonCode?: string;
    reasonDetail?: string;
    quantity?: string;
}

export type SellerCancelValidationResult =
    | { ok: true; value: SellerCancelIntent }
    | { ok: false; errors: SellerCancelValidationErrors };

const officialReasons = new Set<string>(
    NAVER_SELLER_CANCEL_REASON_OPTIONS.map((option) => option.value),
);

function normalizeDetail(value: string): string {
    return value.replace(/[\t\r\n ]+/g, " ").trim();
}

export function validateSellerCancelDraft(input: {
    reasonCode: string;
    reasonDetail: string;
    quantity: string | null;
    orderedQuantity: number | null;
}): SellerCancelValidationResult {
    const errors: SellerCancelValidationErrors = {};
    const detail = normalizeDetail(input.reasonDetail);

    if (!officialReasons.has(input.reasonCode)) {
        errors.reasonCode = "네이버 공식 취소 사유를 선택해 주세요.";
    }
    if (detail.length < 2) {
        errors.reasonDetail = "운영 이력에 남길 상세 사유를 2자 이상 입력해 주세요.";
    } else if (detail.length > 500) {
        errors.reasonDetail = "상세 사유는 500자 이하여야 합니다.";
    } else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.reasonDetail)) {
        errors.reasonDetail = "상세 사유에는 제어 문자를 사용할 수 없습니다.";
    }

    let quantity: number | undefined;
    if (input.orderedQuantity !== null) {
        quantity = Number(input.quantity);
        if (
            !Number.isSafeInteger(input.orderedQuantity)
            || input.orderedQuantity <= 0
            || input.orderedQuantity > MAX_SELLER_CANCEL_QUANTITY
        ) {
            errors.quantity = "주문 수량이 올바르지 않아 취소할 수 없습니다.";
        } else if (!input.quantity?.trim() || !Number.isSafeInteger(quantity) || quantity <= 0) {
            errors.quantity = "취소 수량은 1 이상의 정수여야 합니다.";
        } else if (quantity > input.orderedQuantity) {
            errors.quantity = `취소 수량은 주문 수량 ${input.orderedQuantity}개를 넘을 수 없습니다.`;
        }
    }

    if (Object.keys(errors).length > 0) return { ok: false, errors };

    return {
        ok: true,
        value: {
            reasonCode: input.reasonCode as NaverSellerCancelReason,
            reasonDetail: detail,
            ...(quantity === undefined ? {} : { quantity }),
        },
    };
}

interface SellerCancelDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    orderLabel: string;
    orderedQuantity?: number;
    selectionCount?: number;
    hasLiveOrders: boolean;
    onSubmit: (
        intent: SellerCancelIntent,
    ) => boolean | SellerCancelSubmitResult | Promise<boolean | SellerCancelSubmitResult>;
}

export function SellerCancelDialog({
    open,
    onOpenChange,
    orderLabel,
    orderedQuantity,
    selectionCount = 1,
    hasLiveOrders,
    onSubmit,
}: SellerCancelDialogProps) {
    const [reasonCode, setReasonCode] = useState("");
    const [reasonDetail, setReasonDetail] = useState("");
    const [quantity, setQuantity] = useState(orderedQuantity ? String(orderedQuantity) : "");
    const [attempted, setAttempted] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setReasonCode("");
        setReasonDetail("");
        setQuantity(orderedQuantity ? String(orderedQuantity) : "");
        setAttempted(false);
        setSubmitting(false);
        setSubmitError(null);
    }, [open, orderedQuantity]);

    const validation = useMemo(() => validateSellerCancelDraft({
        reasonCode,
        reasonDetail,
        quantity: orderedQuantity === undefined ? null : quantity,
        orderedQuantity: orderedQuantity ?? null,
    }), [orderedQuantity, quantity, reasonCode, reasonDetail]);
    const errors = attempted && !validation.ok ? validation.errors : {};

    const submit = async () => {
        setAttempted(true);
        setSubmitError(null);
        if (!validation.ok) return;

        setSubmitting(true);
        try {
            const result = await onSubmit(validation.value);
            const accepted = typeof result === "boolean" ? result : result.accepted;
            if (accepted) {
                onOpenChange(false);
            } else {
                setSubmitError(
                    typeof result === "boolean"
                        ? "명령이 접수되지 않았습니다. 계정 UAT 상태와 입력값을 확인해 주세요."
                        : result.message ?? "명령이 접수되지 않았습니다. 계정 UAT 상태와 입력값을 확인해 주세요.",
                );
            }
        } catch (error) {
            setSubmitError(
                error instanceof Error
                    ? error.message
                    : "판매자 취소 명령을 접수하지 못했습니다.",
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={submitting ? undefined : onOpenChange}>
            <DialogContent className="max-w-lg overflow-hidden p-0">
                <div className="border-b border-red-100 bg-[linear-gradient(135deg,#fff7f7_0%,#ffffff_64%)] px-6 py-5">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-red-600">
                        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                        High-impact action
                    </div>
                    <DialogHeader className="gap-1 text-left">
                        <DialogTitle>판매자 주문취소 명령</DialogTitle>
                        <DialogDescription>
                            {selectionCount > 1
                                ? `${selectionCount}개 주문의 전체 수량을 각각 취소 요청합니다.`
                                : `${orderLabel} 주문의 취소 사유와 수량을 확인해 주세요.`}
                        </DialogDescription>
                    </DialogHeader>
                </div>

                <div className="grid gap-5 px-6 py-5">
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-5 text-amber-950">
                        <div className="font-semibold">스마트스토어 API 실행 조건</div>
                        <p className="mt-1">
                            실주문은 계정별 SELLER_CANCEL UAT가 통과된 경우에만 API 명령을 접수합니다.
                            미승인 계정은 <span className="font-semibold">MANUAL_FALLBACK</span>으로 남으며,
                            이 화면이 마켓 성공 상태를 임의로 만들지 않습니다.
                        </p>
                        {!hasLiveOrders ? (
                            <p className="mt-1 text-amber-800">현재 선택은 데모 데이터이므로 로컬 시연 상태만 변경됩니다.</p>
                        ) : null}
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="seller-cancel-reason">공식 취소 사유</Label>
                        <Select
                            value={reasonCode}
                            onValueChange={(value) => {
                                setReasonCode(value);
                                setSubmitError(null);
                            }}
                            disabled={submitting}
                        >
                            <SelectTrigger
                                id="seller-cancel-reason"
                                className="w-full"
                                aria-invalid={Boolean(errors.reasonCode)}
                            >
                                <SelectValue placeholder="취소 사유 선택" />
                            </SelectTrigger>
                            <SelectContent>
                                {NAVER_SELLER_CANCEL_REASON_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        <span>{option.label}</span>
                                        <span className="ml-2 font-mono text-[10px] text-slate-400">{option.value}</span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {errors.reasonCode ? <p className="text-xs text-red-600">{errors.reasonCode}</p> : null}
                    </div>

                    <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-3">
                            <Label htmlFor="seller-cancel-detail">상세 사유</Label>
                            <span className="text-[11px] tabular-nums text-slate-400">
                                {normalizeDetail(reasonDetail).length}/500
                            </span>
                        </div>
                        <Textarea
                            id="seller-cancel-detail"
                            value={reasonDetail}
                            onChange={(event) => {
                                setReasonDetail(event.target.value);
                                setSubmitError(null);
                            }}
                            placeholder="공급처 품절 확인, 구매자 요청 등 취소 근거를 입력하세요."
                            maxLength={500}
                            rows={3}
                            disabled={submitting}
                            aria-invalid={Boolean(errors.reasonDetail)}
                            className="min-h-24 resize-none"
                        />
                        {errors.reasonDetail ? <p className="text-xs text-red-600">{errors.reasonDetail}</p> : null}
                    </div>

                    {orderedQuantity === undefined ? (
                        <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm">
                            <span className="text-slate-600">취소 수량</span>
                            <span className="font-semibold text-slate-950">각 주문의 전체 수량</span>
                        </div>
                    ) : (
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between gap-3">
                                <Label htmlFor="seller-cancel-quantity">취소 수량</Label>
                                <span className="text-xs text-slate-500">주문 수량 {orderedQuantity}개</span>
                            </div>
                            <Input
                                id="seller-cancel-quantity"
                                type="number"
                                min={1}
                                max={orderedQuantity}
                                step={1}
                                value={quantity}
                                onChange={(event) => {
                                    setQuantity(event.target.value);
                                    setSubmitError(null);
                                }}
                                disabled={submitting}
                                aria-invalid={Boolean(errors.quantity)}
                            />
                            {errors.quantity ? <p className="text-xs text-red-600">{errors.quantity}</p> : null}
                        </div>
                    )}

                    {submitError ? (
                        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {submitError}
                        </div>
                    ) : null}
                </div>

                <DialogFooter className="border-t border-slate-100 bg-slate-50/70 px-6 py-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                        닫기
                    </Button>
                    <Button className="bg-red-600 hover:bg-red-700" onClick={submit} disabled={submitting}>
                        {submitting ? "명령 접수 중..." : "판매자 취소 명령 접수"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
