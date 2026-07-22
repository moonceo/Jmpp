import type { Pool, QueryResultRow } from "pg";

import { getDbPool, withTransaction } from "@/lib/server/db";

export interface ScheduledNaverOrderSyncRun {
  id: string;
  tenantId: string;
  marketAccountId: string;
  correlationId: string;
  windowStart: string;
  windowEnd: string;
}

export interface EnqueueDueNaverOrderSyncsInput {
  now: Date;
  syncIntervalMs: number;
  initialLookbackMs: number;
  maxAttempts: number;
  batchSize: number;
}

export interface NaverOrderSchedulerStore {
  enqueueDue(
    input: EnqueueDueNaverOrderSyncsInput,
  ): Promise<readonly ScheduledNaverOrderSyncRun[]>;
}

export interface NaverOrderSchedulerConfig {
  pollIntervalMs: number;
  syncIntervalMs: number;
  initialLookbackMs: number;
  maxAttempts: number;
  batchSize: number;
}

export interface NaverOrderSchedulerDependencies {
  store: NaverOrderSchedulerStore;
  clock: { now(): Date };
  sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  config: NaverOrderSchedulerConfig;
}

interface ScheduledRunRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  market_account_id: string;
  correlation_id: string;
  window_start: Date;
  window_end: Date;
}

function toScheduledRun(row: ScheduledRunRow): ScheduledNaverOrderSyncRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    marketAccountId: row.market_account_id,
    correlationId: row.correlation_id,
    windowStart: row.window_start.toISOString(),
    windowEnd: row.window_end.toISOString(),
  };
}

/**
 * Enqueues due work and its SYSTEM audit record in one transaction.
 *
 * The partial ON CONFLICT target deliberately matches
 * sync_runs_one_active_stream_uidx. The preceding NOT EXISTS is only an
 * efficient fast path; the unique index remains the concurrency boundary
 * against another scheduler or a simultaneous manual enqueue.
 */
export class PostgresNaverOrderSchedulerStore
  implements NaverOrderSchedulerStore
{
  constructor(private readonly pool: Pool = getDbPool()) {}

  async enqueueDue(
    input: EnqueueDueNaverOrderSyncsInput,
  ): Promise<readonly ScheduledNaverOrderSyncRun[]> {
    return withTransaction(
      async (client) => {
        const result = await client.query<ScheduledRunRow>(
          `WITH candidates AS MATERIALIZED (
             SELECT ma.tenant_id,
                    ma.id AS market_account_id,
                    COALESCE(cursor.cursor_value, '{}'::jsonb) AS cursor_before,
                    CASE
                      WHEN cursor.watermark_at IS NOT NULL THEN
                        LEAST(cursor.watermark_at, $1::timestamptz)
                        - (COALESCE(cursor.overlap_seconds, 0)::double precision
                           * INTERVAL '1 second')
                      ELSE
                        $1::timestamptz
                        - ($3::double precision * INTERVAL '1 millisecond')
                    END AS window_start,
                    terminal.terminal_at
               FROM market_accounts ma
               LEFT JOIN sync_cursors cursor
                 ON cursor.tenant_id = ma.tenant_id
                AND cursor.market_account_id = ma.id
                AND cursor.stream = 'ORDERS'
                AND cursor.deleted_at IS NULL
               LEFT JOIN LATERAL (
                 SELECT COALESCE(sr.completed_at, sr.updated_at) AS terminal_at
                   FROM sync_runs sr
                  WHERE sr.tenant_id = ma.tenant_id
                    AND sr.market_account_id = ma.id
                    AND sr.stream = 'ORDERS'
                    AND sr.status IN (
                      'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELED', 'DEAD'
                    )
                    AND sr.deleted_at IS NULL
                  ORDER BY COALESCE(sr.completed_at, sr.updated_at) DESC,
                           sr.id DESC
                  LIMIT 1
               ) terminal ON true
              WHERE ma.market_code = 'NAVER'
                AND ma.is_active
                AND ma.auth_status = 'CONNECTED'
                AND ma.deleted_at IS NULL
                AND (
                  terminal.terminal_at IS NULL
                  OR terminal.terminal_at <=
                     $1::timestamptz
                     - ($2::double precision * INTERVAL '1 millisecond')
                )
                AND NOT EXISTS (
                  SELECT 1
                    FROM sync_runs active
                   WHERE active.tenant_id = ma.tenant_id
                     AND active.market_account_id = ma.id
                     AND active.stream = 'ORDERS'
                     AND active.status IN ('PENDING', 'RUNNING', 'RETRY')
                     AND active.deleted_at IS NULL
                )
              ORDER BY terminal.terminal_at ASC NULLS FIRST, ma.id
              FOR UPDATE OF ma SKIP LOCKED
              LIMIT $5
           ), inserted AS (
             INSERT INTO sync_runs (
               tenant_id, market_account_id, stream, trigger_type, status,
               cursor_before, window_start, window_end, scheduled_for,
               next_attempt_at, max_attempts
             )
             SELECT candidate.tenant_id,
                    candidate.market_account_id,
                    'ORDERS',
                    'SCHEDULED',
                    'PENDING',
                    candidate.cursor_before,
                    candidate.window_start,
                    $1::timestamptz,
                    $1::timestamptz,
                    $1::timestamptz,
                    $4
               FROM candidates candidate
             ON CONFLICT (tenant_id, market_account_id, stream)
               WHERE deleted_at IS NULL
                 AND status IN ('PENDING', 'RUNNING', 'RETRY')
             DO NOTHING
             RETURNING id, tenant_id, market_account_id, correlation_id,
                       window_start, window_end
           ), audited AS (
             INSERT INTO audit_logs (
               tenant_id, market_account_id, actor_type, action,
               entity_type, entity_id, correlation_id,
               after_snapshot, metadata
             )
             SELECT inserted.tenant_id,
                    inserted.market_account_id,
                    'SYSTEM',
                    'SYNC_RUN_SCHEDULED',
                    'SYNC_RUN',
                    inserted.id::text,
                    inserted.correlation_id,
                    jsonb_build_object(
                      'stream', 'ORDERS',
                      'triggerType', 'SCHEDULED',
                      'status', 'PENDING',
                      'windowStart', inserted.window_start,
                      'windowEnd', inserted.window_end
                    ),
                    jsonb_build_object(
                      'scheduler', 'NAVER_ORDER_SCHEDULER',
                      'syncIntervalMs', $2::bigint
                    )
               FROM inserted
             RETURNING entity_id
           )
           SELECT inserted.id,
                  inserted.tenant_id,
                  inserted.market_account_id,
                  inserted.correlation_id,
                  inserted.window_start,
                  inserted.window_end
             FROM inserted
             JOIN audited ON audited.entity_id = inserted.id::text
            ORDER BY inserted.id`,
          [
            input.now,
            input.syncIntervalMs,
            input.initialLookbackMs,
            input.maxAttempts,
            input.batchSize,
          ],
        );

        return result.rows.map(toScheduledRun);
      },
      {},
      this.pool,
    );
  }
}

function requirePositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
}

export function validateNaverOrderSchedulerConfig(
  config: NaverOrderSchedulerConfig,
): void {
  requirePositiveSafeInteger("pollIntervalMs", config.pollIntervalMs);
  requirePositiveSafeInteger("syncIntervalMs", config.syncIntervalMs);
  requirePositiveSafeInteger("initialLookbackMs", config.initialLookbackMs);
  requirePositiveSafeInteger("maxAttempts", config.maxAttempts);
  requirePositiveSafeInteger("batchSize", config.batchSize);

  if (config.maxAttempts > 100) {
    throw new Error("maxAttempts must not exceed 100.");
  }
  if (config.batchSize > 1_000) {
    throw new Error("batchSize must not exceed 1000.");
  }
}

export const defaultNaverOrderSchedulerSleep = (
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted || milliseconds <= 0) {
      resolve();
      return;
    }

    const timeout = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });

    function done(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });

export function createDefaultNaverOrderSchedulerDependencies(
  config: NaverOrderSchedulerConfig,
): NaverOrderSchedulerDependencies {
  return {
    store: new PostgresNaverOrderSchedulerStore(),
    clock: { now: () => new Date() },
    sleep: defaultNaverOrderSchedulerSleep,
    config,
  };
}

export async function runNaverOrderSchedulerIteration(
  dependencies: NaverOrderSchedulerDependencies,
  signal: AbortSignal,
): Promise<number> {
  if (signal.aborted) return 0;

  const runs = await dependencies.store.enqueueDue({
    now: dependencies.clock.now(),
    syncIntervalMs: dependencies.config.syncIntervalMs,
    initialLookbackMs: dependencies.config.initialLookbackMs,
    maxAttempts: dependencies.config.maxAttempts,
    batchSize: dependencies.config.batchSize,
  });
  return runs.length;
}

export async function runNaverOrderSchedulerLoop(
  dependencies: NaverOrderSchedulerDependencies,
  signal: AbortSignal,
): Promise<void> {
  validateNaverOrderSchedulerConfig(dependencies.config);

  while (!signal.aborted) {
    try {
      await runNaverOrderSchedulerIteration(dependencies, signal);
    } catch {
      // Database failures may include credentials in their diagnostic context.
      console.error("A Naver order scheduler iteration failed.");
    }

    if (!signal.aborted) {
      await dependencies.sleep(dependencies.config.pollIntervalMs, signal);
    }
  }
}
