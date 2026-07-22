import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { PostgresNaverOrderSchedulerStore } from "@/lib/server/workers/naver-orders/scheduler";

const NOW = new Date("2026-07-12T03:00:00.000Z");
const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const CORRELATION_ID = "00000000-0000-4000-8000-000000000004";

function result(rows: unknown[] = []) {
  return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
}

function fakePool() {
  const query = vi.fn(async (statement: unknown, values?: unknown[]) => {
    void values;
    const sql = String(statement);
    if (sql.includes("WITH candidates AS MATERIALIZED")) {
      return result([{
        id: RUN_ID,
        tenant_id: TENANT_ID,
        market_account_id: ACCOUNT_ID,
        correlation_id: CORRELATION_ID,
        window_start: new Date("2026-07-11T03:00:00.000Z"),
        window_end: NOW,
      }]);
    }
    return result();
  });
  const release = vi.fn();
  const pool = {
    connect: vi.fn(async () => ({ query, release })),
  } as unknown as Pool;

  return { pool, query, release };
}

describe("PostgresNaverOrderSchedulerStore SQL contract", () => {
  it("atomically schedules only due connected accounts with fixed windows and SYSTEM audit", async () => {
    const fake = fakePool();
    const store = new PostgresNaverOrderSchedulerStore(fake.pool);

    const scheduled = await store.enqueueDue({
      now: NOW,
      syncIntervalMs: 60_000,
      initialLookbackMs: 86_400_000,
      maxAttempts: 8,
      batchSize: 100,
    });

    expect(scheduled).toEqual([{
      id: RUN_ID,
      tenantId: TENANT_ID,
      marketAccountId: ACCOUNT_ID,
      correlationId: CORRELATION_ID,
      windowStart: "2026-07-11T03:00:00.000Z",
      windowEnd: NOW.toISOString(),
    }]);

    const scheduleCall = fake.query.mock.calls.find(([statement]) =>
      String(statement).includes("WITH candidates AS MATERIALIZED"));
    expect(scheduleCall).toBeDefined();
    expect(scheduleCall?.[1]).toEqual([NOW, 60_000, 86_400_000, 8, 100]);

    const sql = String(scheduleCall?.[0]);
    expect(sql).toContain("ma.market_code = 'NAVER'");
    expect(sql).toContain("ma.is_active");
    expect(sql).toContain("ma.auth_status = 'CONNECTED'");
    expect(sql).toContain("terminal.terminal_at <=");
    expect(sql).toContain("$2::double precision * INTERVAL '1 millisecond'");
    expect(sql).toContain("cursor.watermark_at");
    expect(sql).toContain("cursor.overlap_seconds");
    expect(sql).toContain("$3::double precision * INTERVAL '1 millisecond'");
    expect(sql).toContain("'SCHEDULED'");
    expect(sql).toMatch(/window_end, scheduled_for,[\s\S]+\$1::timestamptz,[\s\S]+\$1::timestamptz/);
    expect(sql).toContain("'SYSTEM'");
    expect(sql).toContain("'SYNC_RUN_SCHEDULED'");
    expect(sql).toContain("FOR UPDATE OF ma SKIP LOCKED");
    expect(fake.query.mock.calls.map(([statement]) => String(statement))).toEqual([
      expect.stringContaining("BEGIN ISOLATION LEVEL READ COMMITTED"),
      expect.stringContaining("WITH candidates AS MATERIALIZED"),
      "COMMIT",
    ]);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("uses the exact active-run predicate backed by the partial unique index", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "db/migrations/001_initial.sql"),
      "utf8",
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX sync_runs_one_active_stream_uidx\s+ON sync_runs \(tenant_id, market_account_id, stream\)\s+WHERE deleted_at IS NULL AND status IN \('PENDING', 'RUNNING', 'RETRY'\)/,
    );

    const source = readFileSync(
      resolve(
        process.cwd(),
        "lib/server/workers/naver-orders/scheduler.ts",
      ),
      "utf8",
    );
    expect(source).toMatch(
      /ON CONFLICT \(tenant_id, market_account_id, stream\)\s+WHERE deleted_at IS NULL\s+AND status IN \('PENDING', 'RUNNING', 'RETRY'\)\s+DO NOTHING/,
    );
    expect(source).toContain(
      "'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELED', 'DEAD'",
    );
  });

  it("starts scheduling only after the dedicated worker role safety gate", () => {
    const entrypoint = readFileSync(
      resolve(process.cwd(), "scripts/worker.ts"),
      "utf8",
    );
    const roleGate = entrypoint.indexOf("isSafeWorkerDatabaseRole(role)");
    const schedulerCreation = entrypoint.indexOf(
      "createDefaultNaverOrderSchedulerDependencies({",
    );

    expect(entrypoint).toContain(
      "WORKER_DATABASE_URL must be set to a dedicated non-superuser BYPASSRLS role.",
    );
    expect(roleGate).toBeGreaterThan(-1);
    expect(schedulerCreation).toBeGreaterThan(roleGate);
    expect(entrypoint).toContain("runNaverWorkerLoop(");
    expect(entrypoint).toContain("runNaverOrderSchedulerLoop(");
    expect(entrypoint).toContain("runNaverOutboundCommandLoop(");
    expect(entrypoint).toContain("await Promise.all([");
  });
});
