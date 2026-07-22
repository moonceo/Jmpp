import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
    path.resolve(process.cwd(), "db/migrations/002_sourcing_pre_payment_core.sql"),
    "utf8",
);

describe("sourcing pre-payment migration", () => {
    it("hard-stops every draft before purchase submission and payment", () => {
        expect(migration).toContain("purchase_submission_status = 'NOT_SUBMITTED'");
        expect(migration).toContain("payment_status = 'NOT_STARTED'");
        expect(migration).toContain("pre_payment_only");
        expect(migration).not.toContain("payment_session_id");
    });

    it("enables tenant RLS on every new sourcing ledger", () => {
        for (const table of [
            "sourcing_source_products",
            "sourcing_source_options",
            "sourcing_mapping_rules",
            "order_item_sourcing_mappings",
            "sourcing_purchase_drafts",
            "sourcing_purchase_draft_events",
        ]) {
            expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        }
    });

    it("keeps draft events append-only for runtime roles", () => {
        expect(migration).toContain("REVOKE UPDATE, DELETE ON sourcing_purchase_draft_events");
    });

    it("reuses a single-option product even when the market option ID is null", () => {
        expect(migration).toContain("UNIQUE NULLS NOT DISTINCT");
        expect(migration).toContain("market_option_id IS NULL OR btrim(market_option_id) <> ''");
    });

    it("reserves source verification and reusable-rule approval for the trusted worker", () => {
        expect(migration).toContain("current_user_is_trusted_sourcing_worker");
        expect(migration).toContain("role.rolbypassrls");
        expect(migration).toContain("NOT role.rolsuper");
        expect(migration).toContain("NOT pg_has_role(current_user, relation.relowner, 'MEMBER')");
        expect(migration).toContain("guard_server_verified_source_write");
        expect(migration).toContain("guard_trusted_sourcing_rule_write");
        expect(migration).toContain("Only SERVER_VERIFIED sourcing rules may be approved");
    });
});
