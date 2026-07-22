import type { TransactionClient } from "@/lib/server/db";
import {
    findLatestApprovedReusableRule,
    upsertSourceOption,
    upsertSourceProduct,
} from "@/lib/server/sourcing/repository";
import type { SaveMappingInput } from "@/lib/server/sourcing/types";
import { describe, expect, it, vi } from "vitest";

const manualMappingInput = {
    tenantId: "tenant",
    orderItemId: "order-item",
    membershipId: "membership",
    correlationId: "00000000-0000-4000-8000-000000000000",
    expectedOrderItemVersion: "1",
    quantityMultiplier: 1,
    sourceProduct: {
        platform: "TAOBAO",
        externalProductId: "product-1",
        canonicalUrl: "https://item.taobao.com/item.htm?id=product-1",
        saleStatus: "ACTIVE",
        restrictionStatus: "CLEAR",
        customsRequirement: "FORMAT_VALID",
        sourceVersion: "manual-product-version",
        lastCheckedAt: "2026-07-10T02:00:00.000Z",
    },
    sourceOption: {
        externalSkuId: "sku-1",
        optionAttributes: { color: "black" },
        unitPriceCny: "10.00",
        stockStatus: "AVAILABLE",
        stockQuantity: 5,
        minimumQuantity: 1,
        quantityStep: 1,
        chinaShippingStatus: "CONFIRMED",
        chinaShippingCny: "5.00",
        sourceVersion: "manual-option-version",
        lastCheckedAt: "2026-07-10T02:00:00.000Z",
    },
} as SaveMappingInput;

describe("reusable sourcing rules", () => {
    it("looks up the latest approved, server-verified exact market option across order IDs", async () => {
        const query = vi.fn().mockResolvedValue({
            rows: [{
                id: "rule-id",
                rule_revision: 3,
                market_product_id: "market-product",
                market_option_id: "market-option",
                source_product_id: "source-product",
                source_option_id: "source-option",
                external_sku_id_snapshot: "sku-1",
                quantity_multiplier: 2,
                verification_provenance: "SERVER_VERIFIED",
                approval_status: "APPROVED",
                approved_at: new Date("2026-07-10T02:00:00.000Z"),
            }],
        });
        const client = { query } as unknown as TransactionClient;

        const result = await findLatestApprovedReusableRule(client, "tenant", "new-order-item");

        expect(result).toMatchObject({
            id: "rule-id",
            ruleRevision: 3,
            marketProductId: "market-product",
            marketOptionId: "market-option",
            verificationProvenance: "SERVER_VERIFIED",
            approvalStatus: "APPROVED",
        });
        const sql = query.mock.calls[0][0] as string;
        expect(sql).toContain("rule.market_product_id = item.market_product_id");
        expect(sql).toContain("rule.market_option_id IS NOT DISTINCT FROM item.market_option_id");
        expect(sql).toContain("rule.approval_status = 'APPROVED'");
        expect(sql).toContain("rule.verification_provenance = 'SERVER_VERIFIED'");
        expect(sql).toContain("ORDER BY rule.rule_revision DESC");
        expect(query).toHaveBeenCalledWith(expect.any(String), ["tenant", "new-order-item"]);
    });
});

describe("manual source snapshot writes", () => {
    it("cannot overwrite a server-verified product row", async () => {
        const query = vi.fn().mockResolvedValue({ rows: [] });
        const result = await upsertSourceProduct(
            { query } as unknown as TransactionClient,
            manualMappingInput,
        );

        expect(result).toBeNull();
        const sql = query.mock.calls[0][0] as string;
        expect(sql).toContain("'MANUAL_UNVERIFIED'");
        expect(sql).toContain(
            "sourcing_source_products.verification_provenance = 'MANUAL_UNVERIFIED'",
        );
    });

    it("cannot overwrite a server-verified exact SKU row", async () => {
        const query = vi.fn().mockResolvedValue({ rows: [] });
        const result = await upsertSourceOption(
            { query } as unknown as TransactionClient,
            manualMappingInput,
            "source-product-id",
        );

        expect(result).toBeNull();
        const sql = query.mock.calls[0][0] as string;
        expect(sql).toContain("'MANUAL_UNVERIFIED'");
        expect(sql).toContain(
            "sourcing_source_options.verification_provenance = 'MANUAL_UNVERIFIED'",
        );
    });
});
