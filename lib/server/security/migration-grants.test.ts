import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
    path.resolve(process.cwd(), "db/migrations/001_initial.sql"),
    "utf8",
);

describe("runtime database grants", () => {
    it("keeps audit evidence append-only for application and worker roles", () => {
        expect(migration).toContain(
            "REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs",
        );
        expect(migration).toContain(
            "GRANT SELECT, INSERT ON TABLE public.audit_logs",
        );
    });

    it("does not let runtime roles alter the migration ledger", () => {
        expect(migration).toContain(
            "REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations",
        );
    });
});
