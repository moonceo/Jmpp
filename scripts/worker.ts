import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { config as loadEnvironment } from "dotenv";
import type { QueryResultRow } from "pg";

import { closeDbPool } from "@/lib/server/db";
import {
  databaseRoleSafetySql,
  isSafeWorkerDatabaseRole,
  type DatabaseRoleSafety,
} from "@/lib/server/db/role-safety";
import type { NaverWorkerConfig } from "@/lib/server/workers/naver-orders";

loadEnvironment({ path: [".env.local", ".env"], quiet: true });

function integerEnvironmentValue(
  name: string,
  fallback: number,
  options: { allowZero?: boolean } = {},
): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer.`);
  }

  const parsed = Number(value);
  const minimum = options.allowZero ? 0 : 1;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} is outside the supported range.`);
  }
  return parsed;
}

function workerConfig(): NaverWorkerConfig {
  return {
    leaseOwner: `${hostname()}:${process.pid}:${randomUUID()}`,
    leaseDurationMs: integerEnvironmentValue(
      "WORKER_LEASE_DURATION_MS",
      120_000,
    ),
    pollIntervalMs: integerEnvironmentValue("WORKER_POLL_INTERVAL_MS", 2_000),
    changedOrdersPageSize: integerEnvironmentValue(
      "NAVER_CHANGED_ORDERS_PAGE_SIZE",
      300,
    ),
    detailBatchSize: integerEnvironmentValue(
      "NAVER_ORDER_DETAIL_BATCH_SIZE",
      300,
    ),
    initialLookbackMs: integerEnvironmentValue(
      "NAVER_INITIAL_LOOKBACK_MS",
      86_400_000,
    ),
    defaultOverlapSeconds: integerEnvironmentValue(
      "NAVER_SYNC_OVERLAP_SECONDS",
      300,
      { allowZero: true },
    ),
    rawRetentionDays: integerEnvironmentValue("RAW_SNAPSHOT_RETENTION_DAYS", 90),
    retryBaseMs: integerEnvironmentValue("WORKER_RETRY_BASE_MS", 5_000),
    retryCapMs: integerEnvironmentValue("WORKER_RETRY_CAP_MS", 900_000),
    accountVerificationWindowMs: integerEnvironmentValue(
      "NAVER_ACCOUNT_VERIFY_WINDOW_MS",
      300_000,
    ),
  };
}

async function main(): Promise<void> {
  const workerDatabaseUrl = process.env.WORKER_DATABASE_URL?.trim();
  if (!workerDatabaseUrl) {
    throw new Error(
      "WORKER_DATABASE_URL must be set to a dedicated non-superuser BYPASSRLS role.",
    );
  }

  // Global SKIP LOCKED leasing cannot run through the tenant-scoped app role.
  // This assignment happens before getDbPool() is first called.
  process.env.DATABASE_URL = workerDatabaseUrl;

  const abortController = new AbortController();
  const stop = (): void => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const {
      createDefaultNaverWorkerDependencies,
      createDefaultNaverOrderSchedulerDependencies,
      runNaverOrderSchedulerLoop,
      runNaverWorkerLoop,
    } = await import("@/lib/server/workers/naver-orders");
    const {
      createDefaultNaverOutboundCommandDependencies,
      runNaverOutboundCommandLoop,
    } = await import("@/lib/server/commands/worker");
    const { query } = await import("@/lib/server/db");
    const roleResult = await query<DatabaseRoleSafety & QueryResultRow>(databaseRoleSafetySql);
    const role = roleResult.rows[0];
    if (!isSafeWorkerDatabaseRole(role)) {
      throw new Error(
        "WORKER_DATABASE_URL must use a dedicated non-owner, non-superuser role with BYPASSRLS.",
      );
    }
    const config = workerConfig();
    const inboundDependencies = createDefaultNaverWorkerDependencies({
      ...config,
      leaseOwner: `${config.leaseOwner}:inbound`,
    });
    const outboundDependencies = createDefaultNaverOutboundCommandDependencies({
      leaseOwner: `${config.leaseOwner}:outbound`,
      leaseDurationMs: config.leaseDurationMs,
      retryBaseMs: config.retryBaseMs,
      retryCapMs: config.retryCapMs,
    });
    const schedulerDependencies = createDefaultNaverOrderSchedulerDependencies({
      pollIntervalMs: integerEnvironmentValue(
        "NAVER_SYNC_SCHEDULER_POLL_INTERVAL_MS",
        5_000,
      ),
      syncIntervalMs: integerEnvironmentValue(
        "NAVER_ORDER_SYNC_INTERVAL_MS",
        60_000,
      ),
      initialLookbackMs: config.initialLookbackMs,
      maxAttempts: integerEnvironmentValue(
        "NAVER_SCHEDULED_SYNC_MAX_ATTEMPTS",
        8,
      ),
      batchSize: integerEnvironmentValue(
        "NAVER_SYNC_SCHEDULER_BATCH_SIZE",
        100,
      ),
    });

    const stopOnFailure = async (work: Promise<void>): Promise<void> => {
      try {
        await work;
      } catch (error) {
        abortController.abort();
        throw error;
      }
    };

    await Promise.all([
      stopOnFailure(runNaverWorkerLoop(inboundDependencies, abortController.signal)),
      stopOnFailure(
        runNaverOrderSchedulerLoop(
          schedulerDependencies,
          abortController.signal,
        ),
      ),
      stopOnFailure(
        runNaverOutboundCommandLoop(
          outboundDependencies,
          abortController.signal,
          { pollIntervalMs: config.pollIntervalMs },
        ),
      ),
    ]);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await closeDbPool();
  }
}

main().catch(() => {
  console.error("The marketplace worker stopped because of a fatal error.");
  process.exitCode = 1;
});
