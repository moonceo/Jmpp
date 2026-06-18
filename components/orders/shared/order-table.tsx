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
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { MARKET_LABELS } from "@/lib/constants/orders";
import { cn } from "@/lib/utils";
import { Order, Recipient } from "@/types/order";

const ORDER_COLUMN_WIDTHS: Record<string, number> = {
    select: 40,
    process: 82,
    progressStage: 104,
    orderDate: 72,
    productInfo: 300,
    buyerInfo: 94,
    deliveryInfo: 230,
    marketAccount: 84,
    sourcingLifeInfo: 88,
    invoice: 150,
};

function formatCurrency(value?: number) {
    return typeof value === "number" ? `${value.toLocaleString()}원` : "-";
}

function isCustomsCodeValid(code?: string) {
    return Boolean(code?.trim() && /^P\d{12}$/.test(code.trim().toUpperCase()));
}

function DetailField({ label, value, inline = false }: { label: string; value?: React.ReactNode; inline?: boolean }) {
    if (inline) {
        return (
            <div className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 text-[11px] font-semibold text-slate-400">{label}</span>
                <span className="min-w-0 truncate text-xs font-medium text-slate-800">{value || "-"}</span>
            </div>
        );
    }

    return (
        <div className="min-w-0">
            <div className="text-[11px] font-semibold text-slate-400">{label}</div>
            <div className="mt-0.5 min-w-0 truncate text-xs font-medium text-slate-800">{value || "-"}</div>
        </div>
    );
}

function RecipientEditDialog({ order, onSaveRecipientInfo }: { order: Order; onSaveRecipientInfo?: (order: Order, recipient: Recipient) => void }) {
    const [open, setOpen] = React.useState(false);
    const [name, setName] = React.useState(order.recipient.name);
    const [phone, setPhone] = React.useState(order.recipient.phone);
    const [zipCode, setZipCode] = React.useState(order.recipient.zipCode ?? "");
    const [address, setAddress] = React.useState(order.recipient.address);
    const [detailAddress, setDetailAddress] = React.useState(order.recipient.detailAddress ?? "");
    const [customsCode, setCustomsCode] = React.useState(order.recipient.personalCustomsCode ?? "");
    const canSave = Boolean(name.trim() && phone.trim() && address.trim());

    const openEditor = () => {
        setName(order.recipient.name);
        setPhone(order.recipient.phone);
        setZipCode(order.recipient.zipCode ?? "");
        setAddress(order.recipient.address);
        setDetailAddress(order.recipient.detailAddress ?? "");
        setCustomsCode(order.recipient.personalCustomsCode ?? "");
        setOpen(true);
    };

    const save = () => {
        if (!canSave || !onSaveRecipientInfo) return;

        onSaveRecipientInfo(order, {
            ...order.recipient,
            name: name.trim(),
            phone: phone.trim(),
            zipCode: zipCode.trim() || undefined,
            address: address.trim(),
            detailAddress: detailAddress.trim() || undefined,
            personalCustomsCode: customsCode.trim().toUpperCase() || undefined,
        });
        setOpen(false);
    };

    return (
        <>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={openEditor} disabled={!onSaveRecipientInfo}>
                수정
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>배송정보 수정</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-2">
                        <div className="grid grid-cols-2 gap-2">
                            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="수취인명" />
                            <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="연락처" />
                        </div>
                        <Input value={zipCode} onChange={(event) => setZipCode(event.target.value)} placeholder="우편번호" />
                        <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="주소" />
                        <Input value={detailAddress} onChange={(event) => setDetailAddress(event.target.value)} placeholder="상세주소" />
                        <Input value={customsCode} onChange={(event) => setCustomsCode(event.target.value.toUpperCase())} placeholder="개인통관부호" className="font-mono" />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>닫기</Button>
                        <Button onClick={save} disabled={!canSave}>저장</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function OrderDetailPanel({ order, onSaveRecipientInfo }: { order: Order; onSaveRecipientInfo?: (order: Order, recipient: Recipient) => void }) {
    const customsCode = order.recipient.personalCustomsCode?.trim();
    const changedTrackingNumber = order.domesticInvoice?.changedTrackingNumber?.trim();
    const hasSourcingInfo = Boolean(order.sourcingLifeOrderId || order.sourcingLifeMatch || order.sourcingLifeActualPayment);

    return (
        <div className="grid gap-3 bg-slate-50/70 p-4 text-xs lg:grid-cols-[1.35fr_0.68fr_1.2fr_0.78fr]">
            <section className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-3 text-sm font-bold text-slate-900">주문상품</div>
                <div className="flex min-w-0 gap-3">
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
                        <Image src={order.product.thumbnail} alt={order.product.name} fill sizes="64px" className="object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-sm font-bold leading-5 text-slate-900">{order.product.name}</div>
                        <div className="mt-1 truncate text-xs text-slate-500">{order.product.optionName}</div>
                        <div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2">
                            <DetailField label="수량" value={`${order.product.quantity}개`} />
                            <DetailField label="단가" value={formatCurrency(order.product.unitPrice)} />
                            <DetailField label="결제금액" value={formatCurrency(order.paymentPrice)} />
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2">
                            <DetailField label="주문일시" value={order.orderDate} />
                            <DetailField label="마켓 / 스토어명" value={`${MARKET_LABELS[order.marketType]} / ${order.storeName}`} />
                        </div>
                    </div>
                </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-3 text-sm font-bold text-slate-900">구매자</div>
                <div className="grid gap-2">
                    <DetailField label="이름" value={order.buyerName} inline />
                    <DetailField label="연락처" value={order.buyerPhone} inline />
                </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-sm font-bold text-slate-900">배송정보</div>
                    <RecipientEditDialog order={order} onSaveRecipientInfo={onSaveRecipientInfo} />
                </div>
                <div className="grid gap-2">
                    <div className="grid grid-cols-2 gap-2">
                        <DetailField label="이름" value={order.recipient.name} inline />
                        <DetailField label="연락처" value={order.recipient.phone} inline />
                    </div>
                    <DetailField label="주소" value={[order.recipient.zipCode, order.recipient.address, order.recipient.detailAddress].filter(Boolean).join(" ")} />
                    <div>
                        <div className="text-[11px] font-semibold text-slate-400">통관부호확인</div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5">
                            <span className="truncate font-mono text-xs font-medium text-slate-800">{customsCode || "-"}</span>
                            <Badge variant="outline" className={cn("shrink-0 text-[10px]", isCustomsCodeValid(customsCode) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
                                {isCustomsCodeValid(customsCode) ? "통관부호 일치" : "통관부호 불일치"}
                            </Badge>
                        </div>
                    </div>
                </div>
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-3">
                <div className="mb-3 text-sm font-bold text-slate-900">택배정보</div>
                <div className="min-w-0 truncate text-xs font-semibold text-slate-900">
                    {order.domesticInvoice ? `${order.domesticInvoice.carrier}  ${order.domesticInvoice.trackingNumber}` : "-"}
                </div>
                {changedTrackingNumber && (
                    <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
                        <div className="text-[11px] font-semibold text-amber-700">변경된 송장번호</div>
                        <div className="mt-0.5 font-mono text-xs font-bold text-amber-800">{changedTrackingNumber}</div>
                    </div>
                )}
            </section>

            <section className="rounded-md border border-slate-200 bg-white p-3 lg:col-span-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-bold text-slate-900">소싱상품</div>
                    <div className="flex min-w-0 items-center gap-1.5 text-xs">
                        <span className="shrink-0 text-[11px] font-semibold text-slate-400">소싱라이프 주문번호</span>
                        <span className="min-w-0 truncate font-mono font-semibold text-slate-800">{order.sourcingLifeOrderId || "-"}</span>
                    </div>
                </div>
                {hasSourcingInfo ? (
                    <div className="grid gap-3 lg:grid-cols-[72px_minmax(0,1fr)]">
                        <div className="relative h-[72px] w-[72px] overflow-hidden rounded-md border border-slate-200 bg-white">
                            {order.sourcingLifeMatch?.thumbnail ? (
                                <Image src={order.sourcingLifeMatch.thumbnail} alt={order.sourcingLifeMatch.productName ?? order.product.name} fill sizes="80px" className="object-cover" />
                            ) : (
                                <div className="flex h-full items-center justify-center text-[11px] text-slate-400">이미지 없음</div>
                            )}
                        </div>
                        <div className="grid min-w-0 content-start gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                                <span className="shrink-0 text-[11px] font-semibold text-slate-400">상품명</span>
                                <span className="min-w-0 truncate text-xs font-medium text-slate-800">{order.sourcingLifeMatch?.productName || "-"}</span>
                            </div>
                            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                                <div className="flex min-w-0 items-center gap-1.5">
                                    <span className="shrink-0 text-[11px] font-semibold text-slate-400">옵션명</span>
                                    <span className="min-w-0 truncate text-xs font-medium text-slate-800">{order.sourcingLifeMatch?.optionName || "-"}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="shrink-0 text-[11px] font-semibold text-slate-400">수량</span>
                                    <span className="text-xs font-medium text-slate-800">{order.sourcingLifeMatch?.quantity ? `${order.sourcingLifeMatch.quantity}개` : "-"}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="shrink-0 text-[11px] font-semibold text-slate-400">소싱금액</span>
                                    <span className="text-xs font-medium text-slate-800">{formatCurrency(order.sourcingLifeActualPayment?.amount ?? order.sourcingLifeMatch?.estimatedCost)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                        소싱라이프 연결 정보가 없습니다.
                    </div>
                )}
            </section>
        </div>
    );
}

interface OrderTableProps {
    data: Order[];
    columns: ColumnDef<Order>[];
    onRowSelectionChange?: (rowSelection: Record<string, boolean>) => void;
    onSaveRecipientInfo?: (order: Order, recipient: Recipient) => void;
    selectable?: boolean;
}

export function OrderTable({
    data,
    columns,
    onRowSelectionChange,
    onSaveRecipientInfo,
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
        getPaginationRowModel: getPaginationRowModel(),
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
        target instanceof HTMLElement
        && Boolean(target.closest("button,a,input,textarea,select,[role='button'],[data-radix-popper-content-wrapper]"))
    );

    return (
        <div className="w-full space-y-2">
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm dark:bg-zinc-900">
                <Table className="min-w-full table-fixed" style={{ width: table.getVisibleLeafColumns().reduce((total, column) => total + columnWidth(column.id), 0) }}>
                    <colgroup>
                        {table.getVisibleLeafColumns().map((column) => (
                            <col key={column.id} style={{ width: columnWidth(column.id) }} />
                        ))}
                    </colgroup>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id} className="border-b border-slate-200 bg-slate-50 hover:bg-slate-50">
                                {headerGroup.headers.map((header) => (
                                    <TableHead key={header.id} className={cn("sticky top-0 z-10 h-9 overflow-hidden bg-slate-50 text-xs font-semibold text-slate-600 text-ellipsis whitespace-nowrap", columnClassName(header.column.id))} style={{ width: columnWidth(header.column.id) }}>
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
                                        className={cn(
                                            "group cursor-pointer border-b border-slate-100 transition-colors odd:bg-white even:bg-slate-50/35 hover:bg-sky-50/60 data-[state=selected]:bg-sky-50",
                                            expandedOrderId === row.id && "bg-sky-50/80",
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
                                        <TableRow className="border-b border-slate-200 bg-slate-50 hover:bg-slate-50">
                                            <TableCell colSpan={row.getVisibleCells().length} className="p-0">
                                                <OrderDetailPanel order={row.original} onSaveRecipientInfo={onSaveRecipientInfo} />
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

            <div className="flex items-center justify-end gap-3 px-1 py-1.5">
                <div className="flex-1 text-xs text-slate-600">
                    총 {table.getFilteredRowModel().rows.length}개의 주문이 있습니다.
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                    >
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">이전 페이지</span>
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                    >
                        <ChevronRight className="h-4 w-4" />
                        <span className="sr-only">다음 페이지</span>
                    </Button>
                </div>
            </div>
        </div>
    );
}
