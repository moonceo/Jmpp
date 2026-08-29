"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field as ShadcnField, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { withBrowserSecurity } from "@/lib/client/http";
import type { Order } from "@/types/order";

interface ActiveMapping {
    mappingRevision: number;
    orderItemVersion: string;
    externalSkuIdSnapshot: string;
    optionAttributesSnapshot: Record<string, string>;
    unitPriceCnySnapshot: string;
    quantityMultiplier: number;
    productVerificationSnapshot: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
    optionVerificationSnapshot: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
}

export interface SavedLiveSourcingMapping {
    mappingRevision: number;
    orderItemVersion: string;
    verificationProvenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
    externalSkuId: string;
    selectedOption: Record<string, string>;
    unitPriceCny: string;
}

interface ApiEnvelope<T> {
    data?: T;
    error?: { message?: string };
}

export function parseOptionAttributes(value: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    const entries = value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
    if (entries.length === 0 || entries.length > 20) {
        throw new Error("옵션은 1개 이상 20개 이하로 입력해 주세요.");
    }
    for (const entry of entries) {
        const separator = entry.indexOf("=");
        const key = entry.slice(0, separator).trim();
        const optionValue = entry.slice(separator + 1).trim();
        if (separator <= 0 || !key || !optionValue) {
            throw new Error("옵션은 ‘색상=검정, 사이즈=M’ 형식으로 입력해 주세요.");
        }
        attributes[key] = optionValue;
    }
    return attributes;
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, withBrowserSecurity(init));
    const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
    if (!response.ok) {
        throw new Error(payload?.error?.message ?? `요청을 처리하지 못했습니다. (${response.status})`);
    }
    if (payload?.data === undefined) throw new Error("서버 응답이 올바르지 않습니다.");
    return payload.data;
}

function optionalPositiveInteger(value: string): number | null {
    if (!value.trim()) return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("재고수량을 확인해 주세요.");
    return parsed;
}

export function LiveSourcingMappingDialog({
    order,
    onSaved,
    buttonLabel = "매핑 관리",
}: {
    order: Order;
    onSaved: (mapping: SavedLiveSourcingMapping) => void;
    buttonLabel?: string;
}) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [current, setCurrent] = useState<ActiveMapping | null>(null);
    const [platform, setPlatform] = useState<"TAOBAO" | "TMALL">("TAOBAO");
    const [productUrl, setProductUrl] = useState("");
    const [productId, setProductId] = useState("");
    const [skuId, setSkuId] = useState("");
    const [optionText, setOptionText] = useState(
        order.product.optionName && order.product.optionName !== "옵션 없음"
            ? `마켓옵션=${order.product.optionName}`
            : "단일옵션=기본",
    );
    const [unitPriceCny, setUnitPriceCny] = useState("");
    const [stockStatus, setStockStatus] = useState<"AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNKNOWN">("UNKNOWN");
    const [stockQuantity, setStockQuantity] = useState("");
    const [minimumQuantity, setMinimumQuantity] = useState("1");
    const [quantityStep, setQuantityStep] = useState("1");
    const [quantityMultiplier, setQuantityMultiplier] = useState("1");
    const [chinaShippingStatus, setChinaShippingStatus] = useState<"CONFIRMED" | "ESTIMATED" | "UNKNOWN">("UNKNOWN");
    const [chinaShippingCny, setChinaShippingCny] = useState("");

    const verified = current?.productVerificationSnapshot === "SERVER_VERIFIED"
        && current.optionVerificationSnapshot === "SERVER_VERIFIED";
    const currentOptions = useMemo(
        () => current ? Object.entries(current.optionAttributesSnapshot).map(([key, value]) => `${key}=${value}`).join(", ") : null,
        [current],
    );

    useEffect(() => {
        if (!open) return;
        let active = true;
        setLoading(true);
        apiRequest<ActiveMapping>(`/api/order-items/${order.id}/sourcing-mapping`)
            .then((mapping) => {
                if (active) setCurrent(mapping);
            })
            .catch((error) => {
                if (active && !(error instanceof Error && error.message.includes("찾을 수 없습니다"))) {
                    toast.error(error instanceof Error ? error.message : "현재 매핑을 불러오지 못했습니다.");
                }
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [open, order.id]);

    const extractProductId = () => {
        if (productId.trim()) return;
        try {
            const id = new URL(productUrl).searchParams.get("id");
            if (id) setProductId(id);
        } catch {
            // The server returns the canonical URL validation error on submit.
        }
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!order.version) {
            toast.error("주문상품 버전을 확인할 수 없습니다. 주문을 새로고침해 주세요.");
            return;
        }
        setSaving(true);
        try {
            const attributes = parseOptionAttributes(optionText);
            const minimum = Number(minimumQuantity);
            const step = Number(quantityStep);
            const multiplier = Number(quantityMultiplier);
            if (![minimum, step, multiplier].every((value) => Number.isSafeInteger(value) && value > 0)) {
                throw new Error("최소수량, 수량단위, 주문수량 배수는 1 이상의 정수여야 합니다.");
            }
            const observedAt = new Date().toISOString();
            const sourceVersion = `manual:${observedAt}`;
            const mapping = await apiRequest<SavedLiveSourcingMapping>(
                `/api/order-items/${order.id}/sourcing-mapping`,
                {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        expectedOrderItemVersion: order.version,
                        ...(current ? { expectedMappingRevision: current.mappingRevision } : {}),
                        quantityMultiplier: multiplier,
                        sourceProduct: {
                            platform,
                            externalProductId: productId.trim(),
                            canonicalUrl: productUrl.trim(),
                            titleKo: order.product.name,
                            saleStatus: "ACTIVE",
                            restrictionStatus: "REVIEW_REQUIRED",
                            restrictionReason: "운영자 수동 snapshot - trusted connector 검증 필요",
                            customsRequirement: "IDENTITY_VERIFIED",
                            sourceVersion,
                            lastCheckedAt: observedAt,
                        },
                        sourceOption: {
                            externalSkuId: skuId.trim(),
                            optionAttributes: attributes,
                            optionLabelKo: order.product.optionName || undefined,
                            unitPriceCny: unitPriceCny.trim(),
                            stockStatus,
                            stockQuantity: stockStatus === "OUT_OF_STOCK"
                                ? 0
                                : stockStatus === "UNKNOWN"
                                    ? null
                                : optionalPositiveInteger(stockQuantity),
                            minimumQuantity: minimum,
                            quantityStep: step,
                            chinaShippingStatus,
                            chinaShippingCny: chinaShippingStatus === "UNKNOWN"
                                ? null
                                : chinaShippingCny.trim(),
                            sourceVersion,
                            lastCheckedAt: observedAt,
                        },
                    }),
                },
            );
            setCurrent({
                mappingRevision: mapping.mappingRevision,
                orderItemVersion: mapping.orderItemVersion,
                externalSkuIdSnapshot: skuId.trim(),
                optionAttributesSnapshot: attributes,
                unitPriceCnySnapshot: unitPriceCny.trim(),
                quantityMultiplier: multiplier,
                productVerificationSnapshot: mapping.verificationProvenance,
                optionVerificationSnapshot: mapping.verificationProvenance,
            });
            onSaved(mapping);
            toast.success("매핑 초안을 저장했습니다. 서버 검증 전에는 구매·결제가 차단됩니다.");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "소싱 매핑을 저장하지 못했습니다.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <Button size="sm" variant="outline" className="h-[29px] w-full px-1.5 text-xs" onClick={() => setOpen(true)}>
                {buttonLabel}
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-0">
                    <DialogHeader className="border-b px-5 py-4">
                        <DialogTitle>타오바오 SKU 매핑 초안</DialogTitle>
                        <DialogDescription>마켓 주문상품과 정확한 중국 상품 옵션을 연결합니다.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={submit}>
                        <div className="space-y-5 px-5 py-4">
                            <Alert>
                                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                                <AlertDescription>수동 입력은 검증 자료가 아닌 초안입니다. 소싱라이프 서버가 가격·재고·SKU·금지품목을 다시 확인하기 전에는 구매신청과 결제를 진행할 수 없습니다.</AlertDescription>
                            </Alert>

                            {loading ? <p className="text-xs text-muted-foreground">현재 매핑 확인 중...</p> : null}
                            {current ? (
                                <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs leading-5 text-foreground">
                                    <div className="flex items-center justify-between gap-3">
                                        <strong>현재 revision {current.mappingRevision}</strong>
                                        <span className={verified ? "text-foreground" : "text-foreground"}>
                                            {verified ? "서버 검증됨" : "서버 검증 대기"}
                                        </span>
                                    </div>
                                    <p>SKU {current.externalSkuIdSnapshot} · {currentOptions} · ¥{current.unitPriceCnySnapshot}</p>
                                </div>
                            ) : null}

                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="소싱 플랫폼">
                                    <Select value={platform} onValueChange={(value) => setPlatform(value as "TAOBAO" | "TMALL")}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="TAOBAO">타오바오</SelectItem>
                                            <SelectItem value="TMALL">티몰</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </Field>
                                <Field label="상품 ID">
                                    <Input value={productId} onChange={(event) => setProductId(event.target.value)} required />
                                </Field>
                            </div>
                            <Field label="상품 URL">
                                <Input type="url" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} onBlur={extractProductId} placeholder="https://item.taobao.com/item.htm?id=..." required />
                            </Field>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="정확한 SKU ID">
                                    <Input value={skuId} onChange={(event) => setSkuId(event.target.value)} required />
                                </Field>
                                <Field label="주문수량 배수">
                                    <Input type="number" min="1" step="1" value={quantityMultiplier} onChange={(event) => setQuantityMultiplier(event.target.value)} required />
                                </Field>
                            </div>
                            <Field label="옵션 속성">
                                <Textarea value={optionText} onChange={(event) => setOptionText(event.target.value)} placeholder="색상=검정, 사이즈=M" rows={2} required />
                            </Field>
                            <div className="grid gap-4 sm:grid-cols-3">
                                <Field label="단가(CNY)"><Input inputMode="decimal" value={unitPriceCny} onChange={(event) => setUnitPriceCny(event.target.value)} placeholder="12.50" required /></Field>
                                <Field label="재고 상태">
                                    <Select value={stockStatus} onValueChange={(value) => setStockStatus(value as typeof stockStatus)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="AVAILABLE">재고 있음</SelectItem>
                                            <SelectItem value="LOW_STOCK">재고 적음</SelectItem>
                                            <SelectItem value="OUT_OF_STOCK">품절</SelectItem>
                                            <SelectItem value="UNKNOWN">확인 필요</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </Field>
                                <Field label="재고수량"><Input type="number" min="0" step="1" value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} placeholder="미확인 시 비움" /></Field>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="최소 구매수량"><Input type="number" min="1" step="1" value={minimumQuantity} onChange={(event) => setMinimumQuantity(event.target.value)} required /></Field>
                                <Field label="구매 수량단위"><Input type="number" min="1" step="1" value={quantityStep} onChange={(event) => setQuantityStep(event.target.value)} required /></Field>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="중국 내 배송비 상태">
                                    <Select value={chinaShippingStatus} onValueChange={(value) => setChinaShippingStatus(value as typeof chinaShippingStatus)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="CONFIRMED">확정</SelectItem>
                                            <SelectItem value="ESTIMATED">예상</SelectItem>
                                            <SelectItem value="UNKNOWN">미확인</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </Field>
                                <Field label="중국 내 배송비(CNY)"><Input inputMode="decimal" value={chinaShippingCny} disabled={chinaShippingStatus === "UNKNOWN"} onChange={(event) => setChinaShippingCny(event.target.value)} placeholder="5.00" required={chinaShippingStatus !== "UNKNOWN"} /></Field>
                            </div>
                        </div>
                        <DialogFooter className="border-t px-5 py-4">
                            <Button type="button" variant="outline" onClick={() => setOpen(false)}>닫기</Button>
                            <Button type="submit" disabled={saving}>{saving ? "저장 중..." : current ? "새 revision 저장" : "매핑 초안 저장"}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <ShadcnField className="gap-1.5">
            <FieldLabel>{label}</FieldLabel>
            {children}
        </ShadcnField>
    );
}
