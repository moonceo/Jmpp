"use client";

import { useState } from "react";
import { Check, Clock3, History, PauseCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getOrderHistory, type OrderHistoryStep } from "@/lib/order-history";
import { cn } from "@/lib/utils";
import type { Order } from "@/types/order";

function StepIcon({ step }: { step: OrderHistoryStep }) {
    if (step.state === "completed") {
        return <Check className="size-3.5" strokeWidth={3} />;
    }

    if (step.state === "current") {
        return <Clock3 className="size-3.5" />;
    }

    return <Clock3 className="size-3.5" />;
}

export function OrderHistoryDialog({ order }: { order: Order }) {
    const [open, setOpen] = useState(false);
    const history = getOrderHistory(order);
    const isCanceled = order.status === "CANCELED";
    const isOnHold = order.status === "ON_HOLD";

    return (
        <>
            <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-[29px] w-full whitespace-nowrap border-border bg-card px-1.5 text-xs text-foreground shadow-none hover:bg-muted"
                onClick={() => setOpen(true)}
                aria-label={`${order.product.name} 주문 히스토리`}
            >
                <History className="size-3.5" />
                주문 히스토리
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader className="pr-6">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="font-mono text-[11px]">{order.marketOrderId}</Badge>
                            <Badge variant="secondary">수량 {order.product.quantity}</Badge>
                        </div>
                        <DialogTitle className="line-clamp-2 text-lg leading-7">{order.product.name}</DialogTitle>
                        <DialogDescription>
                            이 상품에서 지금까지 실제로 확인된 처리 이력입니다.
                        </DialogDescription>
                    </DialogHeader>

                    {(isCanceled || isOnHold) && (
                        <div className={cn(
                            "flex items-start gap-3 rounded-lg border px-4 py-3",
                            isCanceled ? "border-destructive/30 bg-destructive/5" : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30",
                        )}>
                            {isCanceled ? <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" /> : <PauseCircle className="mt-0.5 size-5 shrink-0 text-amber-600" />}
                            <div>
                                <div className="text-sm font-bold">{isCanceled ? "주문이 취소되었습니다" : "처리가 보류되었습니다"}</div>
                                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                                    {order.failureReason ?? order.sellerCancelReason ?? "상세 사유를 확인해 주세요."}
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="rounded-xl border bg-muted/20 p-4 sm:p-5">
                        <ol className="space-y-0">
                            {history.map((step, index) => (
                                <li key={step.id} className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-3 pb-5 last:pb-0">
                                    {index < history.length - 1 && (
                                        <span
                                            aria-hidden="true"
                                            className={cn(
                                                "absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px",
                                                "bg-foreground/35",
                                            )}
                                        />
                                    )}
                                    <span className={cn(
                                        "relative z-10 flex size-8 items-center justify-center rounded-full border bg-background",
                                        step.state === "completed" && "border-foreground bg-foreground text-background",
                                        step.state === "current" && "border-foreground ring-4 ring-foreground/10",
                                    )}>
                                        <StepIcon step={step} />
                                    </span>
                                    <div className="min-w-0 pt-0.5">
                                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold">{step.label}</span>
                                                {step.state === "current" && <Badge className="h-5 px-1.5 text-[10px]">현재 단계</Badge>}
                                            </div>
                                            <time className="font-mono text-[11px] text-muted-foreground">{step.occurredAt ?? "시간 미수신"}</time>
                                        </div>
                                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
                                        {step.data.length > 0 && (
                                            <dl className="mt-2 grid gap-x-4 gap-y-1.5 rounded-md border bg-background/80 px-3 py-2 sm:grid-cols-2">
                                                {step.data.map((item) => (
                                                    <div key={`${step.id}-${item.label}`} className="flex min-w-0 items-baseline justify-between gap-3 text-xs">
                                                        <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
                                                        <dd className="truncate text-right font-semibold text-foreground" title={item.value}>{item.value}</dd>
                                                    </div>
                                                ))}
                                            </dl>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ol>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
