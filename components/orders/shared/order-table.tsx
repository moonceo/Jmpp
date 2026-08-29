"use client";

import * as React from "react";
import {
    ColumnDef,
    ColumnFiltersState,
    SortingState,
    VisibilityState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import Image from "next/image";
import { ManualLedgerEntryDialog } from "@/components/ledger/manual-ledger-entry-dialog";
import { RecipientEditDialog } from "@/components/orders/recipient-edit-dialog";
import { calculateSourcingMargin } from "@/components/orders/sourcing-workflow-dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { MARKET_LABELS } from "@/lib/constants/orders";
import { calculateOrderMargin } from "@/lib/order-margin";
import { getOrderShippingInformation } from "@/lib/order-shipping-information";
import { SOURCING_REFUND_STATUS_LABELS } from "@/lib/sourcing-refund";
import { resolveSourcingProgressStage } from "@/lib/sourcing-progress";
import { cn } from "@/lib/utils";
import { Order, Recipient } from "@/types/order";

const ORDER_COLUMN_WIDTHS: Record<string, number> = {
    select: 40,
    process: 82,
    progressStage: 104,
    orderDate: 160,
    productInfo: 300,
    marginInfo: 160,
    buyerInfo: 94,
    deliveryInfo: 230,
    sourcingLifeInfo: 94,
    invoice: 280,
};

function formatCurrency(value?: number) {
    return typeof value === "number" ? `${value.toLocaleString()}원` : "-";
}

function formatSignedCurrency(value: number) {
    return `${value < 0 ? "-" : ""}${Math.abs(value).toLocaleString()}원`;
}

function isCustomsCodeValid(code?: string) {
    return Boolean(code?.trim() && /^P\d{12}$/.test(code.trim().toUpperCase()));
}

function DetailField({ label, value, inline = false }: { label: string; value?: React.ReactNode; inline?: boolean }) {
    if (inline) {
        return (
            <div className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
                <span className="min-w-0 truncate text-xs font-medium text-foreground">{value || "-"}</span>
            </div>
        );
    }

    return (
        <div className="min-w-0">
            <div className="text-xs font-semibold text-muted-foreground">{label}</div>
            <div className="mt-0.5 min-w-0 truncate text-xs font-medium text-foreground">{value || "-"}</div>
        </div>
    );
}

function OrderDetailPanel({
    order,
    onSaveRecipientInfo,
    renderDetailActions,
}: {
    order: Order;
    onSaveRecipientInfo?: (order: Order, recipient: Recipient) => void;
    renderDetailActions?: (order: Order) => React.ReactNode;
}) {
    const customsCode = order.recipient.personalCustomsCode?.trim();
    const shippingInformation = getOrderShippingInformation(order);
    const isExternalPurchase = resolveSourcingProgressStage(order) === "EXTERNAL_PURCHASE";
    const hasMatchedSourcingProduct = Boolean(order.sourcingLifeMatch);
    const sourcingProductCost = calculateOrderMargin(order)?.sourcingCost;
    const marginCalculation = hasMatchedSourcingProduct && typeof sourcingProductCost === "number"
        ? calculateSourcingMargin(order, sourcingProductCost)
        : undefined;

    return (
        <div className="grid items-start gap-3 bg-muted/70 p-4 text-xs xl:grid-cols-[minmax(320px,22%)_minmax(0,1fr)_minmax(260px,18%)]">
            <div className="order-1 min-w-0 space-y-3 xl:order-2">
                <Card className="gap-3 rounded-md p-3">
                <div className="text-sm font-bold text-foreground">{hasMatchedSourcingProduct ? "상품 비교" : "주문상품"}</div>
                <div className="grid gap-3">
                    <div className="min-w-0 rounded-md border border-border bg-card p-3">
                        <Badge variant="outline" className="mb-3 border-border bg-muted text-xs font-semibold text-foreground">
                            주문상품
                        </Badge>
                        <div className="flex min-w-0 gap-3">
                            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-border bg-card">
                                <Image src={order.product.thumbnail} alt={order.product.name} fill sizes="80px" className="object-cover" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="line-clamp-2 text-sm font-bold leading-5 text-foreground">{order.product.name}</div>
                                <div className="mt-1 truncate text-xs text-muted-foreground">{order.product.optionName}</div>
                                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-2">
                                    <DetailField label="수량" value={`${order.product.quantity}개`} />
                                    <DetailField label="단가" value={formatCurrency(order.product.unitPrice)} />
                                    <DetailField label="결제금액" value={formatCurrency(order.paymentPrice)} />
                                </div>
                            </div>
                        </div>
                        <div className="mt-3 grid gap-2 border-t border-border pt-2 sm:grid-cols-2">
                            <DetailField label="주문일시" value={order.orderDate} />
                            <DetailField label="마켓 / 스토어명" value={`${MARKET_LABELS[order.marketType]} / ${order.storeName}`} />
                        </div>
                    </div>

                    {hasMatchedSourcingProduct ? (
                    <div className="min-w-0 rounded-md border border-border bg-card p-3">
                        <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
                            <Badge variant="outline" className="shrink-0 border-border bg-muted text-xs font-semibold text-foreground">
                                소싱상품
                            </Badge>
                            {isExternalPurchase ? (
                                <Badge variant="outline" className="border-border bg-muted text-xs font-semibold text-foreground">
                                    직접구매
                                </Badge>
                            ) : (
                                <div className="flex min-w-0 items-center gap-1.5">
                                    <span className="shrink-0 text-xs font-semibold text-muted-foreground">소싱라이프 주문번호</span>
                                    <span className="min-w-0 truncate font-mono font-semibold text-foreground">{order.sourcingLifeOrderId || "-"}</span>
                                </div>
                            )}
                        </div>
                        {isExternalPurchase ? (
                            <div className="flex items-start gap-3 rounded-md border border-border bg-muted/70 px-3 py-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card text-sm font-bold text-foreground ring-1 ring-ring">외</div>
                                <div className="min-w-0">
                                    <div className="text-xs font-bold text-foreground">외부 구매처 결제완료</div>
                                    <div className="mt-1 text-xs leading-4 text-muted-foreground">
                                        소싱라이프를 거치지 않고 외부 구매처에서 결제한 주문입니다. 소싱라이프 상품과 주문번호는 생성되지 않습니다.
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="grid gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
                                    <div className="relative h-20 w-20 overflow-hidden rounded-md border border-border bg-card">
                                        {order.sourcingLifeMatch?.thumbnail ? (
                                            <Image src={order.sourcingLifeMatch.thumbnail} alt={order.sourcingLifeMatch.productName ?? order.product.name} fill sizes="80px" className="object-cover" />
                                        ) : (
                                            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">이미지 없음</div>
                                        )}
                                    </div>
                                    <div className="grid min-w-0 content-start gap-2">
                                        <DetailField label="상품명" value={order.sourcingLifeMatch?.productName} />
                                        <DetailField label="옵션명" value={order.sourcingLifeMatch?.optionName} />
                                        <div className="grid grid-cols-2 gap-2 border-t border-border pt-2">
                                            <DetailField label="수량" value={order.sourcingLifeMatch?.quantity ? `${order.sourcingLifeMatch.quantity}개` : "-"} />
                                            <DetailField label="소싱금액" value={formatCurrency(order.sourcingLifeActualPayment?.amount ?? order.sourcingLifeMatch?.estimatedCost)} />
                                        </div>
                                    </div>
                                </div>
                                {order.sourcingRefund ? (
                                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted px-3 py-2">
                                        <div>
                                            <div className="text-xs font-semibold text-muted-foreground">소싱환불</div>
                                            <div className="mt-0.5 text-xs font-bold text-foreground">
                                                ¥{order.sourcingRefund.refundFeeCny.toFixed(2)} · refundId {order.sourcingRefund.providerRefundId}
                                            </div>
                                        </div>
                                        <Badge variant="outline" className="bg-card text-xs font-semibold">
                                            {SOURCING_REFUND_STATUS_LABELS[order.sourcingRefund.status]}
                                        </Badge>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>
                    ) : null}
                </div>
            </Card>

            {hasMatchedSourcingProduct ? (
                <Card className="gap-3 rounded-md p-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-bold text-foreground">마진계산</div>
                        {marginCalculation ? (
                            <Badge variant={marginCalculation.expectedMargin >= 0 ? "default" : "outline"} className="shrink-0 text-xs font-semibold">
                                {marginCalculation.expectedMargin >= 0 ? "수익 예상" : "역마진 예상"}
                            </Badge>
                        ) : null}
                    </div>
                    {marginCalculation ? (
                        <div className="grid overflow-hidden rounded-md border border-border bg-border gap-px">
                            <div className="bg-card p-3">
                                <div className="mb-2 text-xs font-bold text-foreground">매출 · 정산</div>
                                <dl className="grid gap-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <dt className="text-muted-foreground">마켓 결제금액</dt>
                                        <dd className="font-semibold text-foreground">{formatCurrency(marginCalculation.marketPaymentAmount)}</dd>
                                    </div>
                                    <div className="flex items-center justify-between gap-3">
                                        <dt className="text-muted-foreground">{MARKET_LABELS[order.marketType]} 판매 수수료</dt>
                                        <dd className="font-semibold text-foreground">-{formatCurrency(marginCalculation.marketFee)}</dd>
                                    </div>
                                    <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                                        <dt className="font-semibold text-foreground">정산예상금액</dt>
                                        <dd className="font-bold text-foreground">{formatCurrency(marginCalculation.expectedSettlement)}</dd>
                                    </div>
                                </dl>
                            </div>

                            <div className="bg-card p-3">
                                <div className="mb-2 text-xs font-bold text-foreground">예상 소싱비용</div>
                                <dl className="grid gap-2 sm:grid-cols-2">
                                    <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">소싱상품 원가</dt><dd className="font-semibold text-foreground">{formatCurrency(marginCalculation.productCost)}</dd></div>
                                    <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">소싱처 이용료</dt><dd className="font-semibold text-foreground">{formatCurrency(marginCalculation.sourcingServiceFee)}</dd></div>
                                    <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">환전 수수료</dt><dd className="font-semibold text-foreground">{formatCurrency(marginCalculation.currencyExchangeFee)}</dd></div>
                                    <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">예상 배송비</dt><dd className="font-semibold text-foreground">{formatCurrency(marginCalculation.estimatedForwarderShippingFee)}</dd></div>
                                    <div className="flex items-center justify-between gap-3 border-t border-border pt-2 sm:col-span-2">
                                        <dt className="font-semibold text-foreground">예상 총비용</dt>
                                        <dd className="font-bold text-foreground">{formatCurrency(marginCalculation.sourcingTotalCost + marginCalculation.estimatedForwarderShippingFee)}</dd>
                                    </div>
                                </dl>
                            </div>

                            <div className="flex flex-col justify-between bg-muted/50 p-3">
                                <div>
                                    <div className="text-xs font-semibold text-muted-foreground">예상 순이익</div>
                                    <div className="mt-1 text-xl font-black tracking-tight text-foreground">{formatSignedCurrency(marginCalculation.expectedMargin)}</div>
                                </div>
                                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                                    <span className="font-semibold text-muted-foreground">마진율</span>
                                    <span className="text-lg font-black text-foreground">{marginCalculation.expectedMarginRate.toFixed(1)}%</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-md border border-dashed border-border bg-muted px-3 py-4 text-center text-xs text-muted-foreground">
                            소싱상품 금액이 확인되면 마진을 계산합니다.
                        </div>
                    )}
                </Card>
            ) : null}

            </div>

            <div className="order-2 min-w-0 space-y-3 xl:order-1">
                <Card className="gap-3 rounded-md p-3">
                    <div className="text-sm font-bold text-foreground">구매자 · 배송정보</div>
                    <div className="grid gap-3">
                        <div className="grid content-start gap-2 rounded-md border border-border bg-muted/40 p-3">
                            <div className="mb-1 text-xs font-bold text-foreground">구매자</div>
                            <DetailField label="이름" value={order.buyerName} inline />
                            <DetailField label="연락처" value={order.buyerPhone} inline />
                        </div>
                        <div className="rounded-md border border-border bg-muted/40 p-3">
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <div className="text-xs font-bold text-foreground">수령 정보</div>
                                <RecipientEditDialog order={order} onSaveRecipientInfo={onSaveRecipientInfo} />
                            </div>
                            <div className="grid gap-2">
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <DetailField label="이름" value={order.recipient.name} inline />
                                    <DetailField label="연락처" value={order.recipient.phone} inline />
                                </div>
                                <DetailField label="주소" value={[order.recipient.zipCode, order.recipient.address, order.recipient.detailAddress].filter(Boolean).join(" ")} />
                                <div>
                                    <div className="text-xs font-semibold text-muted-foreground">통관부호확인</div>
                                    <div className="mt-1 flex min-w-0 items-center gap-1.5">
                                        <span className="truncate font-mono text-xs font-medium text-foreground">{customsCode || "-"}</span>
                                        <Badge variant="outline" className="shrink-0 border-border bg-muted text-xs text-foreground">
                                            {isCustomsCodeValid(customsCode) ? "통관부호 일치" : "통관부호 불일치"}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>

                <Card className="gap-3 rounded-md p-3">
                    <div className="text-sm font-bold text-foreground">택배정보</div>
                    <div className="grid gap-2">
                        <DetailField
                            label="국내 송장번호"
                            value={shippingInformation.domesticTrackingNumber
                                ? `${shippingInformation.domesticCarrier ?? "택배사 미확인"} ${shippingInformation.domesticTrackingNumber}`
                                : "-"}
                            inline
                        />
                        {shippingInformation.marketProcessingLabel && (
                            <Badge variant="outline" className="w-fit">
                                {shippingInformation.marketProcessingLabel}
                            </Badge>
                        )}
                        <DetailField
                            label="중국 송장번호"
                            value={shippingInformation.chinaTrackingNumber
                                ? `${shippingInformation.chinaCarrier ?? "택배사 미확인"} ${shippingInformation.chinaTrackingNumber}`
                                : "-"}
                            inline
                        />
                    </div>
                </Card>
            </div>

            <Card className="order-3 gap-3 self-start rounded-md p-3 xl:sticky xl:top-3">
                <div className="text-sm font-bold text-foreground">처리하기</div>
                {renderDetailActions?.(order) ?? (
                    <div className="rounded-md border border-dashed border-border bg-muted px-3 py-4 text-center text-xs text-muted-foreground">
                        현재 단계에서 처리할 작업이 없습니다.
                    </div>
                )}
                <ManualLedgerEntryDialog
                    orders={[order]}
                    initialOrderId={order.id}
                    triggerLabel="비용 추가"
                    triggerClassName="h-[29px] w-full px-1.5 text-xs shadow-none"
                />
            </Card>
        </div>
    );
}

interface OrderTableProps {
    data: Order[];
    columns: ColumnDef<Order>[];
    highlightedOrderIds?: ReadonlySet<string>;
    onRowSelectionChange?: (rowSelection: Record<string, boolean>) => void;
    onSaveRecipientInfo?: (order: Order, recipient: Recipient) => void;
    renderDetailActions?: (order: Order) => React.ReactNode;
    selectable?: boolean;
}

export function OrderTable({
    data,
    columns,
    highlightedOrderIds,
    onRowSelectionChange,
    onSaveRecipientInfo,
    renderDetailActions,
    selectable = false,
}: OrderTableProps) {
    const [sorting, setSorting] = React.useState<SortingState>([{ id: "orderDate", desc: true }]);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
        select: selectable,
    });
    const [rowSelection, setRowSelection] = React.useState({});
    const [expandedOrderId, setExpandedOrderId] = React.useState<string | null>(null);

    React.useEffect(() => {
        setColumnVisibility((current) => ({
            ...current,
            select: selectable,
        }));
        if (!selectable) {
            setRowSelection({});
            onRowSelectionChange?.({});
        }
    }, [onRowSelectionChange, selectable]);

    React.useEffect(() => {
        setRowSelection({});
        setExpandedOrderId(null);
        onRowSelectionChange?.({});
    }, [data, onRowSelectionChange]);

    const table = useReactTable({
        data,
        columns,
        getRowId: (row) => row.id,
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        onColumnVisibilityChange: setColumnVisibility,
        onRowSelectionChange: (updaterOrValue) => {
            const next = typeof updaterOrValue === "function" ? updaterOrValue(rowSelection) : updaterOrValue;
            setRowSelection(next);
            onRowSelectionChange?.(next as Record<string, boolean>);
        },
        state: {
            sorting,
            columnFilters,
            columnVisibility,
            rowSelection,
        },
    });

    const columnWidth = (columnId: string) => ORDER_COLUMN_WIDTHS[columnId] ?? 120;
    const columnClassName = (columnId: string) => cn(
        columnId === "select" && "px-0 text-center [&>button]:mx-auto",
    );
    const shouldIgnoreRowClick = (target: EventTarget | null) => (
        target instanceof Element
        && Boolean(target.closest("button,a,input,textarea,select,[role='button'],[data-radix-popper-content-wrapper]"))
    );

    return (
        <div className="w-full space-y-2">
            <div className="overflow-x-auto rounded-md border border-border bg-card shadow-sm dark:bg-card">
                <Table className="min-w-full table-fixed" style={{ width: table.getVisibleLeafColumns().reduce((total, column) => total + columnWidth(column.id), 0) }}>
                    <colgroup>
                        {table.getVisibleLeafColumns().map((column) => (
                            <col key={column.id} style={{ width: columnWidth(column.id) }} />
                        ))}
                    </colgroup>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id} className="border-b border-border bg-muted hover:bg-muted">
                                {headerGroup.headers.map((header) => (
                                    <TableHead key={header.id} className={cn("sticky top-0 z-10 h-9 overflow-hidden bg-muted text-xs font-semibold text-muted-foreground text-ellipsis whitespace-nowrap", columnClassName(header.column.id))} style={{ width: columnWidth(header.column.id) }}>
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(header.column.columnDef.header, header.getContext())}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows.length ? (
                            table.getRowModel().rows.map((row) => (
                                <React.Fragment key={row.id}>
                                    <TableRow
                                        data-state={row.getIsSelected() && "selected"}
                                        data-transitioned={highlightedOrderIds?.has(row.original.id) || undefined}
                                        className={cn(
                                            "group cursor-pointer border-b border-border transition-colors odd:bg-card even:bg-muted/35 hover:bg-muted/60 data-[state=selected]:bg-muted",
                                            expandedOrderId === row.id && "bg-muted/80",
                                            highlightedOrderIds?.has(row.original.id) && "!bg-pink-50 hover:!bg-pink-100/80 data-[state=selected]:!bg-pink-100 dark:!bg-pink-950/35 dark:hover:!bg-pink-950/50 dark:data-[state=selected]:!bg-pink-950/55",
                                        )}
                                        onClick={(event) => {
                                            if (shouldIgnoreRowClick(event.target)) return;
                                            setExpandedOrderId((current) => (current === row.id ? null : row.id));
                                        }}
                                    >
                                        {row.getVisibleCells().map((cell) => (
                                            <TableCell key={cell.id} className={cn("overflow-hidden break-words px-2.5 py-2 align-top whitespace-normal", columnClassName(cell.column.id))} style={{ width: columnWidth(cell.column.id) }}>
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                    {expandedOrderId === row.id && (
                                        <TableRow className="border-b border-border bg-muted hover:bg-muted">
                                            <TableCell colSpan={row.getVisibleCells().length} className="p-0">
                                                <OrderDetailPanel order={row.original} onSaveRecipientInfo={onSaveRecipientInfo} renderDetailActions={renderDetailActions} />
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </React.Fragment>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-24 text-center">
                                    주문이 없습니다.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <div className="px-1 py-1.5 text-xs text-muted-foreground">
                총 {table.getFilteredRowModel().rows.length}개의 주문을 모두 표시합니다.
            </div>
        </div>
    );
}
