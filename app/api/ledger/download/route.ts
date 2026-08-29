import { z } from "zod";
import { filterLedgerOrders, getLedgerFilename } from "@/lib/ledger";
import { LEDGER_MANUAL_FIELD_KEYS } from "@/lib/ledger-manual-entry";
import { createMockOrders } from "@/lib/mock-data/orders";
import { buildLedgerWorkbook } from "@/lib/server/ledger-workbook";

export const dynamic = "force-dynamic";

const ledgerDownloadSchema = z.object({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    market: z.enum(["all", "naver", "coupang", "11st", "gmarket", "auction"]),
    onlyConfirmed: z.boolean(),
    excludeCanceledReturns: z.boolean(),
    includeManualEntries: z.boolean().default(true),
    monthly: z.boolean().default(false),
    manualEntries: z.array(z.object({
        id: z.string().min(1).max(200),
        orderId: z.string().min(1).max(100),
        field: z.enum(LEDGER_MANUAL_FIELD_KEYS),
        value: z.number().nonnegative().finite(),
        updatedAt: z.iso.datetime(),
    })).max(1000).default([]),
}).refine((value) => value.startDate <= value.endDate, {
    message: "조회 시작일은 종료일보다 늦을 수 없습니다.",
});

export async function POST(request: Request): Promise<Response> {
    try {
        const requestData = ledgerDownloadSchema.parse(await request.json());
        const { manualEntries, ...filter } = requestData;
        const rows = filterLedgerOrders(createMockOrders(new Date()), filter, manualEntries);
        if (rows.length === 0) {
            return Response.json({ message: "다운로드할 장부 데이터가 없습니다." }, { status: 400 });
        }

        const workbook = await buildLedgerWorkbook(rows);
        const filename = getLedgerFilename(filter, filter.monthly);

        const responseBody = new Uint8Array(workbook).buffer;
        return new Response(responseBody, {
            status: 200,
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        const message = error instanceof z.ZodError
            ? error.issues[0]?.message ?? "조회 조건을 확인해 주세요."
            : "장부 파일을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.";
        return Response.json({ message }, { status: 400 });
    }
}
