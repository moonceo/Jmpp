import { describe, expect, it } from "vitest";
import {
    isSafeApplicationDatabaseRole,
    isSafeWorkerDatabaseRole,
} from "@/lib/server/db/role-safety";

const base = {
    rolsuper: false,
    rolbypassrls: false,
    member_of_table_owner: false,
    relrowsecurity: true,
};

describe("database runtime role separation", () => {
    it("accepts only a tenant-scoped app role", () => {
        expect(isSafeApplicationDatabaseRole(base)).toBe(true);
        expect(isSafeApplicationDatabaseRole({ ...base, rolsuper: true })).toBe(false);
        expect(isSafeApplicationDatabaseRole({ ...base, rolbypassrls: true })).toBe(false);
        expect(isSafeApplicationDatabaseRole({ ...base, member_of_table_owner: true })).toBe(false);
        expect(isSafeApplicationDatabaseRole({ ...base, relrowsecurity: false })).toBe(false);
    });

    it("accepts only a non-owner, non-superuser BYPASSRLS worker role", () => {
        expect(isSafeWorkerDatabaseRole({ ...base, rolbypassrls: true })).toBe(true);
        expect(isSafeWorkerDatabaseRole(base)).toBe(false);
        expect(isSafeWorkerDatabaseRole({
            ...base,
            rolbypassrls: true,
            rolsuper: true,
        })).toBe(false);
        expect(isSafeWorkerDatabaseRole({
            ...base,
            rolbypassrls: true,
            member_of_table_owner: true,
        })).toBe(false);
    });
});
