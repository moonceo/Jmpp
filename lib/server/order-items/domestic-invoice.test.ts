import type { TransactionClient } from "@/lib/server/db";
import {
    domesticInvoiceBodySchema,
    saveDomesticInvoice,
} from "@/lib/server/order-items/domestic-invoice";
import { describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-000000000002";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000003";
const MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000004";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000005";
const RECEIVED_AT = "2026-07-10T03:00:00.000Z";

function result(rows: unknown[] = []) {
    return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

function scriptedClient(...rowSets: unknown[][]) {
    const query = vi.fn(async (...args: unknown[]) => {
        void args;
        return result(rowSets.shift() ?? []);
    });
    return {
        client: { query } as unknown as TransactionClient,
        query,
    };
}

function currentItem(overrides: Record<string, unknown> = {}) {
    return {
        id: ITEM_ID,
        market_account_id: ACCOUNT_ID,
        internal_work_status: "READY_TO_SHIP",
        market_invoice_submitted_at: null,
        version: "3",
        ...overrides,
    };
}

function input() {
    return {
        tenantId: TENANT_ID,
        orderItemId: ITEM_ID,
        membershipId: MEMBERSHIP_ID,
        expectedVersion: "3",
        carrierCode: "CJGLS",
        trackingNumber: "1234567890",
        receivedAt: RECEIVED_AT,
        correlationId: CORRELATION_ID,
    };
}

describe("domestic invoice storage", () => {
    it("rejects edits after the marketplace invoice was submitted", async () => {
        const { client, query } = scriptedClient([
            currentItem({ market_invoice_submitted_at: new Date(RECEIVED_AT) }),
        ]);

        await expect(saveDomesticInvoice(client, input())).rejects.toMatchObject({
            status: 409,
            code: "INVOICE_ALREADY_SUBMITTED",
        });
        expect(query).toHaveBeenCalledOnce();
    });

    it("rejects edits once domestic-invoice processing has started", async () => {
        const { client, query } = scriptedClient(
            [currentItem()],
            [{ started: true }],
        );

        await expect(saveDomesticInvoice(client, input())).rejects.toMatchObject({
            status: 409,
            code: "DELIVERY_INVOICE_ALREADY_STARTED",
        });
        expect(query).toHaveBeenCalledTimes(2);
    });

    it.each(["NEW", "DELIVERED", "CANCELED", "ON_HOLD"])(
        "rejects the non-editable %s state",
        async (internalWorkStatus) => {
            const { client, query } = scriptedClient([
                currentItem({ internal_work_status: internalWorkStatus }),
            ]);

            await expect(saveDomesticInvoice(client, input())).rejects.toMatchObject({
                status: 409,
                code: "INVOICE_NOT_ALLOWED",
            });
            expect(query).toHaveBeenCalledOnce();
        },
    );

    it.each(["PREPARING", "READY_TO_SHIP", "SHIPPING"])(
        "stores an invoice before marketplace submission in the %s state",
        async (internalWorkStatus) => {
            const { client, query } = scriptedClient(
                [currentItem({ internal_work_status: internalWorkStatus })],
                [{ started: false }],
                [{ version: "4" }],
                [],
            );

            await expect(saveDomesticInvoice(client, input())).resolves.toMatchObject({
                orderItemId: ITEM_ID,
                carrierCode: "CJGLS",
                trackingNumber: "1234567890",
                version: "4",
            });
            expect(query).toHaveBeenCalledTimes(4);
            expect(query.mock.calls[1]?.[0]).toContain("payload ->> 'requestedMethod' = 'DELIVERY'");
        },
    );

    it("rejects control characters in carrier codes", () => {
        const parsed = domesticInvoiceBodySchema.safeParse({
            expectedVersion: "3",
            carrierCode: "CJ\nGLS",
            trackingNumber: "1234567890",
            receivedAt: RECEIVED_AT,
        });

        expect(parsed.success).toBe(false);
    });
});
