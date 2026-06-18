"use client";

import { ReactNode, useMemo, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getSourcingCandidates, SourcingMatchCandidate } from "@/lib/mock-data/sourcing-life";
import { cn } from "@/lib/utils";
import { Order, SourcingLifeMatch } from "@/types/order";

interface SourcingWorkflowDialogProps {
    order: Order | null;
    open: boolean;
    mode: "match-only" | "payment";
    onOpenChange: (open: boolean) => void;
    onConfirmMatch?: (order: Order, match: SourcingLifeMatch) => void;
    onCompletePayment?: (order: Order, match: SourcingLifeMatch) => void;
}

function getMissingSourcingLifeFields(order: Order) {
    const missing: string[] = [];
    const customsCode = order.recipient.personalCustomsCode?.trim().toUpperCase() ?? "";

    if (!order.recipient.name.trim()) missing.push("수령인명");
    if (!order.recipient.phone.trim()) missing.push("수령인 연락처");
    if (!order.recipient.zipCode?.trim()) missing.push("우편번호");
    if (!order.recipient.address.trim()) missing.push("기본주소");
    if (!/^P\d{12}$/.test(customsCode)) missing.push("개인통관부호");

    return missing;
}

export function SourcingWorkflowDialog({
    order,
    open,
    mode,
    onOpenChange,
    onConfirmMatch,
    onCompletePayment,
}: SourcingWorkflowDialogProps) {
    const candidates = useMemo(() => getSourcingCandidates(order?.id ?? ""), [order?.id]);
    const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>();
    const selectedMatch = candidates.find((candidate) => candidate.id === selectedMatchId) ?? candidates[0];
    const [selectedOptionId, setSelectedOptionId] = useState<string | undefined>();
    const selectedOption = selectedMatch?.options.find((option) => option.id === selectedOptionId) ?? selectedMatch?.options[0];
    const [showPaymentPage, setShowPaymentPage] = useState(false);
    const [purchaseStep, setPurchaseStep] = useState<"application" | "payment">("application");
    const [quantity, setQuantity] = useState(order?.product.quantity ?? 1);

    if (!order || !selectedMatch || !selectedOption) return null;

    const missingFields = getMissingSourcingLifeFields(order);
    const hasRequiredInfo = missingFields.length === 0;

    const paymentUrl = `https://www.sourcinglife.co.kr/payment?orderId=${order.id}&matchId=${selectedMatch.id}&optionId=${selectedOption.id}`;
    const directSourcingUrl = `https://www.sourcinglife.co.kr/search?orderId=${order.id}`;

    const handleSelectMatch = (candidate: SourcingMatchCandidate) => {
        setSelectedMatchId(candidate.id);
        setSelectedOptionId(candidate.options[0]?.id);
    };

    const buildMatch = (): SourcingLifeMatch => ({
        candidateId: selectedMatch.id,
        optionId: selectedOption.id,
        productId: selectedMatch.productId,
        productName: selectedMatch.productName,
        thumbnail: selectedMatch.thumbnail,
        matchRate: selectedMatch.matchRate,
        optionName: selectedOption.label,
        quantity,
        estimatedCost: selectedOption.priceKrw,
        paymentUrl,
    });

    const saveMatch = () => {
        onConfirmMatch?.(order, buildMatch());
        onOpenChange(false);
    };

    const completePayment = () => {
        if (!hasRequiredInfo) return;
        onCompletePayment?.(order, buildMatch());
        setShowPaymentPage(false);
        setPurchaseStep("application");
        onOpenChange(false);
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) {
            setShowPaymentPage(false);
            setPurchaseStep("application");
        }
        onOpenChange(nextOpen);
    };
    const decreaseQuantity = () => setQuantity((current) => Math.max(1, current - 1));
    const increaseQuantity = () => setQuantity((current) => Math.min(selectedOption.stock, current + 1));
    const isSelectedOptionSoldOut = selectedOption.stock <= 0;
    const productCostTotal = selectedOption.priceKrw * quantity;
    const simpleDifference = order.paymentPrice - productCostTotal;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className={cn("max-h-[92vh] overflow-hidden p-0", showPaymentPage ? "max-w-[1280px]" : "max-w-[1180px]")}>
                <DialogHeader className="border-b px-6 py-5">
                    <DialogTitle className="text-xl">{showPaymentPage ? "소싱라이프 결제 하기" : "소싱하기"}</DialogTitle>
                    {!showPaymentPage && (
                        <DialogDescription className="mt-2">
                            {mode === "match-only"
                                ? "후보 상품과 옵션을 선택하면 주문확인까지 처리하고 상품준비로 이동합니다."
                                : "후보 상품과 옵션을 선택한 뒤 소싱라이프 결제 완료를 가정해 발송대기로 이동합니다."}
                        </DialogDescription>
                    )}
                </DialogHeader>

                {showPaymentPage ? (
                    <div className="max-h-[calc(92vh-88px)] overflow-auto bg-white">
                        <div className="border-b px-6 py-3">
                            <button type="button" className="text-sm font-medium text-slate-500 hover:text-slate-900" onClick={() => (purchaseStep === "payment" ? setPurchaseStep("application") : setShowPaymentPage(false))}>
                                ← 이전으로
                            </button>
                        </div>

                        <div className="grid min-h-[680px] grid-cols-1 gap-6 p-6 xl:grid-cols-[1fr_260px]">
                            <div className="space-y-6">
                                <div className="grid grid-cols-[72px_1fr_84px_120px_120px] items-center gap-4 border-b border-t bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-600">
                                    <div />
                                    <div className="text-center">상품명</div>
                                    <div className="text-center">총수량</div>
                                    <div className="text-center">소계(元)</div>
                                    <div className="text-center">소계(원)</div>
                                </div>
                                <div className="grid grid-cols-[72px_1fr_84px_120px_120px] items-center gap-4 border-b px-3 pb-4">
                                    <div className="relative h-14 w-14 overflow-hidden rounded border bg-white">
                                        <Image src={selectedMatch.thumbnail} alt={selectedMatch.productName} fill sizes="56px" className="object-cover" />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-bold text-slate-950">{selectedMatch.productName}</div>
                                        <div className="mt-1 truncate text-xs text-slate-500">{selectedOption.label}</div>
                                    </div>
                                    <div className="text-center text-sm font-bold">{quantity}</div>
                                    <div className="text-center text-sm font-bold text-red-600">{(selectedOption.priceCny * quantity).toLocaleString()}元</div>
                                    <div className="text-center text-sm font-bold text-red-600">{productCostTotal.toLocaleString()}원</div>
                                </div>

                                {purchaseStep === "application" ? (
                                    <div className="space-y-5">
                                        <h3 className="text-lg font-bold text-slate-950">소비자(최종 구매자) 정보 입력</h3>
                                        <div className="overflow-hidden border-y">
                                            <FormRow label="수취인명" required>
                                                <Input defaultValue={order.recipient.name} className="h-9 bg-white" />
                                            </FormRow>
                                            <FormRow label="연락처" required>
                                                <Input defaultValue={order.recipient.phone} className="h-9 bg-white" />
                                            </FormRow>
                                            <FormRow label="주소" required>
                                                <div className="space-y-2">
                                                    <div className="flex gap-2">
                                                        <Input defaultValue={order.recipient.zipCode ?? ""} placeholder="우편번호" className="h-9 max-w-[160px] bg-white" />
                                                        <Button type="button" className="h-9 bg-slate-900 hover:bg-slate-800">주소 검색</Button>
                                                    </div>
                                                    <Input defaultValue={order.recipient.address} placeholder="기본주소" className="h-9 bg-white" />
                                                    <Input defaultValue={order.recipient.detailAddress ?? ""} placeholder="상세주소" className="h-9 bg-white" />
                                                </div>
                                            </FormRow>
                                            <FormRow label="구매 유형" required>
                                                <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
                                                    <div className="flex items-center gap-4">
                                                        <label className="flex items-center gap-2 text-sm"><input type="radio" defaultChecked /> 개인</label>
                                                        <label className="flex items-center gap-2 text-sm"><input type="radio" /> 사업자</label>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <Input defaultValue={order.recipient.personalCustomsCode ?? ""} placeholder="P로 시작하는 13자리 번호" className="h-9 bg-white" />
                                                        <Button type="button" className="h-9 bg-slate-900 hover:bg-slate-800">검증</Button>
                                                    </div>
                                                </div>
                                            </FormRow>
                                            <FormRow label="주문 요청사항">
                                                <Textarea defaultValue={order.recipient.deliveryMessage ?? ""} className="min-h-20 bg-white" />
                                            </FormRow>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        <section className="space-y-3">
                                            <h3 className="text-lg font-bold text-slate-950">약관 동의</h3>
                                            <AgreementRow label="전체 동의" strong />
                                            <AgreementRow label="(필수) 개인정보 수집 이용동의를 확인하고 동의합니다." />
                                            <AgreementRow label="(필수) 이용약관을 확인하고 동의합니다." />
                                        </section>
                                        <section className="space-y-4">
                                            <h3 className="border-b pb-3 text-lg font-bold text-slate-950">결제 정보 입력</h3>
                                            <div className="grid grid-cols-[140px_1fr] border-y">
                                                <div className="bg-slate-50 px-4 py-4 text-xs font-semibold text-slate-600">결제수단 선택</div>
                                                <div className="space-y-6 px-6 py-5">
                                                    <label className="flex items-center gap-2 text-sm font-semibold"><input type="radio" defaultChecked /> 홈즈페이</label>
                                                    <div className="mx-auto flex h-32 w-52 items-center justify-center rounded-md border bg-slate-100 text-center text-sm text-slate-700">
                                                        +<br />카드·계좌 추가하기
                                                    </div>
                                                    <label className="flex items-center gap-2 text-sm text-slate-500"><input type="radio" /> 일반결제</label>
                                                    <Input placeholder="결제내역 받을 메일 입력" className="h-9 max-w-sm bg-white" />
                                                    <label className="flex items-center gap-2 text-sm text-slate-700">
                                                        <Checkbox defaultChecked />
                                                        [필수] 결제 서비스 이용 약관, 개인정보 처리 동의
                                                    </label>
                                                </div>
                                            </div>
                                        </section>
                                    </div>
                                )}
                            </div>

                            <PaymentSummary
                                amountCny={selectedOption.priceCny * quantity}
                                amountKrw={productCostTotal}
                                marketPaymentAmount={order.paymentPrice}
                                simpleDifference={simpleDifference}
                                primaryLabel={purchaseStep === "application" ? "다음" : "구매대행 신청"}
                                onPrimaryClick={purchaseStep === "application" ? () => setPurchaseStep("payment") : completePayment}
                                onCancel={() => setShowPaymentPage(false)}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="grid max-h-[calc(92vh-88px)] grid-cols-1 overflow-hidden lg:grid-cols-[320px_1fr_320px]">
                    <aside className="border-r bg-slate-50 p-5">
                        <div className="text-xs font-semibold uppercase tracking-tight text-slate-400">현재 주문</div>
                        <div className="mt-4 flex gap-3">
                            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border bg-white">
                                <Image src={order.product.thumbnail} alt={order.product.name} fill sizes="80px" className="object-cover" />
                            </div>
                            <div className="min-w-0">
                                <div className="line-clamp-3 text-sm font-semibold leading-snug">{order.product.name}</div>
                                <div className="mt-2 text-xs text-slate-500">{order.product.optionName}</div>
                                <div className="mt-1 text-xs text-slate-500">수량 {order.product.quantity}개</div>
                            </div>
                        </div>

                        <Separator className="my-5" />

                        <div className="space-y-2 text-xs text-slate-600">
                            <div className="flex justify-between gap-3">
                                <span>주문번호</span>
                                <span className="truncate font-mono text-slate-900">{order.marketOrderId}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>수령인</span>
                                <span className="font-medium text-slate-900">{order.recipient.name}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>결제금액</span>
                                <span className="font-bold text-slate-900">{order.paymentPrice.toLocaleString()}원</span>
                            </div>
                        </div>

                    </aside>

                    <section className="overflow-y-auto p-5">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h3 className="font-semibold">추천 소싱 상품</h3>
                            <Button variant="outline" className="h-8 border-orange-300 px-3 text-xs text-orange-700 hover:bg-orange-50" asChild>
                                <a href={directSourcingUrl} target="_blank" rel="noopener noreferrer">
                                    소싱라이프에서 직접 찾기
                                </a>
                            </Button>
                        </div>

                        <div className="grid gap-3">
                            {candidates.map((candidate) => (
                                <button
                                    key={candidate.id}
                                    type="button"
                                    className={cn(
                                        "flex w-full gap-4 rounded-md border bg-white p-3 text-left transition hover:border-slate-300 hover:shadow-sm",
                                        selectedMatch.id === candidate.id && "border-orange-500 ring-2 ring-orange-100",
                                    )}
                                    onClick={() => handleSelectMatch(candidate)}
                                >
                                    <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded border bg-white">
                                        <Image src={candidate.thumbnail} alt={candidate.productName} fill sizes="96px" className="object-cover" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="line-clamp-2 text-sm font-semibold text-slate-950">{candidate.productName}</div>
                                                <div className="mt-1 line-clamp-2 text-xs leading-4 text-slate-600">{candidate.productNameZh}</div>
                                                <div className="mt-1 text-xs text-slate-500">{candidate.sellerName}</div>
                                            </div>
                                        </div>
                                        <div className="mt-3 text-xs font-semibold text-slate-900">
                                            {candidate.priceKrw.toLocaleString()}원 ({candidate.priceCny.toLocaleString()}위안)
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>

                    <aside className="border-l bg-white p-5">
                        <h3 className="font-semibold">옵션 선택</h3>
                        <div className="mt-4 rounded-lg border bg-slate-50 p-4">
                            <div className="text-xs text-slate-500">선택 상품</div>
                            <div className="mt-1 text-sm font-semibold">{selectedMatch.productName}</div>
                            <Separator className="my-4" />
                            <div className="space-y-2">
                                <Select value={selectedOption.id} onValueChange={setSelectedOptionId}>
                                    <SelectTrigger className="h-auto min-h-12 w-full bg-white py-2 text-left">
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-semibold text-slate-900">
                                                {selectedOption.label}{selectedOption.stock <= 0 ? " · 품절" : ""}
                                            </span>
                                            <span className="mt-0.5 block truncate text-xs text-slate-500">
                                                {selectedOption.labelZh}
                                            </span>
                                        </span>
                                    </SelectTrigger>
                                    <SelectContent className="max-h-72" position="popper" side="bottom" align="start" avoidCollisions={false}>
                                        {selectedMatch.options.map((option) => (
                                            <SelectItem key={option.id} value={option.id} className="py-2">
                                                <span className="block min-w-0 max-w-[250px]">
                                                    <span className="block truncate text-sm font-semibold text-slate-900">
                                                        {option.label}{option.stock <= 0 ? " · 품절" : ""}
                                                    </span>
                                                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                                                        {option.labelZh}
                                                    </span>
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <Separator className="my-4" />
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">재고</span>
                                    <span className={cn("font-semibold", isSelectedOptionSoldOut && "text-red-600")}>
                                        {isSelectedOptionSoldOut ? "품절" : `${selectedOption.stock}개`}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-slate-500">수량</span>
                                    <div className="flex h-8 items-center rounded-md border bg-white">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 rounded-r-none px-0"
                                            disabled={quantity <= 1}
                                            onClick={decreaseQuantity}
                                        >
                                            -
                                        </Button>
                                        <div className="w-10 text-center text-sm font-semibold tabular-nums">{quantity}</div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 rounded-l-none px-0"
                                            disabled={quantity >= selectedOption.stock}
                                            onClick={increaseQuantity}
                                        >
                                            +
                                        </Button>
                                    </div>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">상품 단가</span>
                                    <span className="font-semibold">{selectedOption.priceKrw.toLocaleString()}원 ({selectedOption.priceCny.toLocaleString()}위안)</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">상품 원가 합계</span>
                                    <span className="font-semibold">{productCostTotal.toLocaleString()}원</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">결제금액 - 상품원가</span>
                                    <span className="font-bold text-emerald-700">
                                        {simpleDifference.toLocaleString()}원
                                    </span>
                                </div>
                            </div>
                        </div>

                        {mode === "match-only" ? (
                            <Button className="mt-4 h-11 w-full bg-orange-600 hover:bg-orange-700" onClick={saveMatch}>
                                주문확인
                            </Button>
                        ) : (
                            <Button
                                className="mt-4 h-11 w-full bg-orange-600 hover:bg-orange-700"
                                disabled={!hasRequiredInfo || isSelectedOptionSoldOut}
                                onClick={() => setShowPaymentPage(true)}
                            >
                                소싱라이프 결제 하기
                            </Button>
                        )}
                    </aside>
                </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function FormRow({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
    return (
        <div className="grid grid-cols-[140px_1fr] border-b last:border-b-0">
            <div className="bg-slate-50 px-4 py-4 text-xs font-semibold text-slate-700">
                {required && <span className="mr-1 text-red-500">*</span>}
                {label}
            </div>
            <div className="px-4 py-3">{children}</div>
        </div>
    );
}

function AgreementRow({ label, strong = false }: { label: string; strong?: boolean }) {
    return (
        <label className="flex items-center gap-2 border-b py-3 text-sm text-slate-700">
            <Checkbox />
            <span className={cn(strong && "font-bold text-slate-950")}>{label}</span>
            <span className="ml-auto text-slate-400">⌄</span>
        </label>
    );
}

function PaymentSummary({
    amountCny,
    amountKrw,
    marketPaymentAmount,
    simpleDifference,
    primaryLabel,
    onPrimaryClick,
    onCancel,
}: {
    amountCny: number;
    amountKrw: number;
    marketPaymentAmount: number;
    simpleDifference: number;
    primaryLabel: string;
    onPrimaryClick: () => void;
    onCancel: () => void;
}) {
    return (
        <aside className="h-fit rounded-3xl border bg-white p-5 shadow-sm">
            <div className="rounded-md bg-slate-50 px-4 py-3 text-sm">
                <div className="flex justify-between">
                    <span className="text-slate-500">상품 원가(元)</span>
                    <span className="font-bold">{amountCny.toLocaleString()}元</span>
                </div>
                <div className="mt-2 flex justify-between">
                    <span className="text-slate-500">상품 원가(원)</span>
                    <span className="font-bold">{amountKrw.toLocaleString()}원</span>
                </div>
            </div>
            <div className="mt-5 space-y-3 border-b pb-5 text-sm">
                <div className="flex justify-between">
                    <span className="text-slate-500">마켓 결제금액</span>
                    <span className="font-bold">{marketPaymentAmount.toLocaleString()}원</span>
                </div>
            </div>
            <div className="mt-5 flex justify-between text-sm">
                <span className="font-bold">결제금액 - 상품원가</span>
                <span className="font-extrabold text-red-600">{simpleDifference.toLocaleString()}원</span>
            </div>
            <Button className="mt-6 h-10 w-full rounded-full bg-[#ff8f80] font-bold hover:bg-[#ff7b6b]" onClick={onPrimaryClick}>
                {primaryLabel}
            </Button>
            <Button variant="outline" className="mt-2 h-10 w-full rounded-full" onClick={onCancel}>
                취소
            </Button>
        </aside>
    );
}
