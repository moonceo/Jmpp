"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { CheckCircle2, CreditCard, MessageCircle, PackageCheck, Send, Warehouse } from "lucide-react";
import { SourcingRefundDialog } from "@/components/orders/sourcing-refund-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MARKET_LABELS } from "@/lib/constants/orders";
import { forwarderProfiles, getSourcingCandidates, type ForwarderProfile, type SourcingMatchCandidate, type SourcingOption } from "@/lib/mock-data/sourcing-life";
import { getSourcingProgressViewMeta, type SourcingProgressViewMeta } from "@/lib/sourcing-progress";
import {
    getSourcingRefundAvailability,
    isSourcingRefundActive,
    type SourcingReturnLogisticsDraft,
} from "@/lib/sourcing-refund";
import { cn } from "@/lib/utils";
import { Order, SourcingForwarderSelection, SourcingLifeMatch, SourcingRefundDraft } from "@/types/order";

interface SourcingWorkflowDialogProps {
    order: Order | null;
    open: boolean;
    mode: "match-only" | "payment" | "progress";
    onOpenChange: (open: boolean) => void;
    onConfirmMatch?: (order: Order, match: SourcingLifeMatch) => void;
    onRequestCancel?: (order: Order) => void;
    onCreatePaymentWait?: (order: Order, match: SourcingLifeMatch, forwarder: SourcingForwarderSelection) => void;
    onCompletePayment?: (order: Order, match: SourcingLifeMatch) => boolean;
    onRequestSourcingRefund?: (order: Order, draft: SourcingRefundDraft) => boolean | Promise<boolean>;
    onAdvanceSourcingRefund?: (order: Order) => void;
    onSubmitSourcingReturnLogistics?: (order: Order, draft: SourcingReturnLogisticsDraft) => boolean;
}

interface ChinaSellerChatMessage {
    id: string;
    sender: "operator" | "china-seller";
    message: string;
    sentAt: string;
}

export type PriceNegotiationStatus = "IDLE" | "REQUESTED";
export type PriceNegotiationAction = "REQUEST" | "CANCEL";

export interface PriceNegotiationTransition {
    status: PriceNegotiationStatus;
    message: string;
    sentAt: string;
}

export function canProceedToPayment(status: PriceNegotiationStatus): boolean {
    return status !== "REQUESTED";
}

export function getSourcingRefundActionLabel(order: Pick<Order, "sourcingRefund">): string {
    if (!order.sourcingRefund) return "반품·환불 신청";
    return isSourcingRefundActive(order.sourcingRefund) ? "환불 진행" : "환불 내역";
}

export function transitionPriceNegotiation(
    status: PriceNegotiationStatus,
    action: PriceNegotiationAction,
): PriceNegotiationTransition | undefined {
    if (action === "REQUEST" && status === "IDLE") {
        return {
            status: "REQUESTED",
            message: "가격을 조금 낮춰주실 수 있을까요?",
            sentAt: "깎아줘 요청",
        };
    }

    if (action === "CANCEL" && status === "REQUESTED") {
        return {
            status: "IDLE",
            message: "가격 인하 요청을 취소합니다.",
            sentAt: "깎아줘 취소",
        };
    }

    return undefined;
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

export function buildSavedSourcingCandidate(
    order: Order,
    fallback: SourcingMatchCandidate | undefined,
): SourcingMatchCandidate | undefined {
    const savedMatch = order.sourcingLifeMatch;
    const fallbackOption = fallback?.options[0];
    if (!savedMatch?.candidateId || !fallback || !fallbackOption) return undefined;

    const quantity = Math.max(1, savedMatch.quantity ?? order.product.quantity);
    const savedTotalAmount = order.sourcingLifeActualPayment?.amount ?? order.expectedCost;
    const priceKrw = Math.max(
        0,
        savedMatch.estimatedCost
            ?? (savedTotalAmount !== undefined ? Math.round(savedTotalAmount / quantity) : fallbackOption.priceKrw),
    );
    const fallbackExchangeRate = fallbackOption.priceCny > 0
        ? fallbackOption.priceKrw / fallbackOption.priceCny
        : 0;
    const priceCny = fallbackExchangeRate > 0
        ? Number((priceKrw / fallbackExchangeRate).toFixed(2))
        : fallbackOption.priceCny;

    return {
        ...fallback,
        id: savedMatch.candidateId,
        productId: savedMatch.productId ?? fallback.productId,
        productName: savedMatch.productName ?? order.product.name,
        thumbnail: savedMatch.thumbnail ?? order.product.thumbnail,
        matchRate: savedMatch.matchRate ?? fallback.matchRate,
        priceCny,
        priceKrw,
        options: [{
            ...fallbackOption,
            id: savedMatch.optionId ?? `${savedMatch.candidateId}-saved-option`,
            label: savedMatch.optionName ?? order.product.optionName,
            priceCny,
            priceKrw,
            stock: Math.max(fallbackOption.stock, quantity),
        }],
    };
}

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
    onRequestSourcingRefund,
    onAdvanceSourcingRefund,
    onSubmitSourcingReturnLogistics,
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
    const displayedCandidates = useMemo(() => {
        const availableCandidates = [...addedCandidates, ...candidates];
        const savedCandidateId = order?.sourcingLifeMatch?.candidateId;
        if (!order || !savedCandidateId || availableCandidates.some((candidate) => candidate.id === savedCandidateId)) {
            return availableCandidates;
        }

        const savedCandidate = buildSavedSourcingCandidate(order, candidates[0]);
        return savedCandidate ? [savedCandidate, ...availableCandidates] : availableCandidates;
    }, [addedCandidates, candidates, order]);

    const selectedMatch = displayedCandidates.find((candidate) => candidate.id === selectedMatchId) ?? displayedCandidates[0];
    const selectedOptionId = selectedMatch ? candidateOptionIds[selectedMatch.id] : undefined;
    const selectedOption = selectedMatch?.options.find((option) => option.id === selectedOptionId) ?? selectedMatch?.options[0];
    const startsInPaymentWaiting = order?.sourcingLifeSyncStatus === "PAYMENT_READY";
    const startsInProgressView = startsInPaymentWaiting || mode === "progress";
    const [showPaymentPage, setShowPaymentPage] = useState(startsInProgressView);
    const [purchaseStep, setPurchaseStep] = useState<"forwarder" | "waiting" | "payment">(startsInProgressView ? "waiting" : "forwarder");
    const [paymentMethod, setPaymentMethod] = useState<"homespay" | "general">("homespay");
    const [selectedForwarderCode, setSelectedForwarderCode] = useState(order?.sourcingForwarder?.code ?? forwarderProfiles[0].code);
    const [chatDraft, setChatDraft] = useState("");
    const [sourcingRefundOpen, setSourcingRefundOpen] = useState(false);
    const [priceNegotiationStatus, setPriceNegotiationStatus] = useState<PriceNegotiationStatus>("IDLE");
    const [chatMessages, setChatMessages] = useState<ChinaSellerChatMessage[]>([
        {
            id: "welcome",
            sender: "china-seller",
            message: mode === "progress" && !startsInPaymentWaiting
                ? "결제가 완료되었습니다. 상품 준비, 중국 내 발송 또는 판매자 확인이 필요한 내용을 남겨주세요."
                : "구매대행 신청이 접수되었습니다. 상품 가격, 재고와 중국 내 배송 조건을 확인할 내용을 남겨주세요.",
            sentAt: "판매자 안내",
        },
    ]);
    if (!order || !selectedMatch || !selectedOption) return null;

    const sourcingRefundAvailability = getSourcingRefundAvailability(order);
    const canOpenSourcingRefund = mode === "progress"
        && sourcingRefundAvailability.canOpen
        && Boolean(onRequestSourcingRefund && onAdvanceSourcingRefund && onSubmitSourcingReturnLogistics);
    const sourcingRefundActionLabel = getSourcingRefundActionLabel(order);

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

    const handlePriceNegotiation = (action: PriceNegotiationAction) => {
        const transition = transitionPriceNegotiation(priceNegotiationStatus, action);
        if (!transition) return;

        setPriceNegotiationStatus(transition.status);
        setChatMessages((current) => [...current, {
            id: `${order.id}-negotiation-${current.length + 1}`,
            sender: "operator",
            message: transition.message,
            sentAt: transition.sentAt,
        }]);
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) {
            setShowPaymentPage(false);
            setPurchaseStep("forwarder");
            setSearchQuery("");
            setSourcingRefundOpen(false);
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
    const isPaymentConversationView = showPaymentPage && purchaseStep === "waiting";
    const dialogTitle = !showPaymentPage
        ? mode === "match-only" ? "매칭하기" : "소싱하기"
        : isPaymentConversationView
            ? "소싱상품관리"
            : purchaseStep === "forwarder"
                ? "배대지 선택"
                : "소싱라이프 결제";
    const dialogDescription = !showPaymentPage
        ? mode === "match-only"
            ? "후보 상품과 옵션을 선택하면 주문확인까지 처리하고 상품준비로 이동합니다."
            : "상품과 옵션을 선택한 뒤 배대지를 지정하고 결제대기 상태로 전환합니다."
        : isPaymentConversationView
            ? "소싱상품관리에서 결제대기부터 결제완료까지 같은 중국 판매자 채팅을 이어서 확인합니다."
            : purchaseStep === "forwarder"
                ? "구매대행 신청에 사용할 배송대행지 수령 프로필을 선택합니다."
                : "최종 결제금액과 약관, 결제수단을 확인합니다.";
    const progressAmount = order.sourcingLifeActualPayment?.amount
        ?? (order.sourcingLifeMatch?.estimatedCost ?? selectedOption.priceKrw)
            * (order.sourcingLifeMatch?.quantity ?? quantity);

    return (
        <>
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className={cn("max-h-[92vh] gap-0 overflow-hidden p-0", showPaymentPage ? "sm:max-w-[1280px]" : "sm:max-w-[1440px]")}
                onPointerDownOutside={(event) => event.preventDefault()}
            >
                <DialogHeader className="border-b px-5 py-4 pr-12 sm:px-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <DialogTitle className="text-xl">{dialogTitle}</DialogTitle>
                            <DialogDescription className="mt-1.5">{dialogDescription}</DialogDescription>
                        </div>
                        {isPaymentConversationView && progressViewMeta ? (
                            <div className="flex items-center gap-2 pr-2">
                                <Badge variant="outline" className="h-7 rounded-full px-3 text-xs font-bold">
                                    {progressViewMeta.label}
                                </Badge>
                                <span className="text-xs text-muted-foreground">{order.marketOrderId}</span>
                            </div>
                        ) : null}
                    </div>
                </DialogHeader>

                {showPaymentPage ? (
                    <div className="max-h-[calc(92vh-81px)] overflow-auto bg-card">
                        {purchaseStep !== "waiting" ? <div className="border-b px-5 py-2 sm:px-6">
                            <Button type="button" variant="ghost" size="sm" className="-ml-3 text-muted-foreground" onClick={() => (purchaseStep === "payment" ? setPurchaseStep("waiting") : setShowPaymentPage(false))}>
                                ← 이전으로
                            </Button>
                        </div> : null}

                        {purchaseStep === "waiting" ? (
                            <SourcingProgressView
                                order={order}
                                meta={progressViewMeta!}
                                productName={order.sourcingLifeMatch?.productName ?? order.product.name}
                                productThumbnail={order.sourcingLifeMatch?.thumbnail ?? order.product.thumbnail}
                                optionName={order.sourcingLifeMatch?.optionName ?? order.product.optionName}
                                quantity={order.sourcingLifeMatch?.quantity ?? order.product.quantity}
                                amount={progressAmount}
                                forwarder={selectedForwarder}
                                messages={chatMessages}
                                chatDraft={chatDraft}
                                onChatDraftChange={setChatDraft}
                                onSendChat={sendChatMessage}
                                priceNegotiationStatus={priceNegotiationStatus}
                                onRequestPriceNegotiation={() => handlePriceNegotiation("REQUEST")}
                                onCancelPriceNegotiation={() => handlePriceNegotiation("CANCEL")}
                                onPay={progressViewMeta?.stage === "PAYMENT_WAITING" && order.status === "PREPARING" ? () => setPurchaseStep("payment") : undefined}
                                onCancelOrder={progressViewMeta?.stage === "PAYMENT_WAITING" && order.status === "PREPARING" && onRequestCancel
                                    ? () => onRequestCancel(order)
                                    : undefined}
                                sourcingRefundActionLabel={canOpenSourcingRefund ? sourcingRefundActionLabel : undefined}
                                onOpenSourcingRefund={canOpenSourcingRefund ? () => setSourcingRefundOpen(true) : undefined}
                            />
                        ) : (
                        <div className="grid min-h-[680px] grid-cols-1 gap-6 p-6 xl:grid-cols-[1fr_320px]">
                            <div className="space-y-6">
                                {purchaseStep === "forwarder" ? (
                                    <div className="space-y-5">
                                        <Card className="rounded-2xl border border-border bg-card p-5" aria-labelledby="forwarder-order-product-title">
                                            <h3 id="forwarder-order-product-title" className="text-base font-black tracking-tight text-foreground">주문상품</h3>
                                            <div className="mt-4 grid gap-4 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center">
                                                <div className="relative h-[72px] w-[72px] overflow-hidden rounded-xl border bg-muted">
                                                    <Image src={order.product.thumbnail} alt={order.product.name} fill sizes="72px" className="object-cover" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-foreground">{marketLabel} 주문</span>
                                                        <span className="text-xs text-muted-foreground">{order.marketOrderId}</span>
                                                    </div>
                                                    <div className="mt-2 line-clamp-2 text-sm font-bold leading-5 text-foreground">{order.product.name}</div>
                                                    <div className="mt-1 text-xs text-muted-foreground">{order.product.optionName}</div>
                                                </div>
                                                <div className="flex gap-6 border-t pt-3 text-right sm:block sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                                                    <div>
                                                        <div className="text-xs font-semibold text-muted-foreground">주문수량</div>
                                                        <div className="mt-1 text-sm font-black text-foreground">{order.product.quantity}개</div>
                                                    </div>
                                                    <div className="sm:mt-3">
                                                        <div className="text-xs font-semibold text-muted-foreground">결제금액</div>
                                                        <div className="mt-1 text-sm font-black text-foreground">{order.paymentPrice.toLocaleString()}원</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </Card>

                                        <Card className="rounded-2xl border border-border bg-card p-5" aria-labelledby="forwarder-sourcing-product-title">
                                            <h3 id="forwarder-sourcing-product-title" className="text-base font-black tracking-tight text-foreground">소싱상품</h3>
                                            <div className="mt-4 grid gap-4 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center">
                                                <div className="relative h-[72px] w-[72px] overflow-hidden rounded-xl border bg-muted">
                                                    <Image src={selectedMatch.thumbnail} alt={selectedMatch.productName} fill sizes="72px" className="object-cover" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="line-clamp-2 text-sm font-bold leading-5 text-foreground">{selectedMatch.productName}</div>
                                                    <div className="mt-1 text-xs text-muted-foreground">{selectedOption.label}</div>
                                                </div>
                                                <div className="grid grid-cols-3 gap-4 border-t pt-3 text-right sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                                                    <div>
                                                        <div className="text-xs font-semibold text-muted-foreground">수량</div>
                                                        <div className="mt-1 text-sm font-black text-foreground">{quantity}개</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-semibold text-muted-foreground">소계(元)</div>
                                                        <div className="mt-1 whitespace-nowrap text-sm font-black text-foreground">{(selectedOption.priceCny * quantity).toLocaleString()}元</div>
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-semibold text-muted-foreground">소계(원)</div>
                                                        <div className="mt-1 whitespace-nowrap text-sm font-black text-foreground">{productCostTotal.toLocaleString()}원</div>
                                                    </div>
                                                </div>
                                            </div>
                                        </Card>

                                        <Card className="rounded-2xl border border-border bg-card p-5" aria-labelledby="forwarder-margin-title">
                                            <h3 id="forwarder-margin-title" className="text-base font-black tracking-tight text-foreground">마진분석</h3>
                                            <div className="mt-4">
                                                <MarginAnalysis calculation={marginCalculation} marketLabel={marketLabel} wide showTitle={false} />
                                            </div>
                                        </Card>

                                        <Card className="rounded-2xl border border-border bg-card p-5" aria-labelledby="forwarder-selection-title">
                                            <div>
                                                <h3 id="forwarder-selection-title" className="text-base font-black tracking-tight text-foreground">배송대행지 선택</h3>
                                                <p className="mt-1 text-sm text-muted-foreground">소싱라이프에 등록된 중국 수령지 중 하나를 선택합니다. 신규 창고 등록이나 관리는 이 화면에서 하지 않습니다.</p>
                                            </div>
                                            <div className="mt-4 grid gap-3 lg:grid-cols-3">
                                            {forwarderProfiles.map((profile) => {
                                                const selected = profile.code === selectedForwarder.code;
                                                return (
                                                    <Button
                                                        key={profile.code}
                                                        type="button"
                                                        variant="outline"
                                                        className={cn(
                                                            "block h-auto w-full whitespace-normal rounded-xl p-4 text-left transition hover:bg-muted/40",
                                                            selected && "border-border bg-muted ring-2 ring-ring",
                                                        )}
                                                        onClick={() => setSelectedForwarderCode(profile.code)}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                                                                <Warehouse className="h-4 w-4" />
                                                            </span>
                                                            <div>
                                                                <div className="text-sm font-bold text-foreground">{profile.name}</div>
                                                                <div className="mt-0.5 text-xs text-muted-foreground">코드 {profile.code}</div>
                                                            </div>
                                                        </div>
                                                        <div className="mt-4 space-y-1 text-xs leading-5 text-muted-foreground">
                                                            <div>{profile.receiverName} · {profile.phone}</div>
                                                            <div>{profile.province}</div>
                                                            <div>{profile.address1}</div>
                                                            <div className="font-semibold text-foreground">사서함 {profile.address2}</div>
                                                        </div>
                                                    </Button>
                                                );
                                            })}
                                            </div>
                                        </Card>
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-[72px_1fr_84px_120px_120px] items-center gap-4 border-b border-t bg-muted px-3 py-3 text-xs font-semibold text-muted-foreground">
                                            <div />
                                            <div className="text-center">상품명</div>
                                            <div className="text-center">총수량</div>
                                            <div className="text-center">소계(元)</div>
                                            <div className="text-center">소계(원)</div>
                                        </div>
                                        <div className="grid grid-cols-[72px_1fr_84px_120px_120px] items-center gap-4 border-b px-3 pb-4">
                                            <div className="relative h-14 w-14 overflow-hidden rounded border bg-card">
                                                <Image src={selectedMatch.thumbnail} alt={selectedMatch.productName} fill sizes="56px" className="object-cover" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-bold text-foreground">{selectedMatch.productName}</div>
                                                <div className="mt-1 truncate text-xs text-muted-foreground">{selectedOption.label}</div>
                                            </div>
                                            <div className="text-center text-sm font-bold">{quantity}</div>
                                            <div className="text-center text-sm font-bold text-foreground">{(selectedOption.priceCny * quantity).toLocaleString()}元</div>
                                            <div className="text-center text-sm font-bold text-foreground">{productCostTotal.toLocaleString()}원</div>
                                        </div>
                                        <div className="space-y-6">
                                        <section className="space-y-3">
                                            <h3 className="text-lg font-bold text-foreground">약관 동의</h3>
                                            <AgreementRow label="전체 동의" strong />
                                            <AgreementRow label="(필수) 개인정보 수집 이용동의를 확인하고 동의합니다." />
                                            <AgreementRow label="(필수) 이용약관을 확인하고 동의합니다." />
                                        </section>
                                        <section className="space-y-4">
                                            <h3 className="border-b pb-3 text-lg font-bold text-foreground">결제 정보 입력</h3>
                                            <div className="grid grid-cols-[140px_1fr] border-y">
                                                <div className="bg-muted px-4 py-4 text-xs font-semibold text-muted-foreground">결제수단 선택</div>
                                                <div className="space-y-6 px-6 py-5">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant={paymentMethod === "homespay" ? "default" : "outline"}
                                                        aria-pressed={paymentMethod === "homespay"}
                                                        onClick={() => setPaymentMethod("homespay")}
                                                    >
                                                        홈즈페이
                                                    </Button>
                                                    <div className="mx-auto flex h-32 w-52 items-center justify-center rounded-md border bg-muted text-center text-sm text-foreground">
                                                        +<br />카드·계좌 추가하기
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant={paymentMethod === "general" ? "default" : "outline"}
                                                        aria-pressed={paymentMethod === "general"}
                                                        onClick={() => setPaymentMethod("general")}
                                                    >
                                                        일반결제
                                                    </Button>
                                                    <Input placeholder="결제내역 받을 메일 입력" className="h-9 max-w-sm bg-card" />
                                                    <label className="flex items-center gap-2 text-sm text-foreground">
                                                        <Checkbox defaultChecked />
                                                        [필수] 결제 서비스 이용 약관, 개인정보 처리 동의
                                                    </label>
                                                </div>
                                            </div>
                                        </section>
                                        </div>
                                    </>
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
                    <aside className="border-r bg-muted p-5">
                        <h3 className="font-semibold text-foreground">현재 주문</h3>
                        <div className="mt-4 flex gap-3">
                            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border bg-card">
                                <Image src={order.product.thumbnail} alt={order.product.name} fill sizes="80px" className="object-cover" />
                            </div>
                            <div className="min-w-0">
                                <div className="line-clamp-3 text-sm font-semibold leading-snug">{order.product.name}</div>
                                <div className="mt-2 text-xs text-muted-foreground">{order.product.optionName}</div>
                                <div className="mt-1.5 inline-flex rounded-full bg-card px-2 py-0.5 text-xs font-semibold text-muted-foreground ring-1 ring-ring">
                                    {marketLabel} 주문
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">수량 {order.product.quantity}개</div>
                            </div>
                        </div>

                        <Separator className="my-5" />

                        <div className="space-y-2 text-xs text-muted-foreground">
                            <div className="flex justify-between gap-3">
                                <span>주문번호</span>
                                <span className="truncate font-mono text-foreground">{order.marketOrderId}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>수령인</span>
                                <span className="font-medium text-foreground">{order.recipient.name}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>결제금액</span>
                                <span className="font-bold text-foreground">{order.paymentPrice.toLocaleString()}원</span>
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
                                    className="h-9 bg-card"
                                />
                                <Button type="button" className="h-9 shrink-0" disabled={!searchQuery.trim() || Boolean(searchError)} onClick={handleFindCandidate}>
                                    찾기
                                </Button>
                                </div>
                                {searchError && <div className="mt-1 text-xs font-medium text-foreground">{searchError}</div>}
                            </div>
                        </div>

                        <div className="grid auto-rows-fr grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
                            {displayedCandidates.map((candidate) => (
                                <article
                                    key={candidate.id}
                                    className={cn(
                                        "flex h-full min-w-0 flex-col overflow-hidden rounded-md border bg-card transition hover:border-border hover:shadow-sm",
                                        selectedMatch.id === candidate.id && "border-border ring-2 ring-ring",
                                    )}
                                >
                                    <button
                                        type="button"
                                        className="flex min-h-[108px] w-full flex-1 gap-3 p-3 text-left"
                                        onClick={() => handleSelectMatch(candidate)}
                                    >
                                        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded border bg-card">
                                            <Image src={candidate.thumbnail} alt={candidate.productName} fill sizes="80px" className="object-cover" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">{candidate.productName}</div>
                                            <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{candidate.productNameZh}</div>
                                            <div className="mt-1 truncate text-xs text-muted-foreground">{candidate.sellerName}</div>
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

                    <aside className="overflow-y-auto border-l bg-card p-5">
                        <h3 className="font-semibold">선택 상품</h3>
                        <div className="mt-4 rounded-lg border bg-muted p-4">
                            <div className="flex items-start gap-3">
                                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-card shadow-sm">
                                    <Image src={selectedMatch.thumbnail} alt={selectedMatch.productName} fill sizes="64px" className="object-cover" />
                                </div>
                                <div className="min-w-0 pt-0.5">
                                    <div className="line-clamp-3 text-sm font-bold leading-5 text-foreground">{selectedMatch.productName}</div>
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
                                    <SelectTrigger className="h-auto min-h-12 w-full bg-card py-2 text-left">
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-semibold text-foreground">
                                                {selectedOption.label}{selectedOption.stock <= 0 ? " · 품절" : ""}
                                            </span>
                                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                                {selectedOption.labelZh}
                                            </span>
                                        </span>
                                    </SelectTrigger>
                                    <SelectContent className="max-h-72" position="popper" side="bottom" align="start" avoidCollisions={false}>
                                        {selectedMatch.options.map((option) => (
                                            <SelectItem key={option.id} value={option.id} className="py-2">
                                                <span className="block min-w-0 max-w-[250px]">
                                                    <span className="block truncate text-sm font-semibold text-foreground">
                                                        {option.label}{option.stock <= 0 ? " · 품절" : ""}
                                                    </span>
                                                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
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
                                    <span className="text-muted-foreground">수량</span>
                                    <div className="flex h-8 items-center rounded-md border bg-card">
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
                                <Button className="h-11 w-full bg-primary hover:bg-primary" onClick={saveMatch}>
                                    주문확인
                                </Button>
                                {order.marketDeliveryMethod !== "DIRECT_DELIVERY" ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-11 w-full border-border bg-card text-foreground shadow-none hover:border-border hover:bg-muted hover:text-foreground"
                                        onClick={() => onRequestCancel?.(order)}
                                    >
                                        주문취소
                                    </Button>
                                ) : null}
                            </div>
                        ) : (
                            <Button
                                className="mt-4 h-11 w-full bg-primary hover:bg-primary"
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
        {canOpenSourcingRefund && onRequestSourcingRefund && onAdvanceSourcingRefund && onSubmitSourcingReturnLogistics ? (
            <SourcingRefundDialog
                order={order}
                open={sourcingRefundOpen}
                onOpenChange={setSourcingRefundOpen}
                onSubmit={onRequestSourcingRefund}
                onAdvance={onAdvanceSourcingRefund}
                onSubmitReturnLogistics={onSubmitSourcingReturnLogistics}
            />
        ) : null}
        </>
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
        <div className="mt-auto space-y-3 border-t bg-muted/70 px-3 py-3">
            <div>
                <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-muted-foreground">
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
                    <SelectTrigger className="h-auto min-h-12 w-full bg-card py-2 text-left">
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-foreground">
                                {option.label}{isSoldOut ? " · 품절" : ""}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{option.labelZh}</span>
                        </span>
                    </SelectTrigger>
                    <SelectContent className="max-h-72" position="popper" side="bottom" align="start" avoidCollisions={false}>
                        {candidate.options.map((item) => (
                            <SelectItem key={item.id} value={item.id} className="py-2">
                                <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3">
                                    <span className="min-w-0">
                                        <span className="block truncate text-xs font-semibold text-foreground">
                                            {item.label}{item.stock <= 0 ? " · 품절" : ""}
                                        </span>
                                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.labelZh}</span>
                                    </span>
                                    <span className="text-right text-xs text-muted-foreground">
                                        <span className="block font-semibold text-foreground">{item.priceKrw.toLocaleString()}원</span>
                                        <span className={cn(item.stock <= 0 && "text-foreground")}>{item.stock <= 0 ? "품절" : `재고 ${item.stock}`}</span>
                                    </span>
                                </span>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-xs font-medium text-muted-foreground">옵션가격(재고)</div>
                    <div className="mt-0.5 flex items-baseline gap-1 whitespace-nowrap">
                        <span className="text-xs font-bold tabular-nums text-foreground">{option.priceKrw.toLocaleString()}원</span>
                        <span className={cn("text-xs", isSoldOut ? "font-semibold text-foreground" : "text-muted-foreground")}>
                            ({isSoldOut ? "품절" : `${option.stock}개`})
                        </span>
                    </div>
                </div>
                <div className="flex h-8 shrink-0 items-center rounded-md border bg-card shadow-sm">
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
    priceNegotiationStatus,
    onRequestPriceNegotiation,
    onCancelPriceNegotiation,
    onPay,
    onCancelOrder,
    sourcingRefundActionLabel,
    onOpenSourcingRefund,
}: {
    order: Order;
    meta: SourcingProgressViewMeta;
    productName: string;
    productThumbnail: string;
    optionName: string;
    quantity: number;
    amount: number;
    forwarder: ForwarderProfile;
    messages: ChinaSellerChatMessage[];
    chatDraft: string;
    onChatDraftChange: (value: string) => void;
    onSendChat: () => void;
    priceNegotiationStatus: PriceNegotiationStatus;
    onRequestPriceNegotiation: () => void;
    onCancelPriceNegotiation: () => void;
    onPay?: () => void;
    onCancelOrder?: () => void;
    sourcingRefundActionLabel?: string;
    onOpenSourcingRefund?: () => void;
}) {
    const timelineAt = meta.stage === "PAYMENT_WAITING"
        ? order.sourcingPaymentRequestedAt
        : order.sourcingLifeActualPayment?.paidAt ?? order.sourcingLifeSyncedAt;
    const paymentCompleted = meta.stage !== "PAYMENT_WAITING";
    const forwarderName = order.sourcingForwarder?.name ?? forwarder.name;
    const forwarderAddress = order.sourcingForwarder?.address
        ?? `${forwarder.country} ${forwarder.province} ${forwarder.address1} ${forwarder.address2}`;
    const forwarderReceiverName = order.sourcingForwarder?.receiverName ?? forwarder.receiverName;
    const forwarderPhone = order.sourcingForwarder?.phone ?? forwarder.phone;
    const invoiceLabel = order.domesticInvoice?.trackingNumber
        ? `${order.domesticInvoice.carrier} ${order.domesticInvoice.trackingNumber}`
        : "반영 결과 확인 중";
    const chatTitle = paymentCompleted ? "결제완료 후 판매자 채팅" : "결제 전 판매자 채팅";
    const chatDescription = paymentCompleted
        ? "결제 전 대화를 이어서 확인하고 상품 준비와 중국 내 발송을 중국 판매자에게 문의할 수 있습니다."
        : "상품 가격, 재고와 중국 내 배송 조건을 중국 판매자에게 확인한 뒤 결제를 진행하세요.";
    const waitingMarginCalculation = calculateSourcingMargin(order, amount);
    const marketLabel = MARKET_LABELS[order.marketType];

    return (
        <div className="bg-muted/40 lg:grid lg:h-[calc(92vh-81px)] lg:max-h-[760px] lg:min-h-[600px] lg:grid-cols-[minmax(0,1fr)_400px] lg:overflow-hidden">
            <main className="min-w-0 lg:flex lg:min-h-0 lg:flex-col">
                <div className="space-y-4 p-4 sm:p-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-6">
                    {paymentCompleted ? (
                        <Card className="overflow-hidden rounded-xl border bg-card shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                                <h4 className="text-sm font-bold text-foreground">구매대행 신청 상품</h4>
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    <span className="text-xs text-muted-foreground">마켓 주문 {order.marketOrderId}</span>
                                    {onOpenSourcingRefund && sourcingRefundActionLabel ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-8"
                                            onClick={onOpenSourcingRefund}
                                        >
                                            {sourcingRefundActionLabel}
                                        </Button>
                                    ) : null}
                                </div>
                            </div>
                            <div className="grid gap-4 p-5 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:items-center">
                                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border bg-muted">
                                    <Image src={productThumbnail} alt={productName} fill sizes="80px" className="object-cover" />
                                </div>
                                <div className="min-w-0">
                                    <div className="line-clamp-2 text-sm font-bold leading-5 text-foreground">{productName}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">{optionName} · 수량 {quantity}개</div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {order.sourcingLifeOrderId ? (
                                            <Badge variant="outline" className="font-mono">{order.sourcingLifeOrderId}</Badge>
                                        ) : null}
                                        <Badge variant="secondary">갱신 {timelineAt ?? "확인 중"}</Badge>
                                    </div>
                                </div>
                                <div className="border-t pt-3 text-left sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0 sm:text-right">
                                    <div className="text-xs font-semibold text-muted-foreground">실제 결제금액</div>
                                    <div className="mt-1 text-xl font-black tracking-tight text-foreground">{amount.toLocaleString()}원</div>
                                </div>
                            </div>
                        </Card>
                    ) : (
                        <>
                            <PaymentWaitingProductComparison
                                order={order}
                                sourcingProductName={productName}
                                sourcingProductThumbnail={productThumbnail}
                                sourcingOptionName={optionName}
                                sourcingQuantity={quantity}
                                sourcingProductCost={amount}
                                requestedAt={timelineAt}
                            />
                            <PaymentWaitingCostSummary
                                calculation={waitingMarginCalculation}
                                marketLabel={marketLabel}
                            />
                        </>
                    )}

                    {paymentCompleted ? (
                        <Card className="overflow-hidden rounded-xl border bg-card shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/50 px-5 py-4">
                                <div>
                                    <h4 className="text-sm font-bold text-foreground">결제 및 주문서 처리 결과</h4>
                                    <p className="mt-1 text-xs text-muted-foreground">결제완료 후에는 재결제할 수 없으며 중국 판매자 채팅은 계속 이용할 수 있습니다.</p>
                                </div>
                                <Badge className="h-7 px-3"><CheckCircle2 /> 처리 완료</Badge>
                            </div>
                            <dl className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                                <div className="p-5">
                                    <dt className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><CreditCard className="h-4 w-4" /> 결제 정보</dt>
                                    <dd className="mt-2 text-sm font-black text-foreground">{amount.toLocaleString()}원</dd>
                                    <dd className="mt-1 text-xs text-muted-foreground">{order.sourcingLifeActualPayment?.paidAt ?? timelineAt ?? "완료시간 확인 중"}</dd>
                                </div>
                                <div className="p-5">
                                    <dt className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><PackageCheck className="h-4 w-4" /> 소싱라이프 주문번호</dt>
                                    <dd className="mt-2 break-all font-mono text-sm font-black text-foreground">{order.sourcingLifeOrderId ?? "생성 결과 확인 중"}</dd>
                                    <dd className="mt-1 text-xs text-muted-foreground">{meta.stage === "SOURCED" ? "중국 판매자 발송대기" : meta.label}</dd>
                                </div>
                            </dl>
                            <div className="grid gap-3 border-t px-5 py-4 sm:grid-cols-2">
                                <div>
                                    <div className="text-xs font-semibold text-muted-foreground">배송대행지 주문서</div>
                                    <div className="mt-1 text-sm font-bold text-foreground">{order.domesticInvoice ? "접수·송장 반영 완료" : "접수 결과 확인 중"}</div>
                                </div>
                                <div>
                                    <div className="text-xs font-semibold text-muted-foreground">국내송장 반영</div>
                                    <div className="mt-1 break-all text-sm font-bold text-foreground">{invoiceLabel}</div>
                                </div>
                            </div>
                        </Card>
                    ) : null}

                    <Card className="rounded-xl border bg-card p-5 shadow-sm">
                        <div className="flex items-start gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground"><Warehouse className="h-5 w-5" /></span>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <div className="text-xs font-semibold text-muted-foreground">선택 배송대행지</div>
                                        <div className="mt-1 text-sm font-bold text-foreground">{forwarderName}</div>
                                    </div>
                                    {!paymentCompleted && timelineAt ? <Badge variant="outline">신청 {timelineAt}</Badge> : null}
                                </div>
                                <div className="mt-2 text-sm leading-6 text-muted-foreground">{forwarderAddress}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{forwarderReceiverName} · {forwarderPhone}</div>
                            </div>
                        </div>
                    </Card>
                </div>

                {onPay ? (
                    <div className="border-t bg-background px-4 py-4 sm:px-5 lg:px-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs leading-5 text-muted-foreground">중국 판매자와 확인한 내용을 검토한 뒤 최종 결제를 진행하세요.</p>
                            <div className={cn("grid gap-2 sm:min-w-[360px]", onCancelOrder ? "grid-cols-[0.8fr_1fr]" : "grid-cols-1")}>
                                {onCancelOrder ? (
                                    <Button variant="outline" onClick={onCancelOrder}>
                                        주문 취소하기
                                    </Button>
                                ) : null}
                                <Button
                                    className="px-6"
                                    disabled={!canProceedToPayment(priceNegotiationStatus)}
                                    onClick={onPay}
                                >
                                    상품 결제하기
                                </Button>
                            </div>
                        </div>
                        {priceNegotiationStatus === "REQUESTED" ? (
                            <p className="mt-2 text-xs text-muted-foreground sm:text-right">가격 협상 요청을 취소하거나 판매자 답변을 반영한 뒤 결제할 수 있습니다.</p>
                        ) : null}
                    </div>
                ) : null}
            </main>

            <aside className="flex min-h-[560px] flex-col border-t bg-card lg:min-h-0 lg:border-l lg:border-t-0" aria-label="중국 판매자 채팅">
                <div className="border-b px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><MessageCircle className="h-5 w-5" /></span>
                            <div className="min-w-0">
                                <h3 className="text-sm font-bold text-foreground">중국 판매자 채팅</h3>
                                <p className="mt-0.5 text-xs text-muted-foreground">{chatTitle}</p>
                            </div>
                        </div>
                        <Badge variant="outline" className="mt-1">채팅 가능</Badge>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">{chatDescription}</p>
                </div>

                <div className="min-h-[260px] flex-1 space-y-4 overflow-y-auto bg-muted/50 p-4" role="log" aria-live="polite" aria-label="중국 판매자 채팅 메시지">
                    {messages.map((message) => {
                        const isOperator = message.sender === "operator";
                        return (
                            <div key={message.id} className={cn("flex", isOperator ? "justify-end" : "justify-start")}>
                                <div className="max-w-[88%]">
                                    <div className={cn("mb-1 px-1 text-xs font-semibold text-muted-foreground", isOperator && "text-right")}>{isOperator ? "나" : "중국 판매자"}</div>
                                    <div className={cn(
                                        "rounded-2xl px-3.5 py-3 text-sm leading-5 shadow-sm",
                                        isOperator ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border bg-card text-foreground",
                                    )}>
                                        <div className="break-words">{message.message}</div>
                                        <div className={cn("mt-1.5 text-xs", isOperator ? "text-primary-foreground/60" : "text-muted-foreground")}>{message.sentAt}</div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="border-t p-4">
                    {!paymentCompleted ? (
                        <div className="mb-4 rounded-lg border bg-muted/50 p-3">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-sm font-semibold text-foreground">가격 협상</div>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">중국 판매자에게 가격 인하를 요청하거나 진행 중인 요청을 취소합니다.</p>
                                </div>
                                <Badge variant={priceNegotiationStatus === "REQUESTED" ? "default" : "outline"}>
                                    {priceNegotiationStatus === "REQUESTED" ? "요청 중" : "대기"}
                                </Badge>
                            </div>
                            <ButtonGroup className="mt-3 grid w-full grid-cols-2">
                                <Button
                                    type="button"
                                    disabled={priceNegotiationStatus === "REQUESTED"}
                                    onClick={onRequestPriceNegotiation}
                                >
                                    깎아줘
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={priceNegotiationStatus !== "REQUESTED"}
                                    onClick={onCancelPriceNegotiation}
                                >
                                    깎아줘 취소
                                </Button>
                            </ButtonGroup>
                            <p className="mt-2 text-xs leading-4 text-muted-foreground">요청은 채팅으로 전달되며 가격 변경이나 결제를 자동 실행하지 않습니다.</p>
                        </div>
                    ) : null}
                    <label htmlFor={`china-seller-chat-${order.id}`} className="mb-2 block text-xs font-semibold text-foreground">판매자에게 보낼 메시지</label>
                    <Textarea
                        id={`china-seller-chat-${order.id}`}
                        value={chatDraft}
                        onChange={(event) => onChatDraftChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                                event.preventDefault();
                                onSendChat();
                            }
                        }}
                        placeholder={paymentCompleted ? "상품 준비나 중국 내 발송을 문의하세요" : "상품, 가격, 재고, 중국 내 배송 조건을 문의하세요"}
                        className="min-h-20 resize-none bg-background text-sm"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">Enter 전송 · Shift+Enter 줄바꿈</span>
                        <Button size="sm" disabled={!chatDraft.trim()} onClick={onSendChat}>
                            <Send className="h-4 w-4" /> 보내기
                        </Button>
                    </div>
                    <p className="mt-3 border-t pt-3 text-xs leading-4 text-muted-foreground">개인통관부호·결제정보 등 민감정보는 채팅에 입력하지 마세요.</p>
                </div>
            </aside>
        </div>
    );
}

function PaymentWaitingProductComparison({
    order,
    sourcingProductName,
    sourcingProductThumbnail,
    sourcingOptionName,
    sourcingQuantity,
    sourcingProductCost,
    requestedAt,
}: {
    order: Order;
    sourcingProductName: string;
    sourcingProductThumbnail: string;
    sourcingOptionName: string;
    sourcingQuantity: number;
    sourcingProductCost: number;
    requestedAt?: string;
}) {
    return (
        <Card className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-labelledby="payment-waiting-product-comparison-title">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4">
                <div>
                    <h4 id="payment-waiting-product-comparison-title" className="text-sm font-bold text-foreground">원주문 상품과 소싱상품 비교</h4>
                    <p className="mt-1 text-xs text-muted-foreground">상품, 옵션과 수량이 주문 내용과 일치하는지 결제 전에 확인하세요.</p>
                </div>
                <span className="text-xs text-muted-foreground">마켓 주문 {order.marketOrderId}</span>
            </div>
            <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <section className="p-5" aria-labelledby="original-order-product-title">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h5 id="original-order-product-title" className="text-sm font-bold text-foreground">원주문 상품</h5>
                        <Badge variant="outline">판매 주문</Badge>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-[72px_minmax(0,1fr)]">
                        <div className="relative h-[72px] w-[72px] overflow-hidden rounded-lg border bg-muted">
                            <Image src={order.product.thumbnail} alt={order.product.name} fill sizes="72px" className="object-cover" />
                        </div>
                        <div className="min-w-0">
                            <div className="line-clamp-2 text-sm font-bold leading-5 text-foreground">{order.product.name}</div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">{order.product.optionName} · 수량 {order.product.quantity}개</div>
                            <div className="mt-3 flex items-end justify-between gap-3 border-t pt-3">
                                <span className="text-xs font-semibold text-muted-foreground">판매 결제금액</span>
                                <span className="text-base font-black text-foreground">{order.paymentPrice.toLocaleString()}원</span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="p-5" aria-labelledby="sourcing-product-title">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <h5 id="sourcing-product-title" className="text-sm font-bold text-foreground">소싱상품</h5>
                        <Badge variant="secondary">결제 대기</Badge>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-[72px_minmax(0,1fr)]">
                        <div className="relative h-[72px] w-[72px] overflow-hidden rounded-lg border bg-muted">
                            <Image src={sourcingProductThumbnail} alt={sourcingProductName} fill sizes="72px" className="object-cover" />
                        </div>
                        <div className="min-w-0">
                            <div className="line-clamp-2 text-sm font-bold leading-5 text-foreground">{sourcingProductName}</div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">{sourcingOptionName} · 수량 {sourcingQuantity}개</div>
                            <div className="mt-3 flex items-end justify-between gap-3 border-t pt-3">
                                <div>
                                    <div className="text-xs font-semibold text-muted-foreground">상품원가</div>
                                    <div className="mt-0.5 text-xs text-muted-foreground">신청 {requestedAt ?? "확인 중"}</div>
                                </div>
                                <span className="text-base font-black text-foreground">{sourcingProductCost.toLocaleString()}원</span>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </Card>
    );
}

function PaymentWaitingCostSummary({
    calculation,
    marketLabel,
}: {
    calculation: SourcingMarginCalculation;
    marketLabel: string;
}) {
    const estimatedTotalCost = calculation.sourcingTotalCost + calculation.estimatedForwarderShippingFee;
    const hasPositiveMargin = calculation.expectedMargin >= 0;

    return (
        <Card className="overflow-hidden rounded-xl border bg-card shadow-sm" aria-labelledby="payment-waiting-cost-summary-title">
            <div className="border-b px-5 py-4">
                <h4 id="payment-waiting-cost-summary-title" className="text-sm font-bold text-foreground">예상 비용 및 수익</h4>
                <p className="mt-1 text-xs text-muted-foreground">현재 상품원가와 예상 배송비를 기준으로 계산한 결제 전 손익입니다.</p>
            </div>
            <div className="grid sm:grid-cols-[minmax(0,1.25fr)_minmax(220px,0.75fr)]">
                <dl className="grid grid-cols-2 gap-px bg-border">
                    <div className="bg-card p-4">
                        <dt className="text-xs font-semibold text-muted-foreground">상품원가</dt>
                        <dd className="mt-1 text-sm font-black text-foreground">{calculation.productCost.toLocaleString()}원</dd>
                    </div>
                    <div className="bg-card p-4">
                        <dt className="text-xs font-semibold text-muted-foreground">소싱처 이용료</dt>
                        <dd className="mt-1 text-sm font-black text-foreground">{calculation.sourcingServiceFee.toLocaleString()}원</dd>
                    </div>
                    <div className="bg-card p-4">
                        <dt className="text-xs font-semibold text-muted-foreground">환전 수수료</dt>
                        <dd className="mt-1 text-sm font-black text-foreground">{calculation.currencyExchangeFee.toLocaleString()}원</dd>
                    </div>
                    <div className="bg-card p-4">
                        <dt className="text-xs font-semibold text-muted-foreground">예상 배송비</dt>
                        <dd className="mt-1 text-sm font-black text-foreground">{calculation.estimatedForwarderShippingFee.toLocaleString()}원</dd>
                    </div>
                    <div className="col-span-2 flex items-center justify-between gap-3 bg-muted/50 p-4">
                        <dt className="text-sm font-bold text-foreground">예상 총비용</dt>
                        <dd className="text-base font-black text-foreground">{estimatedTotalCost.toLocaleString()}원</dd>
                    </div>
                </dl>

                <div className="border-t bg-muted/30 p-5 sm:border-l sm:border-t-0">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="text-xs font-semibold text-muted-foreground">예상 순이익</div>
                            <div className="mt-1 text-2xl font-black tracking-tight text-foreground">
                                {calculation.expectedMargin < 0 ? "-" : ""}{Math.abs(calculation.expectedMargin).toLocaleString()}원
                            </div>
                        </div>
                        <Badge variant={hasPositiveMargin ? "default" : "outline"}>{hasPositiveMargin ? "수익 예상" : "역마진 예상"}</Badge>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t pt-4">
                        <span className="text-sm font-semibold text-muted-foreground">마진율</span>
                        <span className="text-lg font-black text-foreground">{calculation.expectedMarginRate.toFixed(1)}%</span>
                    </div>
                    <dl className="mt-4 space-y-2 border-t pt-4 text-xs">
                        <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">정산예상금액</dt>
                            <dd className="font-semibold text-foreground">{calculation.expectedSettlement.toLocaleString()}원</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">{marketLabel} 판매 수수료</dt>
                            <dd className="font-semibold text-foreground">{calculation.marketFee.toLocaleString()}원</dd>
                        </div>
                    </dl>
                </div>
            </div>
        </Card>
    );
}

function AgreementRow({ label, strong = false }: { label: string; strong?: boolean }) {
    return (
        <label className="flex items-center gap-2 border-b py-3 text-sm text-foreground">
            <Checkbox />
            <span className={cn(strong && "font-bold text-foreground")}>{label}</span>
            <span className="ml-auto text-muted-foreground">⌄</span>
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
        <Card className="h-fit rounded-3xl border bg-card p-5 shadow-sm">
            {costOnly ? (
                <div className="rounded-2xl bg-muted px-4 py-5 text-center ring-1 ring-ring/70">
                    <div className="text-xs font-bold text-muted-foreground">소싱 총비용</div>
                    <div className="mt-2 text-2xl font-black tracking-tight text-foreground">₩{calculation.sourcingTotalCost.toLocaleString()}</div>
                </div>
            ) : (
                <CostAndMarginBreakdown amountCny={amountCny} calculation={calculation} marketLabel={marketLabel} />
            )}
            <Button className="mt-6 h-10 w-full rounded-full font-bold" onClick={onPrimaryClick}>
                {primaryLabel}
            </Button>
            <Button variant="outline" className="mt-2 h-10 w-full rounded-full" onClick={onCancel}>
                취소
            </Button>
            {costOnly && (
                <div className="mt-4 rounded-xl border border-border bg-muted px-4 py-3 text-xs leading-5 text-foreground">
                    구매대행 신청 후 주문은 결제되지 않고 <strong>결제대기</strong>에 머뭅니다. 견적과 중국 판매자 확인 내용을 검토한 뒤 별도의 `결제하기` 단계에서 결제합니다.
                </div>
            )}
        </Card>
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
            <h4 className="mb-3 text-xs font-black tracking-tight text-foreground">비용 구성</h4>
            <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">상품 금액</span>
                    <span className="text-right font-bold">₩{calculation.productCost.toLocaleString()}<span className="block text-xs font-medium text-muted-foreground">(¥{amountCny.toLocaleString()})</span></span>
                </div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">소싱처 이용료</span><span className="font-semibold">₩{calculation.sourcingServiceFee.toLocaleString()}</span></div>
                <div className="flex justify-between gap-3"><span className="text-muted-foreground">통화 환전 수수료</span><span className="font-semibold">₩{calculation.currencyExchangeFee.toLocaleString()}</span></div>
                <div className="flex justify-between border-t pt-3"><span className="font-bold text-foreground">소싱 총비용</span><span className="font-black text-foreground">₩{calculation.sourcingTotalCost.toLocaleString()}</span></div>
            </div>
        </section>
    );
}

function MarginAnalysis({
    calculation,
    marketLabel,
    wide = false,
    showTitle = true,
}: {
    calculation: SourcingMarginCalculation;
    marketLabel: string;
    wide?: boolean;
    showTitle?: boolean;
}) {
    const marginColor = calculation.expectedMargin >= 0 ? "text-foreground" : "text-foreground";

    return (
        <Card className={cn("rounded-xl bg-muted p-3.5 ring-1 ring-ring/70", wide && "p-5")}>
            {showTitle && <h4 className={cn("mb-3 text-xs font-black tracking-tight text-foreground", wide && "text-sm")}>마진 분석</h4>}
            <div className={cn("space-y-2.5", wide && "grid grid-cols-2 gap-x-8 gap-y-2.5 space-y-0")}>
                <div className="flex items-start justify-between gap-3"><span className="font-semibold text-foreground">결제 금액</span><span className="font-bold">₩{calculation.marketPaymentAmount.toLocaleString()}</span></div>
                <div className="flex justify-between gap-3 text-xs text-muted-foreground"><span>- {marketLabel} 판매 수수료</span><span>-₩{calculation.marketFee.toLocaleString()}</span></div>
                <div className="flex justify-between gap-3 text-xs text-muted-foreground"><span>- 소싱 상품 금액</span><span>-₩{calculation.productCost.toLocaleString()}</span></div>
                <div className="flex justify-between gap-3 text-xs text-muted-foreground"><span>- 소싱처 이용료</span><span>-₩{calculation.sourcingServiceFee.toLocaleString()}</span></div>
                <div className="flex justify-between gap-3 text-xs text-muted-foreground"><span>- 통화 환전 수수료</span><span>-₩{calculation.currencyExchangeFee.toLocaleString()}</span></div>
                <div className="flex justify-between gap-3 text-xs text-muted-foreground"><span>- 배송대행지 운임료 <span className="text-xs">(예상)</span></span><span>-₩{calculation.estimatedForwarderShippingFee.toLocaleString()}</span></div>
            </div>
            <div className={cn("mt-3 border-t border-border pt-3", wide && "grid grid-cols-2 gap-8")}>
                <div className="flex justify-between"><span className="font-black text-foreground">예상 순이익</span><span className={cn("text-base font-black", marginColor)}>{calculation.expectedMargin < 0 ? "-" : ""}₩{Math.abs(calculation.expectedMargin).toLocaleString()}</span></div>
                <div className="mt-1 flex justify-between sm:mt-0"><span className="text-xs font-semibold text-muted-foreground">마진율</span><span className={cn("font-black", marginColor)}>{calculation.expectedMarginRate.toFixed(1)}%</span></div>
            </div>
        </Card>
    );
}
