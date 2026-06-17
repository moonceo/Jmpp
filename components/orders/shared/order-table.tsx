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
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Order } from "@/types/order";

const ORDER_COLUMN_WIDTHS: Record<string, number> = {
    select: 44,
    process: 124,
    status: 88,
    progressStage: 104,
    orderDate: 92,
    productInfo: 320,
    buyerInfo: 94,
    deliveryInfo: 360,
    marketAccount: 120,
    sourcingLifeInfo: 132,
    invoice: 160,
};

interface OrderTableProps {
    data: Order[];
    columns: ColumnDef<Order>[];
    onRowSelectionChange?: (rowSelection: Record<string, boolean>) => void;
    selectable?: boolean;
}

export function OrderTable({
    data,
    columns,
    onRowSelectionChange,
    selectable = false,
}: OrderTableProps) {
    const [sorting, setSorting] = React.useState<SortingState>([{ id: "orderDate", desc: true }]);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
        select: selectable,
    });
    const [rowSelection, setRowSelection] = React.useState({});

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
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                    className="group border-b border-slate-100 transition-colors odd:bg-white even:bg-slate-50/35 hover:bg-sky-50/60 data-[state=selected]:bg-sky-50"
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} className={cn("overflow-hidden break-words px-2.5 py-2 align-top whitespace-normal", columnClassName(cell.column.id))} style={{ width: columnWidth(cell.column.id) }}>
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
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

            <div className="flex items-center justify-end gap-3 rounded-md border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
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
