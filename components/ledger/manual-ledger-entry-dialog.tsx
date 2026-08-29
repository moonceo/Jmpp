"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
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
import { MARKET_LABELS } from "@/lib/constants/orders";
import {
    getLedgerNetPaymentShippingIncome,
    ledgerRowToValues,
    toLedgerRow,
} from "@/lib/ledger";
import {
    LEDGER_MANUAL_FIELDS,
    parseLedgerManualValue,
    type LedgerManualEntry,
    type LedgerManualField,
} from "@/lib/ledger-manual-entry";
import {
    useLedgerManualEntryHydration,
    useLedgerManualEntryStore,
} from "@/lib/stores/ledger-manual-entry-store";
import { cn } from "@/lib/utils";
import type { Order } from "@/types/order";

interface ManualLedgerEntryDialogProps {
    orders: readonly Order[];
    initialOrderId?: string;
    triggerLabel?: string;
    triggerClassName?: string;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    hideTrigger?: boolean;
}

type CostFormValues = Record<LedgerManualField, string>;
type CostValues = Record<LedgerManualField, number | null>;

function emptyCostFormValues(): CostFormValues {
    return {
        purchaseCostKrw: "",
        internationalShippingFee: "",
        freightShippingFee: "",
        customsTax: "",
    };
}

function emptyCostValues(): CostValues {
    return {
        purchaseCostKrw: null,
        internationalShippingFee: null,
        freightShippingFee: null,
        customsTax: null,
    };
}

function formValuesFromEntries(entries: readonly LedgerManualEntry[], orderId: string): CostFormValues {
    const values = emptyCostFormValues();

    entries.forEach((entry) => {
        if (entry.orderId === orderId) values[entry.field] = String(entry.value);
    });

    return values;
}

function automaticCostValues(order?: Order): CostValues {
    if (!order) return emptyCostValues();

    const values = ledgerRowToValues(toLedgerRow(order));
    return LEDGER_MANUAL_FIELDS.reduce<CostValues>((result, field) => {
        if (field.key === "purchaseCostKrw") {
            result[field.key] = order.sourcingLifeActualPayment?.amount ?? null;
            return result;
        }

        const value = values[field.columnIndex];
        result[field.key] = typeof value === "number" ? value : null;
        return result;
    }, emptyCostValues());
}

function manualCostValue(entries: readonly LedgerManualEntry[], field: LedgerManualField): number | null {
    const entry = entries.find((item) => item.field === field);
    return typeof entry?.value === "number" ? entry.value : null;
}

function formatWon(value: number | null): string {
    return value === null ? "미입력" : `${value.toLocaleString("ko-KR")}원`;
}

function formatSignedCost(value: number | null): string {
    return value === null ? "-" : `-${value.toLocaleString("ko-KR")}원`;
}

function formatSignedIncome(value: number): string {
    return `+${value.toLocaleString("ko-KR")}원`;
}

function marginTone(value: number | null): string {
    if (value === null) return "text-muted-foreground";
    return value >= 0 ? "text-emerald-600" : "text-rose-600";
}

export function ManualLedgerEntryDialog({
    orders,
    initialOrderId,
    triggerLabel = "직접 입력",
    triggerClassName,
    open: controlledOpen,
    onOpenChange,
    hideTrigger = false,
}: ManualLedgerEntryDialogProps) {
    useLedgerManualEntryHydration();
    const entries = useLedgerManualEntryStore((state) => state.entries);
    const saveEntry = useLedgerManualEntryStore((state) => state.saveEntry);
    const removeEntry = useLedgerManualEntryStore((state) => state.removeEntry);
    const [internalOpen, setInternalOpen] = useState(false);
    const selectedOrder = orders.find((order) => order.id === initialOrderId) ?? orders[0];
    const [formValues, setFormValues] = useState<CostFormValues>(() => (
        selectedOrder ? formValuesFromEntries(entries, selectedOrder.id) : emptyCostFormValues()
    ));
    const orderEntries = useMemo(
        () => entries.filter((entry) => entry.orderId === selectedOrder?.id),
        [entries, selectedOrder?.id],
    );
    const automaticValues = useMemo(() => automaticCostValues(selectedOrder), [selectedOrder]);
    const inputFields = useMemo(
        () => LEDGER_MANUAL_FIELDS.filter((field) => (
            field.key !== "purchaseCostKrw" || !selectedOrder?.sourcingLifeActualPayment
        )),
        [selectedOrder],
    );
    const currentRow = useMemo(
        () => selectedOrder ? toLedgerRow(selectedOrder, entries) : null,
        [entries, selectedOrder],
    );
    const open = controlledOpen ?? internalOpen;

    const projectedCosts = useMemo(() => {
        return LEDGER_MANUAL_FIELDS.reduce<CostValues>((result, field) => {
            const automaticValue = automaticValues[field.key];
            result[field.key] = automaticValue ?? parseLedgerManualValue(field.key, formValues[field.key]);
            return result;
        }, emptyCostValues());
    }, [automaticValues, formValues]);

    const projectedProfit = selectedOrder && projectedCosts.purchaseCostKrw !== null
        ? selectedOrder.expectedSettlement
            + getLedgerNetPaymentShippingIncome(selectedOrder)
            - projectedCosts.purchaseCostKrw
            - (projectedCosts.internationalShippingFee ?? 0)
            - (projectedCosts.freightShippingFee ?? 0)
            - (projectedCosts.customsTax ?? 0)
        : null;
    const projectedProfitRate = selectedOrder && projectedProfit !== null && selectedOrder.paymentPrice > 0
        ? (projectedProfit / selectedOrder.paymentPrice) * 100
        : null;

    const setOpen = (nextOpen: boolean) => {
        if (controlledOpen === undefined) setInternalOpen(nextOpen);
        onOpenChange?.(nextOpen);
    };

    const handleSave = () => {
        if (!selectedOrder) return;

        for (const field of LEDGER_MANUAL_FIELDS) {
            if (automaticValues[field.key] !== null) continue;

            const rawValue = formValues[field.key].trim();
            if (!rawValue) continue;
            if (parseLedgerManualValue(field.key, rawValue) === null) {
                toast.error(`${field.label}은 0 이상의 금액으로 입력해 주세요.`);
                return;
            }
        }

        LEDGER_MANUAL_FIELDS.forEach((field) => {
            if (automaticValues[field.key] !== null) return;

            const value = parseLedgerManualValue(field.key, formValues[field.key]);
            if (value === null) {
                removeEntry(selectedOrder.id, field.key);
                return;
            }
            saveEntry({ orderId: selectedOrder.id, field: field.key, value });
        });

        toast.success("비용을 저장했습니다. 장부와 예상 마진에 반영됩니다.");
        setOpen(false);
    };

    const currentCosts: CostValues = {
        purchaseCostKrw: currentRow?.purchaseCost ?? null,
        internationalShippingFee: manualCostValue(orderEntries, "internationalShippingFee"),
        freightShippingFee: manualCostValue(orderEntries, "freightShippingFee"),
        customsTax: manualCostValue(orderEntries, "customsTax"),
    };

    return (
        <>
            {!hideTrigger && (
                <Button
                    type="button"
                    variant="outline"
                    className={cn("shrink-0", triggerClassName)}
                    onClick={() => {
                        if (selectedOrder) setFormValues(formValuesFromEntries(entries, selectedOrder.id));
                        setOpen(true);
                    }}
                >
                    <Plus className="size-4" />
                    {triggerLabel}
                </Button>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-lg">
                    <DialogHeader className="gap-1 px-6 pt-6 text-left">
                        <DialogTitle className="text-lg font-black">비용 관리</DialogTitle>
                        <DialogDescription>
                            자동으로 계산되지 않은 비용을 입력하면 장부와 예상 마진에 반영됩니다.
                        </DialogDescription>
                    </DialogHeader>

                    {selectedOrder && (
                        <div className="space-y-5 px-6 pb-6">
                            <div className="flex items-start justify-between gap-4 border-b pb-3">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-bold">{selectedOrder.product.name}</p>
                                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                                        {MARKET_LABELS[selectedOrder.marketType]} · {selectedOrder.marketOrderId}
                                    </p>
                                </div>
                                <span className="shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold text-muted-foreground">
                                    {selectedOrder.product.quantity}개
                                </span>
                            </div>

                            <section className="rounded-lg bg-foreground p-4 text-background shadow-sm">
                                <div className="flex items-center justify-between border-b border-background/15 pb-3 text-sm">
                                    <span className="text-background/65">정산예정금액</span>
                                    <strong className="font-mono text-base">{formatWon(selectedOrder.expectedSettlement)}</strong>
                                </div>
                                <div className="space-y-2 py-3 text-xs">
                                    <div className="flex items-center justify-between gap-4">
                                        <span className="text-background/60">+ 결제배송비 (3.3% 차감)</span>
                                        <span className="font-mono text-emerald-300">
                                            {formatSignedIncome(getLedgerNetPaymentShippingIncome(selectedOrder))}
                                        </span>
                                    </div>
                                    {LEDGER_MANUAL_FIELDS.map((field) => (
                                        <div key={field.key} className="flex items-center justify-between gap-4">
                                            <span className="text-background/60">- {field.label}</span>
                                            <span className="font-mono text-background/80">{formatSignedCost(currentCosts[field.key])}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-end justify-between border-t border-background/15 pt-3">
                                    <span className="text-sm font-bold">현재 예상 마진</span>
                                    <div className="text-right">
                                        <strong className={cn("block font-mono text-lg", currentRow?.profit !== null && currentRow?.profit !== undefined ? "text-emerald-300" : "text-background/50")}>
                                            {formatWon(currentRow?.profit ?? null)}
                                        </strong>
                                        <span className="text-[10px] text-background/50">
                                            {currentRow?.profitRate === null || currentRow?.profitRate === undefined
                                                ? "구매금액 입력 필요"
                                                : `마진율 ${(currentRow.profitRate * 100).toFixed(1)}%`}
                                        </span>
                                    </div>
                                </div>
                            </section>

                            <section>
                                <div className="mb-3 flex items-end justify-between gap-4">
                                    <div>
                                        <h3 className="text-sm font-black">비용 입력</h3>
                                        <p className="mt-1 text-[11px] text-muted-foreground">
                                            결제된 구매금액은 제외되며 자동 반영된 금액은 수정할 수 없습니다.
                                        </p>
                                    </div>
                                    <span className="text-[10px] font-bold text-muted-foreground">단위 · 원</span>
                                </div>

                                <div className="divide-y border-y">
                                    {inputFields.map((field) => {
                                        const automaticValue = automaticValues[field.key];
                                        const isAutomatic = automaticValue !== null;

                                        return (
                                            <div key={field.key} className="grid grid-cols-[minmax(0,1fr)_9.5rem] items-center gap-4 py-3">
                                                <div className="min-w-0">
                                                    <Label htmlFor={`manual-cost-${field.key}`} className="text-xs font-bold">
                                                        {field.label}
                                                    </Label>
                                                    <p className="mt-1 text-[10px] text-muted-foreground">
                                                        {isAutomatic ? "소싱·주문 데이터 자동 반영" : "직접 입력 가능"}
                                                    </p>
                                                </div>
                                                <div className="relative">
                                                    <Input
                                                        id={`manual-cost-${field.key}`}
                                                        type="text"
                                                        inputMode="numeric"
                                                        pattern="[0-9]*"
                                                        value={isAutomatic ? automaticValue : formValues[field.key]}
                                                        onChange={(event) => setFormValues((current) => ({
                                                            ...current,
                                                            [field.key]: event.target.value.replace(/[^0-9]/g, ""),
                                                        }))}
                                                        placeholder="0"
                                                        disabled={isAutomatic}
                                                        className="h-9 pr-8 text-right font-mono text-sm tabular-nums disabled:opacity-70"
                                                    />
                                                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] text-muted-foreground">원</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>

                            <section className={cn(
                                "flex items-end justify-between gap-4 rounded-lg border px-4 py-3",
                                projectedProfit !== null && projectedProfit < 0
                                    ? "border-rose-200 bg-rose-50"
                                    : "border-emerald-200 bg-emerald-50",
                            )}>
                                <div>
                                    <p className="text-xs font-black">반영 후 예상 마진</p>
                                    <p className="mt-1 text-[10px] text-muted-foreground">입력 중인 금액을 실시간 계산합니다.</p>
                                </div>
                                <div className="text-right">
                                    <strong className={cn("block font-mono text-xl font-black tabular-nums", marginTone(projectedProfit))}>
                                        {formatWon(projectedProfit)}
                                    </strong>
                                    <span className="text-[10px] text-muted-foreground">
                                        {projectedProfitRate === null ? "구매금액 입력 필요" : `마진율 ${projectedProfitRate.toFixed(1)}%`}
                                    </span>
                                </div>
                            </section>
                        </div>
                    )}

                    <DialogFooter className="border-t bg-muted/30 px-6 py-4 sm:justify-end">
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>취소</Button>
                        <Button type="button" onClick={handleSave}>저장</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
