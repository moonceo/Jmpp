import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { TransactionClient } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http/api-error";

export const SYNC_STREAMS = ["ACCOUNT_VERIFY", "ORDERS"] as const;
export type SyncStream = (typeof SYNC_STREAMS)[number];

export type SyncRunStatus =
    | "PENDING"
    | "RUNNING"
    | "SUCCEEDED"
    | "PARTIAL"
    | "RETRY"
    | "FAILED"
    | "CANCELED"
    | "DEAD";

interface SyncRunRow extends QueryResultRow {
    id: string;
    market_account_id: string;
    market_code: string;
    store_name: string;
    stream: SyncStream;
    trigger_type: string;
    status: SyncRunStatus;
    correlation_id: string;
    scheduled_for: Date;
    started_at: Date | null;
    completed_at: Date | null;
    records_seen: number;
    records_inserted: number;
    records_updated: number;
    records_skipped: number;
    error_count: number;
    attempt_count: number;
    max_attempts: number;
    next_attempt_at: Date;
    error_code: string | null;
    error_message: string | null;
    version: string;
    created_at: Date;
    updated_at: Date;
}

interface MarketAccountSyncRow extends QueryResultRow {
    id: string;
    market_code: string;
    auth_status: string;
    is_active: boolean;
}

export interface SyncRun {
    id: string;
    marketAccountId: string;
    marketCode: string;
    storeName: string;
    stream: SyncStream;
    triggerType: string;
    status: SyncRunStatus;
    correlationId: string;
    scheduledFor: string;
    startedAt: string | null;
    completedAt: string | null;
    counters: {
        seen: number;
        inserted: number;
        updated: number;
        skipped: number;
        errors: number;
    };
    attemptCount: number;
    maxAttempts: number;
    nextAttemptAt: string;
    errorCode: string | null;
    errorMessage: string | null;
    version: string;
    createdAt: string;
    updatedAt: string;
}

export interface EnqueueSyncRunInput {
    tenantId: string;
    marketAccountId: string;
    membershipId: string;
    stream: SyncStream;
    correlationId: string;
}

export interface EnqueueSyncRunResult {
    run: SyncRun;
    reused: boolean;
}

export interface SyncRunPage {
    items: SyncRun[];
    nextCursor: string | null;
}

const syncCursorSchema = z.object({
    v: z.literal(1),
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    filterHash: z.string().regex(/^[0-9a-f]{64}$/),
});

function syncFilterHash(options: { marketAccountId?: string; status?: SyncRunStatus }): string {
    return createHash("sha256").update(JSON.stringify({
        marketAccountId: options.marketAccountId ?? null,
        status: options.status ?? null,
    })).digest("hex");
}

function cursorSecret(): string {
    const secret = process.env.CURSOR_SIGNING_SECRET?.trim();
    if (!secret || secret.length < 32) {
        throw new ApiError(503, "CURSOR_SIGNING_NOT_CONFIGURED", "목록 커서 서명 구성이 완료되지 않았습니다.");
    }
    return secret;
}

function cursorMac(payload: string, secret: string): Buffer {
    return createHmac("sha256", secret).update(payload).digest();
}

function decodeSyncCursor(value: string | undefined, expectedFilterHash: string) {
    if (!value) return null;
    const secret = cursorSecret();

    try {
        const [payload, signature, ...extra] = value.split(".");
        if (!payload || !signature || extra.length > 0) throw new Error("invalid cursor envelope");
        const supplied = Buffer.from(signature, "base64url");
        const expected = cursorMac(payload, secret);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            throw new Error("invalid cursor signature");
        }
        const parsed = syncCursorSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
        if (parsed.filterHash !== expectedFilterHash) throw new Error("cursor filter mismatch");
        return parsed;
    } catch {
        throw new ApiError(400, "INVALID_CURSOR", "동기화 목록 커서가 현재 검색조건과 맞지 않습니다.");
    }
}

function encodeSyncCursor(row: SyncRunRow, filterHash: string): string {
    const payload = Buffer.from(JSON.stringify({
        v: 1,
        createdAt: row.created_at.toISOString(),
        id: row.id,
        filterHash,
    })).toString("base64url");
    const signature = cursorMac(payload, cursorSecret()).toString("base64url");

    return `${payload}.${signature}`;
}

const syncRunColumns = `
    sr.id, sr.market_account_id, ma.market_code, ma.store_name,
    sr.stream, sr.trigger_type, sr.status, sr.correlation_id,
    sr.scheduled_for, sr.started_at, sr.completed_at,
    sr.records_seen, sr.records_inserted, sr.records_updated,
    sr.records_skipped, sr.error_count, sr.attempt_count, sr.max_attempts,
    sr.next_attempt_at, sr.error_code, sr.error_message,
    sr.version::text AS version, sr.created_at, sr.updated_at`;

function toSyncRun(row: SyncRunRow): SyncRun {
    return {
        id: row.id,
        marketAccountId: row.market_account_id,
        marketCode: row.market_code,
        storeName: row.store_name,
        stream: row.stream,
        triggerType: row.trigger_type,
        status: row.status,
        correlationId: row.correlation_id,
        scheduledFor: row.scheduled_for.toISOString(),
        startedAt: row.started_at?.toISOString() ?? null,
        completedAt: row.completed_at?.toISOString() ?? null,
        counters: {
            seen: row.records_seen,
            inserted: row.records_inserted,
            updated: row.records_updated,
            skipped: row.records_skipped,
            errors: row.error_count,
        },
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        nextAttemptAt: row.next_attempt_at.toISOString(),
        errorCode: row.error_code,
        errorMessage: row.error_message,
        version: row.version,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}

export async function getSyncRun(
    client: TransactionClient,
    tenantId: string,
    runId: string,
): Promise<SyncRun> {
    const result = await client.query<SyncRunRow>(
        `SELECT ${syncRunColumns}
           FROM sync_runs sr
           JOIN market_accounts ma
             ON ma.tenant_id = sr.tenant_id
            AND ma.id = sr.market_account_id
          WHERE sr.tenant_id = $1
            AND sr.id = $2
            AND sr.deleted_at IS NULL`,
        [tenantId, runId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "SYNC_RUN_NOT_FOUND", "동기화 작업을 찾을 수 없습니다.");

    return toSyncRun(row);
}

export async function enqueueSyncRun(
    client: TransactionClient,
    input: EnqueueSyncRunInput,
): Promise<EnqueueSyncRunResult> {
    await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [input.marketAccountId],
    );
    const accountResult = await client.query<MarketAccountSyncRow>(
        `SELECT id, market_code, auth_status, is_active
           FROM market_accounts
          WHERE tenant_id = $1
            AND id = $2
            AND deleted_at IS NULL`,
        [input.tenantId, input.marketAccountId],
    );
    const account = accountResult.rows[0];

    if (!account) throw new ApiError(404, "MARKET_ACCOUNT_NOT_FOUND", "마켓 계정을 찾을 수 없습니다.");
    if (!account.is_active) throw new ApiError(409, "MARKET_ACCOUNT_INACTIVE", "비활성 마켓 계정입니다.");
    if (account.market_code !== "NAVER") {
        throw new ApiError(422, "MARKET_ADAPTER_NOT_READY", "현재 실연동 워커는 스마트스토어부터 지원합니다.");
    }
    if (input.stream === "ORDERS" && account.auth_status !== "CONNECTED") {
        throw new ApiError(409, "MARKET_ACCOUNT_NOT_CONNECTED", "연결 확인을 먼저 완료해 주세요.");
    }

    const insertSql = `INSERT INTO sync_runs (
             tenant_id, market_account_id, stream, trigger_type, status,
             correlation_id, requested_by_membership_id
         ) VALUES ($1, $2, $3, 'MANUAL', 'PENDING', $4, $5)
         ON CONFLICT (tenant_id, market_account_id, stream)
             WHERE deleted_at IS NULL AND status IN ('PENDING', 'RUNNING', 'RETRY')
         DO NOTHING
         RETURNING id`;
    const insertValues = [
        input.tenantId,
        input.marketAccountId,
        input.stream,
        input.correlationId,
        input.membershipId,
    ];
    const inserted = await client.query<{ id: string } & QueryResultRow>(insertSql, insertValues);

    let runId = inserted.rows[0]?.id;
    let reused = !runId;
    if (!runId) {
        const existing = await client.query<{ id: string } & QueryResultRow>(
            `SELECT id
               FROM sync_runs
              WHERE tenant_id = $1
                AND market_account_id = $2
                AND stream = $3
                AND status IN ('PENDING', 'RUNNING', 'RETRY')
                AND deleted_at IS NULL
              ORDER BY created_at DESC
              LIMIT 1`,
            [input.tenantId, input.marketAccountId, input.stream],
        );
        runId = existing.rows[0]?.id;

        if (!runId) {
            const retried = await client.query<{ id: string } & QueryResultRow>(insertSql, insertValues);
            runId = retried.rows[0]?.id;
            reused = false;
        }
    }

    if (!runId) throw new ApiError(409, "SYNC_ENQUEUE_CONFLICT", "동기화 작업 접수 중 충돌이 발생했습니다.");

    if (!reused) {
        await client.query(
            `INSERT INTO audit_logs (
                 tenant_id, market_account_id, actor_type, actor_membership_id,
                 action, entity_type, entity_id, correlation_id, after_snapshot
             ) VALUES ($1, $2, 'USER', $3, 'SYNC_RUN_ENQUEUED',
                       'SYNC_RUN', $4, $5::uuid, $6::jsonb)`,
            [
                input.tenantId,
                input.marketAccountId,
                input.membershipId,
                runId,
                input.correlationId,
                JSON.stringify({ stream: input.stream, triggerType: "MANUAL", status: "PENDING" }),
            ],
        );
    }

    return { run: await getSyncRun(client, input.tenantId, runId), reused };
}

export async function listSyncRuns(
    client: TransactionClient,
    tenantId: string,
    options: { limit: number; cursor?: string; marketAccountId?: string; status?: SyncRunStatus },
): Promise<SyncRunPage> {
    const filterHash = syncFilterHash(options);
    const cursor = decodeSyncCursor(options.cursor, filterHash);
    const result = await client.query<SyncRunRow>(
        `SELECT ${syncRunColumns}
           FROM sync_runs sr
           JOIN market_accounts ma
             ON ma.tenant_id = sr.tenant_id
            AND ma.id = sr.market_account_id
          WHERE sr.tenant_id = $1
            AND sr.deleted_at IS NULL
            AND ($2::uuid IS NULL OR sr.market_account_id = $2)
            AND ($3::text IS NULL OR sr.status = $3)
            AND (
                $4::timestamptz IS NULL
                OR (sr.created_at, sr.id) < ($4::timestamptz, $5::uuid)
            )
          ORDER BY sr.created_at DESC, sr.id DESC
          LIMIT $6`,
        [
            tenantId,
            options.marketAccountId ?? null,
            options.status ?? null,
            cursor?.createdAt ?? null,
            cursor?.id ?? null,
            options.limit + 1,
        ],
    );

    const hasNextPage = result.rows.length > options.limit;
    const rows = result.rows.slice(0, options.limit);

    return {
        items: rows.map(toSyncRun),
        nextCursor: hasNextPage && rows.length > 0
            ? encodeSyncCursor(rows[rows.length - 1], filterHash)
            : null,
    };
}
