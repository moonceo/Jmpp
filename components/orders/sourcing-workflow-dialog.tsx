"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { getSourcingCandidates, SourcingMatchCandidate, SourcingOption } from "@/lib/mock-data/sourcing-life";
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
        quantity: order.product.quantity,
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
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[92vh] max-w-[1180px] overflow-hidden p-0">
                <DialogHeader className="border-b px-6 py-5">
                    <DialogTitle className="text-xl">소싱하기</DialogTitle>
                    <DialogDescription className="mt-2">
                        {mode === "match-only"
                            ? "후보 상품과 옵션을 선택하면 주문확인까지 처리하고 상품준비로 이동합니다."
                            : "후보 상품과 옵션을 선택한 뒤 소싱라이프 결제 완료를 가정해 발송대기로 이동합니다."}
                    </DialogDescription>
                </DialogHeader>

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

                        <Button variant="outline" className="mt-5 w-full border-orange-300 text-orange-700 hover:bg-orange-50" asChild>
                            <a href={directSourcingUrl} target="_blank" rel="noopener noreferrer">
                                소싱라이프에서 직접 찾기
                            </a>
                        </Button>
                    </aside>

                    <section className="overflow-y-auto p-5">
                        <div className="mb-4">
                            <h3 className="font-semibold">이미지 매칭 결과</h3>
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
                                            <div>
                                                <div className="line-clamp-2 text-sm font-semibold">{candidate.productName}</div>
                                                <div className="mt-1 text-xs text-slate-500">{candidate.sellerName}</div>
                                            </div>
                                            <Badge className="bg-orange-600">{candidate.matchRate}%</Badge>
                                        </div>
                                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                                            <Metric label="위안" value={`${candidate.priceCny.toLocaleString()}위안`} />
                                            <Metric label="원화" value={`${candidate.priceKrw.toLocaleString()}원`} />
                                            <Metric label="배송" value={candidate.deliveryDays} />
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
                                {selectedMatch.options.map((option) => (
                                    <OptionButton
                                        key={option.id}
                                        option={option}
                                        selected={selectedOption.id === option.id}
                                        onSelect={() => setSelectedOptionId(option.id)}
                                    />
                                ))}
                            </div>
                            <Separator className="my-4" />
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">수량</span>
                                    <span className="font-semibold">{order.product.quantity}개</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">상품원가</span>
                                    <span className="font-semibold">{selectedOption.priceKrw.toLocaleString()}원</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">예상마진</span>
                                    <span className="font-bold text-emerald-700">
                                        {(order.expectedSettlement - selectedOption.priceKrw * order.product.quantity).toLocaleString()}원
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
                                disabled={!hasRequiredInfo}
                                onClick={completePayment}
                            >
                                소싱라이프 결제 완료
                            </Button>
                        )}
                    </aside>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded border bg-slate-50 px-2 py-1.5">
            <div className="text-[10px] text-slate-400">{label}</div>
            <div className="font-semibold text-slate-800">{value}</div>
        </div>
    );
}

function OptionButton({ option, selected, onSelect }: { option: SourcingOption; selected: boolean; onSelect: () => void }) {
    return (
        <button
            type="button"
            className={cn(
                "flex w-full items-center justify-between rounded-md border bg-white p-3 text-left text-sm transition hover:border-slate-300",
                selected && "border-orange-500 bg-orange-50 ring-2 ring-orange-100",
            )}
            onClick={onSelect}
        >
            <div>
                <div className="font-medium">{option.label}</div>
                <div className="mt-1 text-xs text-slate-500">재고 {option.stock}개 · {option.priceCny.toLocaleString()}위안</div>
            </div>
            <div className="flex items-center gap-2">
                <span className="font-bold">{option.priceKrw.toLocaleString()}원</span>
                {selected && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-orange-600 text-white">
                        <Check className="h-3.5 w-3.5" />
                    </span>
                )}
            </div>
        </button>
    );
}
