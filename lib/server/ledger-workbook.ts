import ExcelJS from "exceljs";
import { LEDGER_HEADERS, ledgerRowToValues, type LedgerRow } from "@/lib/ledger";

const HEADER_FILLS = {
    order: "FEF2CB",
    sourcing: "FFFF00",
    shipping: "E2EFD9",
    profit: "FFC7CE",
} as const;

const COLUMN_WIDTHS = [
    9, 16.125, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9,
    9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9,
];

function headerFill(index: number): string {
    if (index <= 19 || index === 38) return HEADER_FILLS.order;
    if (index <= 27) return HEADER_FILLS.sourcing;
    if (index <= 35) return HEADER_FILLS.shipping;
    return HEADER_FILLS.profit;
}

export async function buildLedgerWorkbook(rows: readonly LedgerRow[]): Promise<Uint8Array> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "커머스라이프";
    workbook.created = new Date();
    workbook.modified = new Date();

    const worksheet = workbook.addWorksheet("Sheet1", {
        views: [{ state: "frozen", ySplit: 1 }],
        properties: { defaultRowHeight: 18 },
    });

    worksheet.addTable({
        name: "LedgerTable",
        ref: "A1",
        headerRow: true,
        totalsRow: false,
        style: {
            theme: "TableStyleLight1",
            showRowStripes: false,
        },
        columns: LEDGER_HEADERS.map((name) => ({ name })),
        rows: rows.map(ledgerRowToValues),
    });

    worksheet.columns.forEach((column, index) => {
        column.width = COLUMN_WIDTHS[index];
    });

    const header = worksheet.getRow(1);
    header.height = 33.75;
    header.eachCell((cell, columnNumber) => {
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: `FF${headerFill(columnNumber)}` },
        };
        cell.font = {
            name: "Malgun Gothic",
            size: 11,
            bold: true,
            color: columnNumber === 36 || columnNumber === 37
                ? { argb: "FF9C0006" }
                : { argb: "FF000000" },
        };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = {
            top: { style: "medium", color: { argb: "FF000000" } },
            bottom: { style: "thick", color: { argb: "FF000000" } },
            left: { style: "medium", color: { argb: columnNumber === 1 ? "FF000000" : "FFCCCCCC" } },
            right: { style: "medium", color: { argb: "FF000000" } },
        };
    });

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        row.font = { name: "Malgun Gothic", size: 10 };
        row.alignment = { vertical: "middle", wrapText: false };
        row.eachCell({ includeEmpty: true }, (cell) => {
            cell.border = {
                bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
                right: { style: "thin", color: { argb: "FFE5E7EB" } },
            };
        });
    }

    [1, 20].forEach((columnNumber) => {
        worksheet.getColumn(columnNumber).numFmt = "yyyy-mm-dd";
    });
    [17, 18, 19, 27, 31, 34, 35, 36].forEach((columnNumber) => {
        worksheet.getColumn(columnNumber).numFmt = "#,##0";
    });
    worksheet.getColumn(26).numFmt = "#,##0.00";
    worksheet.getColumn(37).numFmt = "0.0%";

    const buffer = await workbook.xlsx.writeBuffer();
    return new Uint8Array(buffer);
}
