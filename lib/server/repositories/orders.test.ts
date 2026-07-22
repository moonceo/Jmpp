import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionClient } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http/api-error";
import { listOrders } from "@/lib/server/repositories/orders";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";

function headerRow(id: string, orderedAt: string) {
    return {
        id,
        external_order_id: `external-${id}`,
        external_order_number: null,
        normalized_status: "NEW",
        market_status_raw: "PAYED",
        currency_code: "KRW",
        gross_amount: "9007199254740991.25",
        paid_amount: "9007199254740991.25",
        buyer_name_masked: "홍*동",
        recipient_name_masked: "김*희",
        ordered_at: new Date(orderedAt),
        paid_at: null,
        version: "9223372036854775807",
        market_account_id: "00000000-0000-4000-8000-000000000010",
        market_code: "NAVER",
        store_name: "테스트몰",
    };
}

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("listOrders cursor", () => {
    it("keeps decimals/bigints as strings and signs the next cursor", async () => {
        vi.stubEnv("CURSOR_SIGNING_SECRET", "cursor-secret-".padEnd(40, "x"));
        const query = vi.fn()
            .mockResolvedValueOnce({ rows: [
                headerRow("00000000-0000-4000-8000-000000000101", "2026-07-10T10:00:00.000Z"),
                headerRow("00000000-0000-4000-8000-000000000102", "2026-07-10T09:00:00.000Z"),
            ] })
            .mockResolvedValueOnce({ rows: [] });
        const client = { query } as unknown as TransactionClient;

        const page = await listOrders(client, TENANT_ID, { limit: 1 });

        expect(page.items[0]).toMatchObject({
            grossAmount: "9007199254740991.25",
            version: "9223372036854775807",
            recipientNameMasked: "김*희",
        });
        expect(page.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        const itemProjectionSql = query.mock.calls[1][0] as string;
        expect(itemProjectionSql).toContain("order_item_sourcing_mappings");
        expect(itemProjectionSql).toContain("sourcingVerificationProvenance");
        expect(itemProjectionSql).toContain("MANUAL_UNVERIFIED");
    });

    it("rejects a cursor reused with different filters before querying", async () => {
        vi.stubEnv("CURSOR_SIGNING_SECRET", "cursor-secret-".padEnd(40, "x"));
        const firstQuery = vi.fn()
            .mockResolvedValueOnce({ rows: [
                headerRow("00000000-0000-4000-8000-000000000101", "2026-07-10T10:00:00.000Z"),
                headerRow("00000000-0000-4000-8000-000000000102", "2026-07-10T09:00:00.000Z"),
            ] })
            .mockResolvedValueOnce({ rows: [] });
        const firstPage = await listOrders({ query: firstQuery } as unknown as TransactionClient, TENANT_ID, { limit: 1 });
        const nextClient = { query: vi.fn() } as unknown as TransactionClient;

        await expect(listOrders(nextClient, TENANT_ID, {
            limit: 1,
            cursor: firstPage.nextCursor!,
            normalizedStatus: "SHIPPING",
        })).rejects.toBeInstanceOf(ApiError);
        expect(nextClient.query).not.toHaveBeenCalled();
    });
});
