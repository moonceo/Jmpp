import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
    path.resolve(process.cwd(), "db/migrations/004_claims_core.sql"),
    "utf8",
);
const repository = readFileSync(
    path.resolve(process.cwd(), "lib/server/claims/repository.ts"),
    "utf8",
);

function migrationFunction(name: string): string {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = migration.match(new RegExp(
        `CREATE FUNCTION ${escapedName}\\(\\)[\\s\\S]*?\\n\\$\\$;`,
    ));
    if (!match) throw new Error(`Missing migration function: ${name}`);
    return match[0];
}

describe("claims core migration", () => {
    it("creates independent case, line, and append-only event ledgers", () => {
        expect(migration).toContain("CREATE TABLE claim_cases");
        expect(migration).toContain("CREATE TABLE claim_lines");
        expect(migration).toContain("CREATE TABLE claim_events");
        expect(migration).toContain("Claim events are append-only");
        expect(migration).toContain("BEFORE UPDATE OR DELETE ON claim_events");
    });

    it("enforces tenant isolation and least-privilege runtime grants", () => {
        for (const table of ["claim_cases", "claim_lines", "claim_events"]) {
            expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        }
        expect(migration).toContain("GRANT SELECT ON claim_cases, claim_lines, claim_events TO jumunpangpang_app");
        expect(migration).toContain("GRANT SELECT, INSERT ON claim_cases TO jumunpangpang_worker");
        expect(migration).toContain("GRANT SELECT, INSERT, UPDATE ON claim_lines TO jumunpangpang_worker");
        expect(migration).not.toMatch(/GRANT\s+(?:SELECT, INSERT, )?UPDATE\s+ON claim_cases/);
        expect(migration).not.toContain("GRANT INSERT ON claim_cases, claim_lines, claim_events TO jumunpangpang_app");
    });

    it("limits worker claim-case updates to marketplace-owned columns", () => {
        const match = migration.match(
            /GRANT UPDATE \(([\s\S]*?)\) ON claim_cases TO jumunpangpang_worker;/,
        );
        if (!match) throw new Error("Missing worker claim_cases column grant");
        const grant = match[1];

        for (const required of [
            "requester_type", "fault_type", "normalized_status", "market_status_raw",
            "provider_processing_id", "deadline_at", "resolution_status",
            "reviewed_at", "completed_at", "source_created_at", "source_updated_at",
        ]) {
            expect(grant).toContain(required);
        }
        for (const forbidden of [
            "purchase_compensation_status", "purchase_compensation_reference",
            "purchase_compensation_next_action_at", "purchase_compensation_completed_at",
            "deleted_at", "tenant_id", "market_account_id", "sales_order_id",
            "external_claim_id", "dedupe_key", "claim_type", "source",
            "requested_at", "order_status_at_request", "item_status_at_request",
            "sourcing_status_at_request", "fulfillment_status_at_request",
        ]) {
            expect(grant).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
        }
    });

    it("keeps the inbound claim update within the worker column grant", () => {
        const update = repository.match(
            /`UPDATE claim_cases[\s\S]*?RETURNING id, sales_order_id,[\s\S]*?version::text AS version`/,
        )?.[0];
        if (!update) throw new Error("Missing inbound claim_cases update");

        expect(update).not.toContain("purchase_compensation_");
        expect(update).toContain("source_updated_at = $26");
    });

    it("enforces external idempotency, quantities, state order, and request snapshots", () => {
        expect(migration).toContain("claim_cases_external_identity_uidx");
        expect(migration).toContain("claim_events_external_identity_uidx");
        expect(migration).toContain("Active claim quantities exceed the ordered quantity");
        expect(migration).toContain("Claim source_updated_at cannot move backwards");
        expect(migration).toContain("Claim line identity and request-time snapshots are immutable");
        expect(migration).toContain("line.normalized_status NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED')");
        expect(migration).toContain("line.claim_case_id <> NEW.claim_case_id");
        expect(migration).toContain("Terminal claim case contains an active claim line");
        expect(migration).toContain("claim_cases_terminal_resolution_ck");
        expect(migration).toContain("SNAPSHOT_CONFLICT");
        expect(migration).toContain("order_status_at_request");
        expect(migration).toContain("sourcing_status_at_request");
    });

    it("serializes order-item reductions with active claim-line capacity", () => {
        const guard = migrationFunction("guard_order_item_claim_capacity");

        expect(migration).toMatch(
            /CREATE TRIGGER order_items_claim_capacity_guard\s+BEFORE UPDATE OF quantity, deleted_at ON order_items/,
        );
        expect(guard).toContain("pg_advisory_xact_lock(hashtextextended(");
        expect(guard).toContain("OLD.tenant_id::text || ':' || OLD.id::text");
        expect(guard).toContain("line.normalized_status NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED')");
        expect(guard).toContain("active_claim_quantity > NEW.quantity");
        expect(guard).toContain("Order item quantity cannot be reduced below active claim quantities");
        expect(guard).toContain("Order item cannot be soft-deleted while active claims exist");
    });

    it("keeps claim case and line ledger tombstones immutable", () => {
        const caseGuard = migrationFunction("guard_claim_case_write");
        const lineGuard = migrationFunction("guard_claim_line_write");

        for (const guard of [caseGuard, lineGuard]) {
            expect(guard).toContain("NEW.deleted_at IS DISTINCT FROM OLD.deleted_at");
            expect(guard).toContain("TG_OP = 'INSERT' AND NEW.deleted_at IS NOT NULL");
        }
        expect(caseGuard).toContain("Claim case deleted_at is immutable");
        expect(lineGuard).toContain("Claim line deleted_at is immutable");
    });

    it("normalizes forged inbound compensation fields from the sourcing snapshot", () => {
        const caseGuard = migrationFunction("guard_claim_case_write");
        const lineGuard = migrationFunction("guard_claim_line_write");

        expect(caseGuard).toContain("NEW.purchase_compensation_status := CASE");
        expect(caseGuard).toContain("'PAID', 'INVOICE_RECEIVED', 'EXTERNAL_PURCHASE', 'MULTIPLE'");
        expect(caseGuard).toContain("THEN 'NEEDS_ATTENTION'");
        expect(caseGuard).toContain("THEN 'NOT_REQUIRED'");
        expect(caseGuard).toContain("ELSE 'UNKNOWN'");
        expect(caseGuard).toContain("NEW.purchase_compensation_reference := NULL");
        expect(caseGuard).toContain("NEW.purchase_compensation_next_action_at := NULL");
        expect(caseGuard).toContain("NEW.purchase_compensation_completed_at := NULL");
        expect(caseGuard).toContain("Purchase compensation is reconciliation-owned");
        expect(lineGuard).toContain("internal_work_status, sourcing_status, market_fulfillment_status");
        expect(lineGuard).toContain("NEW.sourcing_status_at_request");
        expect(lineGuard).toContain(
            "Claim request-time item snapshots must match the trusted order item",
        );
    });

    it("reconciles derived compensation through a locked trigger-only definer", () => {
        const reconciler = migrationFunction("public.reconcile_claim_purchase_compensation");
        const caseGuard = migrationFunction("guard_claim_case_write");
        const lineGuard = migrationFunction("guard_claim_line_write");

        expect(reconciler).toContain("SECURITY DEFINER");
        expect(reconciler).toContain("SET search_path = pg_catalog");
        expect(reconciler).toContain("FROM public.claim_cases claim_case");
        expect(reconciler).toContain("FOR UPDATE");
        expect(reconciler).toContain("FROM public.claim_lines line");
        expect(reconciler).toContain("'PAID', 'INVOICE_RECEIVED', 'EXTERNAL_PURCHASE', 'MULTIPLE'");
        expect(reconciler).toContain("'NOT_REQUIRED', 'UNKNOWN', 'NEEDS_ATTENTION'");
        expect(reconciler).not.toContain("'PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED'");
        expect(migration).toContain(
            "REVOKE ALL PRIVILEGES ON FUNCTION public.reconcile_claim_purchase_compensation() FROM PUBLIC",
        );
        expect(migration).toMatch(
            /CREATE TRIGGER claim_lines_reconcile_purchase_compensation\s+AFTER INSERT ON claim_lines/,
        );
        expect(migration).not.toContain(
            "GRANT EXECUTE ON FUNCTION public.reconcile_claim_purchase_compensation() TO jumunpangpang_worker",
        );
        expect(migration).toContain(
            "SELECT public.claim_status_allowed_for_type(target_type, next_status)",
        );
        expect(caseGuard).toContain("public.claim_status_allowed_for_type(");
        expect(caseGuard).toContain("public.claim_status_transition_allowed(");
        expect(lineGuard).toContain("public.claim_status_allowed_for_type(");
        expect(lineGuard).toContain("public.claim_status_transition_allowed(");
    });

    it("requires exact terminal status agreement between a case and every line", () => {
        const consistency = migrationFunction("enforce_claim_case_line_consistency");

        expect(consistency).toContain("target_status IN ('REJECTED', 'WITHDRAWN', 'COMPLETED')");
        expect(consistency).toContain("normalized_status IS DISTINCT FROM target_status");
        expect(consistency).toContain("Terminal claim case status must match every claim line");
    });

    it("never stores a plaintext free-text market reason column", () => {
        expect(migration).toContain("market_reason_encrypted");
        expect(migration).toContain("market_reason_masked");
        expect(migration).not.toMatch(/\bmarket_reason_text\b/);
    });
});
