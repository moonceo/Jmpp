"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { CheckCircle2, CreditCard, MessageCircle, PackageCheck, Send, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MARKET_LABELS } from "@/lib/constants/orders";
import { forwarderProfiles, getSourcingCandidates, type ForwarderProfile, type SourcingMatchCandidate, type SourcingOption } from "@/lib/mock-data/sourcing-life";
import { getSourcingProgressViewMeta, type SourcingProgressViewMeta } from "@/lib/sourcing-progress";
import { cn } from "@/lib/utils";
import { Order, SourcingForwarderSelection, SourcingLifeMatch } from "@/types/order";

interface SourcingWorkflowDialogProps {
    order: Order | null;
    open: boolean;
    mode: "match-only" | "payment" | "progress";
    onOpenChange: (open: boolean) => void;
    onConfirmMatch?: (order: Order, match: SourcingLifeMatch) => void;
    onRequestCancel?: (order: Order) => void;
    onCreatePaymentWait?: (order: Order, match: SourcingLifeMatch, forwarder: SourcingForwarderSelection) => void;
    onCompletePayment?: (order: Order, match: SourcingLifeMatch) => boolean;
}

interface SourcingChatMessage {
    id: string;
    sender: "operator" | "sourcing-life";
    message: string;
    sentAt: string;
}

export interface SourcingMarginCalculation {
    marketPaymentAmount: number;
    marketFee: number;
    marketFeeRate: number;
    expectedSettlement: number;
    productCost: number;
    sourcingServiceFee: number;
    currencyExchangeFee: number;
    estimatedForwarderShippingFee: number;
    sourcingTotalCost: number;
    expectedMargin: number;
    expectedMarginRate: number;
}

export interface SourcingAdditionalCosts {
    sourcingServiceFee?: number;
    currencyExchangeFee?: number;
    estimatedForwarderShippingFee?: number;
}

const SOURCING_SERVICE_FEE_RATE = 0.03;
const CURRENCY_EXCHANGE_FEE_RATE = 0.025;
const DEFAULT_FORWARDER_SHIPPING_FEE = 4750;

export function calculateSourcingMargin(
    order: Pick<Order, "paymentPrice" | "platformFee" | "expectedSettlement">,
    productCost: number,
    additionalCosts: SourcingAdditionalCosts = {},
): SourcingMarginCalculation {
    const marketPaymentAmount = Math.max(0, order.paymentPrice);
    const feeFromSettlement = Math.max(0, marketPaymentAmount - order.expectedSettlement);
    const marketFee = Math.max(0, order.platformFee || feeFromSettlement);
    const expectedSettlement = Math.max(0, order.expectedSettlement || marketPaymentAmount - marketFee);
    const sourcingServiceFee = additionalCosts.sourcingServiceFee ?? Math.floor(productCost * SOURCING_SERVICE_FEE_RATE);
    const currencyExchangeFee = additionalCosts.currencyExchangeFee ?? Math.floor(productCost * CURRENCY_EXCHANGE_FEE_RATE);
    const estimatedForwarderShippingFee = additionalCosts.estimatedForwarderShippingFee ?? DEFAULT_FORWARDER_SHIPPING_FEE;
    const sourcingTotalCost = productCost + sourcingServiceFee + currencyExchangeFee;
    const expectedMargin = marketPaymentAmount - marketFee - sourcingTotalCost - estimatedForwarderShippingFee;

    return {
        marketPaymentAmount,
        marketFee,
        marketFeeRate: marketPaymentAmount > 0 ? (marketFee / marketPaymentAmount) * 100 : 0,
        expectedSettlement,
        productCost,
        sourcingServiceFee,
        currencyExchangeFee,
        estimatedForwarderShippingFee,
        sourcingTotalCost,
        expectedMargin,
        expectedMarginRate: marketPaymentAmount > 0 ? (expectedMargin / marketPaymentAmount) * 100 : 0,
    };
}

const SOURCING_URL_HOSTS = ["taobao.com", "tmall.com", "tb.cn", "sourcinglife.co.kr"];

function isUrlLike(value: string) {
    return /^(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})/i.test(value.trim());
}

function parseAllowedProductUrl(value: string) {
    const normalized = value.trim();
    if (!normalized) return undefined;

    try {
        const url = new URL(/^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`);
        const host = url.hostname.replace(/^www\./, "").toLowerCase();
        return SOURCING_URL_HOSTS.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`)) ? url : undefined;
    } catch {
        return undefined;
    }
}

function buildUrlCandidate(order: Order, source: SourcingMatchCandidate, url: URL, sequence: number): SourcingMatchCandidate {
    const host = url.hostname.replace(/^www\./, "");
    const siteLabel = host.includes("sourcinglife") ? "소싱라이프 URL 상품" : "타오바오 URL 상품";

    return {
        ...source,
        id: `${order.id}-URL-${sequence}-${host}`,
        productId: `URL-${sequence}-${host}-${order.id}`,
        productName: `${siteLabel} - ${order.product.name}`,
        productNameZh: source.productNameZh,
        sellerName: host,
        matchRate: 100,
    };
}

function buildKeywordCandidates(order: Order, sources: SourcingMatchCandidate[], keyword: string, sequence: number) {
    return Array.from({ length: 20 }, (_, index) => {
        const source = sources[index % sources.length];
        const variation = sequence * 20 + index + 1;

        return {
            ...source,
            id: `${order.id}-KEYWORD-${sequence}-${String(index + 1).padStart(2, "0")}`,
            productId: `SEARCH-${sequence}-${order.id}-${String(index + 1).padStart(2, "0")}`,
            productName: `${keyword} 검색 상품 ${index + 1}`,
            productNameZh: `${source.productNameZh} 搜索结果 ${index + 1}`,
            sellerName: `${source.sellerName} 검색 ${index + 1}`,
            matchRate: Math.max(70, 96 - index),
            priceCny: source.priceCny + variation,
            priceKrw: source.priceKrw + variation * 189,
            salesCount: Math.max(120, source.salesCount - variation * 5),
            options: source.options.map((option, optionIndex) => ({
                ...option,
                id: `${option.id}-search-${sequence}-${index + 1}`,
                priceCny: option.priceCny + variation + optionIndex,
                priceKrw: option.priceKrw + variation * 189 + optionIndex * 189,
                stock: option.stock === 0 ? 0 : Math.max(3, option.stock - index),
            })),
        };
    });
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
    onRequestCancel,
    onCreatePaymentWait,
    onCompletePayment,
}: SourcingWorkflowDialogProps) {
    const candidates = useMemo(() => getSourcingCandidates(order?.id ?? ""), [order?.id]);
    const [searchQuery, setSearchQuery] = useState("");
    const [addedState, setAddedState] = useState<{ orderId?: string; candidates: SourcingMatchCandidate[]; sequence: number }>({
        candidates: [],
        sequence: 0,
    });
    const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>(order?.sourcingLifeMatch?.candidateId);
    const [candidateOptionIds, setCandidateOptionIds] = useState<Record<string, string>>(() => (
        order?.sourcingLifeMatch?.candidateId && order.sourcingLifeMatch.optionId
            ? { [order.sourcingLifeMatch.candidateId]: order.sourcingLifeMatch.optionId }
            : {}
    ));
    const [candidateQuantities, setCandidateQuantities] = useState<Record<string, number>>(() => (
        order?.sourcingLifeMatch?.candidateId
            ? { [order.sourcingLifeMatch.candidateId]: order.product.quantity }
            : {}
    ));
    const addedCandidates = useMemo(
        () => (addedState.orderId === order?.id ? addedState.candidates : []),
        [addedState, order?.id],
    );
    const searchSequence = addedState.orderId === order?.id ? addedState.sequence : 0;
    const displayedCandidates = useMemo(() => [...addedCandidates, ...candidates], [addedCandidates, candidates]);

    const selectedMatch = displayedCandidates.find((candidate) => candidate.id === selectedMatchId) ?? displayedCandidates[0];
    const selectedOptionId = selectedMatch ? candidateOptionIds[selectedMatch.id] : undefined;
    const selectedOption = selectedMatch?.options.find((option) => option.id === selectedOptionId) ?? selectedMatch?.options[0];
    const startsInPaymentWaiting = order?.sourcingLifeSyncStatus === "PAYMENT_READY";
    const startsInProgressView = startsInPaymentWaiting || mode === "progress";
    const [showPaymentPage, setShowPaymentPage] = useState(startsInProgressView);
    const [purchaseStep, setPurchaseStep] = useState<"forwarder" | "waiting" | "payment">(startsInProgressView ? "waiting" : "forwarder");
    const [selectedForwarderCode, setSelectedForwarderCode] = useState(order?.sourcingForwarder?.code ?? forwarderProfiles[0].code);
    const [chatDraft, setChatDraft] = useState("");
    const [chatMessages, setChatMessages] = useState<SourcingChatMessage[]>([
        {
            id: "welcome",
            sender: "sourcing-life",
            message: "구매대행 신청 후 상품 가격과 배송 조건을 확인해 드립니다. 문의사항을 남겨주세요.",
            sentAt: "상담 안내",
        },
    ]);
    if (!order || !selectedMatch || !selectedOption) return null;

    const quantity = Math.max(1, Math.min(
        candidateQuantities[selectedMatch.id] ?? order.product.quantity,
        Math.max(1, selectedOption.stock),
    ));

    const missingFields = getMissingSourcingLifeFields(order);
    const hasRequiredInfo = missingFields.length === 0;
    const searchError = searchQuery.trim() && isUrlLike(searchQuery) && !parseAllowedProductUrl(searchQuery)
        ? "URL은 타오바오 또는 소싱라이프 상품 URL만 입력할 수 있습니다."
        : undefined;

    const paymentUrl = `https://www.sourcinglife.co.kr/payment?orderId=${order.id}&matchId=${selectedMatch.id}&optionId=${selectedOption.id}`;

    const handleSelectMatch = (candidate: SourcingMatchCandidate) => {
        setSelectedMatchId(candidate.id);
    };

    const handleSelectOption = (candidate: SourcingMatchCandidate, option: SourcingOption) => {
        setSelectedMatchId(candidate.id);
        setCandidateOptionIds((current) => ({ ...current, [candidate.id]: option.id }));
        setCandidateQuantities((current) => ({
            ...current,
            [candidate.id]: option.stock > 0
                ? Math.min(current[candidate.id] ?? order.product.quantity, option.stock)
                : 1,
        }));
    };

    const changeCandidateQuantity = (candidate: SourcingMatchCandidate, option: SourcingOption, delta: number) => {
        if (option.stock <= 0) return;

        const currentQuantity = Math.max(1, Math.min(
            candidateQuantities[candidate.id] ?? order.product.quantity,
            option.stock,
        ));
        const nextQuantity = Math.max(1, Math.min(option.stock, currentQuantity + delta));

        setSelectedMatchId(candidate.id);
        setCandidateOptionIds((current) => ({ ...current, [candidate.id]: option.id }));
        setCandidateQuantities((current) => ({ ...current, [candidate.id]: nextQuantity }));
    };

    const handleFindCandidate = () => {
        const query = searchQuery.trim();
        if (!query || searchError) return;

        const nextSequence = searchSequence + 1;
        const allowedUrl = parseAllowedProductUrl(query);
        const nextCandidates = allowedUrl
            ? [buildUrlCandidate(order, candidates[0], allowedUrl, nextSequence)]
            : buildKeywordCandidates(order, candidates, query, nextSequence);

        setAddedState({
            orderId: order.id,
            candidates: [...nextCandidates, ...addedCandidates],
            sequence: nextSequence,
        });
        const firstCandidate = nextCandidates[0];
        setSelectedMatchId(firstCandidate?.id);
        if (firstCandidate?.options[0]) {
            setCandidateOptionIds((current) => ({
                ...current,
                [firstCandidate.id]: firstCandidate.options[0].id,
            }));
        }
        setSearchQuery("");
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
        const completed = onCompletePayment?.(order, buildMatch()) ?? false;
        if (!completed) return;
        setShowPaymentPage(true);
        setPurchaseStep("waiting");
    };

    const selectedForwarder = forwarderProfiles.find((profile) => profile.code === selectedForwarderCode) ?? forwarderProfiles[0];

    const createForwarderSelection = (profile: ForwarderProfile): SourcingForwarderSelection => ({
        code: profile.code,
        name: profile.name,
        receiverName: profile.receiverName,
        phone: profile.phone,
        address: `${profile.country} ${profile.province} ${profile.address1} ${profile.address2}`,
    });

    const createPaymentWait = () => {
        if (!hasRequiredInfo) return;
        onCreatePaymentWait?.(order, buildMatch(), createForwarderSelection(selectedForwarder));
        setPurchaseStep("waiting");
    };

    const sendChatMessage = () => {
        const message = chatDraft.trim();
        if (!message) return;
        setChatMessages((current) => [...current, {
            id: `${order.id}-${current.length + 1}`,
            sender: "operator",
            message,
            sentAt: "방금 전",
        }]);
        setChatDraft("");
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) {
            setShowPaymentPage(false);
            setPurchaseStep("forwarder");
            setSearchQuery("");
        }
        onOpenChange(nextOpen);
    };
    const decreaseQuantity = () => changeCandidateQuantity(selectedMatch, selectedOption, -1);
    const increaseQuantity = () => changeCandidateQuantity(selectedMatch, selectedOption, 1);
    const isSelectedOptionSoldOut = selectedOption.stock <= 0;
    const productCostTotal = selectedOption.priceKrw * quantity;
    const marginCalculation = calculateSourcingMargin(order, productCostTotal);
    const marketLabel = MARKET_LABELS[order.marketType];
    const progressViewMeta = getSourcingProgressViewMeta(order)
        ?? getSourcingProgressViewMeta({ sourcingProgressStage: "PAYMENT_WAITING" });

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className={cn("max-h-[92vh] overflow-hidden p-0", showPaymentPage ? "max-w-[1280px]" : "max-w-[1440px]")}
                onPointerDownOutside={(event) => event.preventDefault()}
            >
                <DialogHeader className="border-b px-6 py-5">
                    <DialogTitle className="text-xl">
                        {!showPaymentPage
                            ? "소싱하기"
                            : mode === "progress"
                                ? progressViewMeta?.label ?? "소싱 진행"
                                : purchaseStep === "forwarder"
                                ? "배대지 선택"
                                : purchaseStep === "waiting"
                                    ? "결제대기"
                                    : "소싱라이프 결제"}
                    </DialogTitle>
                    {!showPaymentPage && (
                        <DialogDescription className="mt-2">
                            {mode === "match-only"
                                ? "후보 상품과 옵션을 선택하면 주문확인까지 처리하고 상품준비로 이동합니다."
                                : "상품과 옵션을 선택한 뒤 배대지를 지정하고 결제대기 상태로 전환합니다."}
                        </DialogDescription>
                    )}
                </DialogHeader>

                {showPaymentPage ? (
                    <div className="max-h-[calc(92vh-88px)] overflow-auto bg-white">
                        <div className="border-b px-6 py-3">
                            <button type="button" className="text-sm font-medium text-slate-500 hover:text-slate-900" onClick={() => (purchaseStep === "payment" ? setPurchaseStep("waiting") : purchaseStep === "waiting" ? handleOpenChange(false) : setShowPaymentPage(false))}>
                                ← 이전으로
                            </button>
                        </div>

                        {purchaseStep === "waiting" ? (
                            <SourcingProgressView
                                order={order}
                                meta={progressViewMeta!}
                                productName={order.sourcingLifeMatch?.productName ?? selectedMatch.productName}
                                productThumbnail={order.sourcingLifeMatch?.thumbnail ?? selectedMatch.thumbnail}
                                optionName={order.sourcingLifeMatch?.optionName ?? selectedOption.label}
                                quantity={order.sourcingLifeMatch?.quantity ?? quantity}
                                amount={order.sourcingLifeActualPayment?.amount ?? order.sourcingLifeMatch?.estimatedCost ?? productCostTotal}
                                forwarder={selectedForwarder}
                                messages={chatMessages}
                                chatDraft={chatDraft}
                                onChatDraftChange={setChatDraft}
                                onSendChat={sendChatMessage}
                                onPay={progressViewMeta?.stage === "PAYMENT_WAITING" && order.status === "PREPARING" ? () => setPurchaseStep("payment") : undefined}
                                onClose={() => handleOpenChange(false)}
                            />
                        ) : (
                        <div className="grid min-h-[680px] grid-cols-1 gap-6 p-6 xl:grid-cols-[1fr_320px]">
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

                                {purchaseStep === "forwarder" && (
                                    <MarginAnalysis calculation={marginCalculation} marketLabel={marketLabel} wide />
                                )}

                                {purchaseStep === "forwarder" ? (
                                    <div className="space-y-5">
                                        <div>
                                            <h3 className="text-lg font-bold text-slate-950">입고할 배대지를 선택하세요</h3>
                                            <p className="mt-1 text-sm text-slate-500">소싱라이프에 등록된 중국 수령지 중 하나를 선택합니다. 신규 창고 등록이나 관리는 이 화면에서 하지 않습니다.</p>
                                        </div>
                                        <div className="grid gap-3 lg:grid-cols-3">
                                            {forwarderProfiles.map((profile) => {
                                                const selected = profile.code === selectedForwarder.code;
                                                return (
                                                    <button
                                                        key={profile.code}
                                                        type="button"
                                                        className={cn(
                                                            "rounded-xl border p-4 text-left transition hover:border-orange-300 hover:bg-orange-50/40",
                                                            selected && "border-orange-500 bg-orange-50 ring-2 ring-orange-100",
                                                        )}
                                                        onClick={() => setSelectedForwarderCode(profile.code)}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", selected ? "bg-orange-600 text-white" : "bg-slate-100 text-slate-500")}>
                                                                <Warehouse className="h-4 w-4" />
                                                            </span>
                                                            <div>
                                                                <div className="text-sm font-bold text-slate-950">{profile.name}</div>
                                                                <div className="mt-0.5 text-[11px] text-slate-500">코드 {profile.code}</div>
                                                            </div>
                                                        </div>
                                                        <div className="mt-4 space-y-1 text-xs leading-5 text-slate-600">
                                                            <div>{profile.receiverName} · {profile.phone}</div>
                                                            <div>{profile.province}</div>
                                                            <div>{profile.address1}</div>
                                                            <div className="font-semibold text-slate-900">사서함 {profile.address2}</div>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                                            구매대행 신청 후 주문은 결제되지 않고 <strong>결제대기</strong>에 머뭅니다. 견적과 상담 내용을 확인한 뒤 별도의 `결제하기` 단계에서 결제합니다.
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
                                calculation={marginCalculation}
                                marketLabel={marketLabel}
                                costOnly={purchaseStep === "forwarder"}
                                primaryLabel={purchaseStep === "forwarder" ? "구매대행 신청" : "결제 완료"}
                                onPrimaryClick={purchaseStep === "forwarder" ? createPaymentWait : completePayment}
                                onCancel={() => setShowPaymentPage(false)}
                            />
                        </div>
                        )}
                    </div>
                ) : (
                    <div className="grid max-h-[calc(92vh-88px)] grid-cols-1 overflow-hidden lg:grid-cols-[240px_minmax(0,1fr)_320px] xl:grid-cols-[260px_minmax(0,1fr)_340px] 2xl:grid-cols-[280px_minmax(0,1fr)_360px]">
                    <aside className="border-r bg-slate-50 p-5">
                        <h3 className="font-semibold text-slate-950">현재 주문</h3>
                        <div className="mt-4 flex gap-3">
                            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border bg-white">
                                <Image src={order.product.thumbnail} alt={order.product.name} fill sizes="80px" className="object-cover" />
                            </div>
                            <div className="min-w-0">
                                <div className="line-clamp-3 text-sm font-semibold leading-snug">{order.product.name}</div>
                                <div className="mt-2 text-xs text-slate-500">{order.product.optionName}</div>
                                <div className="mt-1.5 inline-flex rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                                    {marketLabel} 주문
                                </div>
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
                        <div className="mb-4 space-y-3">
                            <h3 className="font-semibold">추천 소싱 상품</h3>
                            <div>
                                <div className="flex gap-2">
                                <Input
                                    value={searchQuery}
                                    onChange={(event) => {
                                        setSearchQuery(event.target.value);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") handleFindCandidate();
                                    }}
                                    placeholder="키워드 또는 타오바오/소싱라이프 상품 URL 입력"
                                    className="h-9 bg-white"
                                />
                                <Button type="button" className="h-9 shrink-0" disabled={!searchQuery.trim() || Boolean(searchError)} onClick={handleFindCandidate}>
                                    찾기
                                </Button>
                                </div>
                                {searchError && <div className="mt-1 text-xs font-medium text-red-600">{searchError}</div>}
                            </div>
                        </div>

                        <div className="grid auto-rows-fr grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
                            {displayedCandidates.map((candidate) => (
                                <article
                                    key={candidate.id}
                                    className={cn(
                                        "flex h-full min-w-0 flex-col overflow-hidden rounded-md border bg-white transition hover:border-slate-300 hover:shadow-sm",
                                        selectedMatch.id === candidate.id && "border-orange-500 ring-2 ring-orange-100",
                                    )}
                                >
                                    <button
                                        type="button"
                                        className="flex min-h-[108px] w-full flex-1 gap-3 p-3 text-left"
                                        onClick={() => handleSelectMatch(candidate)}
                                    >
                                        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded border bg-white">
                                            <Image src={candidate.thumbnail} alt={candidate.productName} fill sizes="80px" className="object-cover" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="line-clamp-2 text-sm font-semibold leading-5 text-slate-950">{candidate.productName}</div>
                                            <div className="mt-0.5 line-clamp-1 text-xs text-slate-600">{candidate.productNameZh}</div>
                                            <div className="mt-1 truncate text-xs text-slate-500">{candidate.sellerName}</div>
                                        </div>
                                    </button>

                                    <CandidateOptionControls
                                        candidate={candidate}
                                        option={candidate.options.find((option) => option.id === candidateOptionIds[candidate.id]) ?? candidate.options[0]}
                                        quantity={Math.max(1, Math.min(
                                            candidateQuantities[candidate.id] ?? order.product.quantity,
                                            Math.max(1, (candidate.options.find((option) => option.id === candidateOptionIds[candidate.id]) ?? candidate.options[0]).stock),
                                        ))}
                                        onSelectOption={(option) => handleSelectOption(candidate, option)}
                                        onDecrease={(option) => changeCandidateQuantity(candidate, option, -1)}
                                        onIncrease={(option) => changeCandidateQuantity(candidate, option, 1)}
                                    />
                                </article>
                            ))}
                        </div>
                    </section>

                    <aside className="overflow-y-auto border-l bg-white p-5">
                        <h3 className="font-semibold">선택 상품</h3>
                        <div className="mt-4 rounded-lg border bg-slate-50 p-4">
                            <div className="flex items-start gap-3">
                                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-white shadow-sm">
                                    <Image src={selectedMatch.thumbnail} alt={selectedMatch.productName} fill sizes="64px" className="object-cover" />
                                </div>
                                <div className="min-w-0 pt-0.5">
                                    <div className="line-clamp-3 text-sm font-bold leading-5 text-slate-950">{selectedMatch.productName}</div>
                                </div>
                            </div>
                            <Separator className="my-4" />
                            <div className="space-y-2">
                                <Select
                                    value={selectedOption.id}
                                    onValueChange={(optionId) => {
                                        const option = selectedMatch.options.find((item) => item.id === optionId);
                                        if (option) handleSelectOption(selectedMatch, option);
                                    }}
                                >
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
                                <CostAndMarginBreakdown
                                    amountCny={selectedOption.priceCny * quantity}
                                    calculation={marginCalculation}
                                    marketLabel={marketLabel}
                                />
                            </div>
                        </div>

                        {mode === "match-only" ? (
                            <div className="mt-4 grid gap-2">
                                <Button className="h-11 w-full bg-orange-600 hover:bg-orange-700" onClick={saveMatch}>
                                    주문확인
                                </Button>
                                {order.marketDeliveryMethod !== "DIRECT_DELIVERY" ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-11 w-full border-red-200 bg-white text-red-600 shadow-none hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                                        onClick={() => onRequestCancel?.(order)}
                                    >
                                        주문취소
                                    </Button>
                                ) : null}
                            </div>
                        ) : (
                            <Button
                                className="mt-4 h-11 w-full bg-orange-600 hover:bg-orange-700"
                                disabled={!hasRequiredInfo || isSelectedOptionSoldOut}
                                onClick={() => {
                                    setPurchaseStep("forwarder");
                                    setShowPaymentPage(true);
                                }}
                            >
                                배대지 선택
                            </Button>
                        )}
                    </aside>
                </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function CandidateOptionControls({
    candidate,
    option,
    quantity,
    onSelectOption,
    onDecrease,
    onIncrease,
}: {
    candidate: SourcingMatchCandidate;
    option: SourcingOption;
    quantity: number;
    onSelectOption: (option: SourcingOption) => void;
    onDecrease: (option: SourcingOption) => void;
    onIncrease: (option: SourcingOption) => void;
}) {
    const isSoldOut = option.stock <= 0;

    return (
        <div className="mt-auto space-y-3 border-t bg-slate-50/70 px-3 py-3">
            <div>
                <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                    <span>옵션 선택</span>
                    <span>{candidate.options.length}개 옵션</span>
                </div>
                <Select
                    value={option.id}
                    onValueChange={(optionId) => {
                        const nextOption = candidate.options.find((item) => item.id === optionId);
                        if (nextOption) onSelectOption(nextOption);
                    }}
                >
                    <SelectTrigger className="h-auto min-h-12 w-full bg-white py-2 text-left">
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-slate-900">
                                {option.label}{isSoldOut ? " · 품절" : ""}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-slate-500">{option.labelZh}</span>
                        </span>
                    </SelectTrigger>
                    <SelectContent className="max-h-72" position="popper" side="bottom" align="start" avoidCollisions={false}>
                        {candidate.options.map((item) => (
                            <SelectItem key={item.id} value={item.id} className="py-2">
                                <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3">
                                    <span className="min-w-0">
                                        <span className="block truncate text-xs font-semibold text-slate-900">
                                            {item.label}{item.stock <= 0 ? " · 품절" : ""}
                                        </span>
                                        <span className="mt-0.5 block truncate text-[11px] text-slate-500">{item.labelZh}</span>
                                    </span>
                                    <span className="text-right text-[11px] text-slate-500">
                                        <span className="block font-semibold text-slate-800">{item.priceKrw.toLocaleString()}원</span>
                                        <span className={cn(item.stock <= 0 && "text-red-600")}>{item.stock <= 0 ? "품절" : `재고 ${item.stock}`}</span>
                                    </span>
                                </span>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-[10px] font-medium text-slate-500">옵션가격(재고)</div>
                    <div className="mt-0.5 flex items-baseline gap-1 whitespace-nowrap">
                        <span className="text-xs font-bold tabular-nums text-slate-900">{option.priceKrw.toLocaleString()}원</span>
                        <span className={cn("text-[10px]", isSoldOut ? "font-semibold text-red-600" : "text-slate-500")}>
                            ({isSoldOut ? "품절" : `${option.stock}개`})
                        </span>
                    </div>
                </div>
                <div className="flex h-8 shrink-0 items-center rounded-md border bg-white shadow-sm">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`${candidate.productName} 수량 감소`}
                        className="h-8 w-8 rounded-r-none px-0"
                        disabled={isSoldOut || quantity <= 1}
                        onClick={() => onDecrease(option)}
                    >
                        -
                    </Button>
                    <div className="w-9 text-center text-xs font-bold tabular-nums">{quantity}</div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`${candidate.productName} 수량 증가`}
                        className="h-8 w-8 rounded-l-none px-0"
                        disabled={isSoldOut || quantity >= option.stock}
                        onClick={() => onIncrease(option)}
                    >
                        +
                    </Button>
                </div>
            </div>
        </div>
    );
}

function SourcingProgressView({
    order,
    meta,
    productName,
    productThumbnail,
    optionName,
    quantity,
    amount,
    forwarder,
    messages,
    chatDraft,
    onChatDraftChange,
    onSendChat,
    onPay,
    onClose,
}: {
    order: Order;
    meta: SourcingProgressViewMeta;
    productName: string;
    productThumbnail: string;
    optionName: string;
    quantity: number;
    amount: number;
    forwarder: ForwarderProfile;
    messages: SourcingChatMessage[];
    chatDraft: string;
    onChatDraftChange: (value: string) => void;
    onSendChat: () => void;
    onPay?: () => void;
    onClose: () => void;
}) {
    const stageTones: Partial<Record<SourcingProgressViewMeta["stage"], string>> = {
        PAYMENT_WAITING: "border-amber-200 from-amber-50",
        SOURCED: "border-emerald-200 from-emerald-50",
        DELIVERED: "border-slate-200 from-slate-100",
    };
    const badgeTones: Partial<Record<SourcingProgressViewMeta["stage"], string>> = {
        PAYMENT_WAITING: "bg-amber-100 text-amber-800",
        SOURCED: "bg-emerald-100 text-emerald-800",
        DELIVERED: "bg-slate-200 text-slate-700",
    };
    const stageTone = stageTones[meta.stage] ?? "border-slate-200 from-slate-50";
    const badgeTone = badgeTones[meta.stage] ?? "bg-slate-100 text-slate-700";
    const timelineAt = meta.stage === "PAYMENT_WAITING"
        ? order.sourcingPaymentRequestedAt
        : order.sourcingLifeActualPayment?.paidAt ?? order.sourcingLifeSyncedAt;
    const paymentCompleted = meta.stage !== "PAYMENT_WAITING";

    return (
        <div className="grid min-h-[680px] grid-cols-1 bg-slate-50/60 xl:grid-cols-[minmax(0,1fr)_360px]">
            <main className="p-6 lg:p-8">
                <div className="mx-auto max-w-3xl space-y-5">
                    <div className={cn("rounded-2xl border bg-gradient-to-br to-white p-6 shadow-sm", stageTone)}>
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <div className={cn("inline-flex rounded-full px-3 py-1 text-xs font-bold", badgeTone)}>{meta.label}</div>
                                <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-950">{meta.title}</h3>
                                <p className="mt-2 text-sm leading-6 text-slate-600">{meta.description}</p>
                            </div>
                            <div className="rounded-xl bg-white px-4 py-3 text-right shadow-sm ring-1 ring-slate-200">
                                <div className="text-[11px] font-semibold text-slate-500">{meta.stage === "PAYMENT_WAITING" ? "결제 예정금액" : "결제금액"}</div>
                                <div className="mt-1 text-xl font-black text-slate-950">{amount.toLocaleString()}원</div>
                            </div>
                        </div>
                    </div>

                    {paymentCompleted ? (
                        <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/70 px-5 py-4">
                                <div>
                                    <div className="text-sm font-black text-emerald-950">결제 및 타오바오 주문 처리</div>
                                    <div className="mt-1 text-xs text-emerald-700">결제완료 이후 기록은 배송 단계가 변경되어도 계속 조회할 수 있습니다.</div>
                                </div>
                                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">
                                    <CheckCircle2 className="h-3.5 w-3.5" /> 처리 완료
                                </div>
                            </div>
                            <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                                <div className="p-5">
                                    <CreditCard className="h-5 w-5 text-emerald-600" />
                                    <div className="mt-3 text-[11px] font-semibold text-slate-500">결제완료</div>
                                    <div className="mt-1 font-black text-slate-950">{amount.toLocaleString()}원</div>
                                    <div className="mt-1 text-[11px] text-slate-500">{order.sourcingLifeActualPayment?.paidAt ?? timelineAt ?? "완료시간 확인 중"}</div>
                                </div>
                                <div className="p-5">
                                    <Warehouse className="h-5 w-5 text-sky-600" />
                                    <div className="mt-3 text-[11px] font-semibold text-slate-500">배송대행지 자동입력</div>
                                    <div className="mt-1 font-black text-slate-950">입력 완료</div>
                                    <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{order.sourcingForwarder?.name ?? forwarder.name}</div>
                                </div>
                                <div className="p-5">
                                    <PackageCheck className="h-5 w-5 text-indigo-600" />
                                    <div className="mt-3 text-[11px] font-semibold text-slate-500">소싱라이프 주문번호</div>
                                    <div className="mt-1 break-all font-mono text-sm font-black text-slate-950">{order.sourcingLifeOrderId ?? "생성 중"}</div>
                                    <div className="mt-1 text-[11px] text-slate-500">{meta.stage === "SOURCED" ? "중국 판매자 발송대기" : meta.label}</div>
                                </div>
                            </div>
                        </section>
                    ) : null}

                    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                        <div className="border-b px-5 py-4"><h4 className="font-bold text-slate-950">신청 상품</h4></div>
                        <div className="flex gap-4 p-5">
                            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border bg-slate-50">
                                <Image src={productThumbnail} alt={productName} fill sizes="80px" className="object-cover" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="text-sm font-bold text-slate-950">{productName}</div>
                                <div className="mt-1 text-xs text-slate-500">{optionName} · 수량 {quantity}개</div>
                                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                    <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">마켓 주문 {order.marketOrderId}</span>
                                    {order.sourcingLifeOrderId ? <span className="rounded-md bg-emerald-50 px-2 py-1 font-mono text-emerald-700">소싱 주문 {order.sourcingLifeOrderId}</span> : null}
                                    <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{meta.stage === "PAYMENT_WAITING" ? "신청" : "갱신"} {timelineAt ?? "확인 중"}</span>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-2xl border bg-white p-5 shadow-sm">
                        <div className="flex items-start gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white"><Warehouse className="h-5 w-5" /></span>
                            <div>
                                <div className="text-xs font-semibold text-slate-500">선택 배대지</div>
                                <div className="mt-1 font-bold text-slate-950">{forwarder.name}</div>
                                <div className="mt-2 text-sm leading-6 text-slate-600">{forwarder.province} {forwarder.address1} {forwarder.address2}</div>
                                <div className="mt-1 text-xs text-slate-500">{forwarder.receiverName} · {forwarder.phone}</div>
                            </div>
                        </div>
                    </section>

                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={onClose}>목록으로</Button>
                        {onPay ? <Button className="bg-slate-950 px-6 hover:bg-slate-800" onClick={onPay}>결제하기</Button> : null}
                    </div>
                </div>
            </main>

            <aside className="flex min-h-[680px] flex-col border-l bg-white">
                <div className="flex items-center gap-3 border-b px-5 py-4">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><MessageCircle className="h-4 w-4" /></span>
                    <div>
                        <div className="text-sm font-bold text-slate-950">소싱라이프 상담</div>
                        <div className="text-[11px] text-emerald-600">{meta.stage === "PAYMENT_WAITING" ? "결제 전 문의 가능" : `${meta.label} 상담 가능`}</div>
                    </div>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-4">
                    {messages.map((message) => (
                        <div key={message.id} className={cn("flex", message.sender === "operator" ? "justify-end" : "justify-start")}>
                            <div className={cn(
                                "max-w-[88%] rounded-2xl px-3.5 py-3 text-sm leading-5 shadow-sm",
                                message.sender === "operator" ? "rounded-br-md bg-slate-900 text-white" : "rounded-bl-md border bg-white text-slate-700",
                            )}>
                                <div>{message.message}</div>
                                <div className={cn("mt-1 text-[10px]", message.sender === "operator" ? "text-slate-300" : "text-slate-400")}>{message.sentAt}</div>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="border-t p-4">
                    <Textarea
                        value={chatDraft}
                        onChange={(event) => onChatDraftChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                onSendChat();
                            }
                        }}
                        placeholder="상품, 가격, 배송 관련 문의를 입력하세요"
                        className="min-h-24 resize-none bg-white"
                    />
                    <Button className="mt-2 w-full bg-emerald-600 hover:bg-emerald-700" disabled={!chatDraft.trim()} onClick={onSendChat}>
                        <Send className="mr-2 h-4 w-4" /> 문의 보내기
                    </Button>
                    <p className="mt-2 text-[10px] leading-4 text-slate-400">개인통관부호·결제정보 등 민감정보는 채팅에 입력하지 마세요.</p>
                </div>
            </aside>
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
    calculation,
    marketLabel,
    costOnly,
    primaryLabel,
    onPrimaryClick,
    onCancel,
}: {
    amountCny: number;
    calculation: SourcingMarginCalculation;
    marketLabel: string;
    costOnly: boolean;
    primaryLabel: string;
    onPrimaryClick: () => void;
    onCancel: () => void;
}) {
    return (
        <aside className="h-fit rounded-3xl border bg-white p-5 shadow-sm">
            {costOnly ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-5 text-center ring-1 ring-slate-200/70">
                    <div className="text-xs font-bold text-slate-500">소싱 총비용</div>
                    <div className="mt-2 text-2xl font-black tracking-tight text-slate-950">₩{calculation.sourcingTotalCost.toLocaleString()}</div>
                </div>
            ) : (
                <CostAndMarginBreakdown amountCny={amountCny} calculation={calculation} marketLabel={marketLabel} />
            )}
            <Button className="mt-6 h-10 w-full rounded-full bg-[#ff8f80] font-bold hover:bg-[#ff7b6b]" onClick={onPrimaryClick}>
                {primaryLabel}
            </Button>
            <Button variant="outline" className="mt-2 h-10 w-full rounded-full" onClick={onCancel}>
                취소
            </Button>
        </aside>
    );
}

function CostAndMarginBreakdown({
    amountCny,
    calculation,
    marketLabel,
}: {
    amountCny: number;
    calculation: SourcingMarginCalculation;
    marketLabel: string;
}) {
    return (
        <div className="space-y-5 text-sm">
            <CostBreakdown amountCny={amountCny} calculation={calculation} />
            <MarginAnalysis calculation={calculation} marketLabel={marketLabel} />
        </div>
    );
}

function CostBreakdown({ amountCny, calculation }: { amountCny: number; calculation: SourcingMarginCalculation }) {
    return (
        <section>
            <h4 className="mb-3 text-xs font-black tracking-tight text-slate-950">비용 구성</h4>
            <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                    <span className="text-slate-500">상품 금액</span>
                    <span className="text-right font-bold">₩{calculation.productCost.toLocaleString()}<span className="block text-[10px] font-medium text-slate-400">(¥{amountCny.toLocaleString()})</span></span>
                </div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">소싱처 이용료</span><span className="font-semibold">₩{calculation.sourcingServiceFee.toLocaleString()}</span></div>
                <div className="flex justify-between gap-3"><span className="text-slate-500">통화 환전 수수료</span><span className="font-semibold">₩{calculation.currencyExchangeFee.toLocaleString()}</span></div>
                <div className="flex justify-between border-t pt-3"><span className="font-bold text-slate-900">소싱 총비용</span><span className="font-black text-slate-950">₩{calculation.sourcingTotalCost.toLocaleString()}</span></div>
            </div>
        </section>
    );
}

function MarginAnalysis({
    calculation,
    marketLabel,
    wide = false,
}: {
    calculation: SourcingMarginCalculation;
    marketLabel: string;
    wide?: boolean;
}) {
    const marginColor = calculation.expectedMargin >= 0 ? "text-emerald-700" : "text-red-600";

    return (
        <section className={cn("rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200/70", wide && "p-5")}>
            <h4 className={cn("mb-3 text-xs font-black tracking-tight text-slate-950", wide && "text-sm")}>마진 분석</h4>
            <div className={cn("space-y-2.5", wide && "grid grid-cols-2 gap-x-8 gap-y-2.5 space-y-0")}>
                <div className="flex items-start justify-between gap-3"><span className="font-semibold text-slate-700">결제 금액</span><span className="font-bold">₩{calculation.marketPaymentAmount.toLocaleString()}</span></div>
                <div className="flex justify-between gap-3 text-xs text-slate-500"><span>- {marketLabel} 판매 수수료</span><span>-₩{calculation.marketFee.toLocaleString()}</span></div>
                <div className="flex justify-between gap-3 text-xs text-slate-500"><span>- 소싱 상품 금액</span><span>-₩{calculation.productCost.toLocaleString()}</span></div>
                <div className="flex justify-between gap-3 text-xs text-slate-500"><span>- 소싱처 이용료</span><span>-₩{calculation.sourcingServiceFee.toLocaleString()}</span></div>
                <div className="flex justify-between gap-3 text-xs text-slate-500"><span>- 통화 환전 수수료</span><span>-₩{calculation.currencyExchangeFee.toLocaleString()}</span></div>
                <div className="flex justify-between gap-3 text-xs text-slate-500"><span>- 배송대행지 운임료 <span className="text-[10px]">(예상)</span></span><span>-₩{calculation.estimatedForwarderShippingFee.toLocaleString()}</span></div>
            </div>
            <div className={cn("mt-3 border-t border-slate-200 pt-3", wide && "grid grid-cols-2 gap-8")}>
                <div className="flex justify-between"><span className="font-black text-slate-950">예상 순이익</span><span className={cn("text-base font-black", marginColor)}>{calculation.expectedMargin < 0 ? "-" : ""}₩{Math.abs(calculation.expectedMargin).toLocaleString()}</span></div>
                <div className="mt-1 flex justify-between sm:mt-0"><span className="text-xs font-semibold text-slate-500">마진율</span><span className={cn("font-black", marginColor)}>{calculation.expectedMarginRate.toFixed(1)}%</span></div>
            </div>
        </section>
    );
}
