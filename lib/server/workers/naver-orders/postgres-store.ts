import type { Pool, QueryResultRow } from "pg";

import {
  getDbPool,
  withTenantTransaction,
  withTransaction,
  type TransactionClient,
} from "@/lib/server/db";
import { encryptCredential } from "@/lib/server/security";
import {
  ClaimPersistenceError,
  upsertInboundClaimSnapshot,
} from "@/lib/server/claims";
import {
  deriveSalesOrderNormalizedStatus,
  type HeaderItemStatus,
} from "@/lib/server/workers/naver-orders/header-status";
import {
  buildRecipientFieldSecretType,
  recipientBlindIndex,
  recipientFingerprintInput,
  recipientNeedsNewVersion,
  type RecipientField,
} from "@/lib/server/workers/naver-orders/recipient-security";
import type {
  CompleteAccountVerificationInput,
  FailRunInput,
  FinishRunInput,
  LeasedNaverSyncRun,
  MappedNaverRecipient,
  NaverSyncContext,
  NaverSyncStore,
  PagePersistenceResult,
  PersistNaverPageInput,
  PostgresNaverSyncStoreOptions,
  PreparedNaverRecord,
} from "@/lib/server/workers/naver-orders/types";

interface LeaseRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  market_account_id: string;
  stream: "ORDERS" | "ACCOUNT_VERIFY";
  attempt_count: number | string;
  max_attempts: number | string;
  window_start: Date | null;
  window_end: Date;
}

interface ContextRow extends QueryResultRow {
  secret_id: string | null;
  encrypted_payload: string | null;
  account_settings: Record<string, unknown>;
  cursor_value: Record<string, unknown> | null;
  watermark_at: Date | null;
  overlap_seconds: number | null;
}

interface IdRow extends QueryResultRow {
  id: string;
}

interface UpsertRow extends IdRow {
  inserted: boolean;
}

interface CurrentRecipientRow extends IdRow {
  fingerprint_sha256: string;
}

interface OrderAggregateRow extends QueryResultRow {
  item_total: string;
  item_statuses: HeaderItemStatus[];
}

const RAW_SECRET_TYPE = "RAW_SNAPSHOT" as const;
const CREDENTIAL_SECRET_TYPE = "MARKET_API_CREDENTIALS" as const;

function postgresErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}

function durableClaimQuarantineCode(error: unknown): string | null {
  if (error instanceof ClaimPersistenceError) return error.code;
  const code = postgresErrorCode(error);
  return code === "23514" ? "CLAIM_CONSTRAINT_VIOLATION" : null;
}

export class NaverSyncStoreError extends Error {
  constructor(
    readonly code:
      | "SYNC_LEASE_LOST"
      | "SYNC_CONTEXT_NOT_FOUND"
      | "SYNC_CREDENTIALS_NOT_FOUND"
      | "ORDER_UPSERT_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "NaverSyncStoreError";
  }
}

function toLeasedRun(row: LeaseRow): LeasedNaverSyncRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    marketAccountId: row.market_account_id,
    stream: row.stream,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    windowStart: row.window_start?.toISOString() ?? null,
    windowEnd: row.window_end.toISOString(),
  };
}

function expiryDate(now: Date, durationMs: number): Date {
  return new Date(now.getTime() + durationMs);
}

async function assertLease(
  client: TransactionClient,
  run: LeasedNaverSyncRun,
  leaseOwner: string,
): Promise<void> {
  const result = await client.query(
    `SELECT 1
       FROM sync_runs
      WHERE tenant_id = $1
        AND market_account_id = $2
        AND id = $3
        AND status = 'RUNNING'
        AND lease_owner = $4
        AND deleted_at IS NULL
      FOR UPDATE`,
    [run.tenantId, run.marketAccountId, run.id, leaseOwner],
  );

  if (result.rowCount !== 1) {
    throw new NaverSyncStoreError(
      "SYNC_LEASE_LOST",
      "The sync run is no longer leased by this worker.",
    );
  }
}

async function lockMarketAccountLifecycle(
  client: TransactionClient,
  marketAccountId: string,
): Promise<void> {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
    [marketAccountId],
  );
}

function normalizedEventPayload(record: PreparedNaverRecord): Record<string, unknown> {
  if (!record.mapping.ok) {
    return {
      market: "NAVER",
      productOrderId: record.externalResourceId,
      mappingError: record.mapping.code,
      sourceUpdatedAt: record.sourceEventAt,
    };
  }

  return {
    market: "NAVER",
    externalOrderId: record.mapping.value.order.externalOrderId,
    productOrderId: record.mapping.value.item.externalOrderItemId,
    marketStatus: record.mapping.value.item.marketStatusRaw,
    normalizedStatus: record.mapping.value.order.normalizedStatus,
    sourceUpdatedAt: record.mapping.value.item.sourceUpdatedAt,
  };
}

export class PostgresNaverSyncStore implements NaverSyncStore {
  private readonly pool: Pool;
  private readonly encryptPayload: NonNullable<
    PostgresNaverSyncStoreOptions["encryptPayload"]
  >;
  private readonly encryptRecipientField: NonNullable<
    PostgresNaverSyncStoreOptions["encryptRecipientField"]
  >;
  private readonly recipientBlindIndex: NonNullable<
    PostgresNaverSyncStoreOptions["recipientBlindIndex"]
  >;
  private readonly upsertInboundClaim: NonNullable<
    PostgresNaverSyncStoreOptions["upsertInboundClaim"]
  >;

  constructor(options: PostgresNaverSyncStoreOptions = {}) {
    this.pool = options.pool ?? getDbPool();
    this.encryptPayload = options.encryptPayload ?? encryptCredential;
    this.encryptRecipientField =
      options.encryptRecipientField ?? encryptCredential;
    this.recipientBlindIndex =
      options.recipientBlindIndex ?? recipientBlindIndex;
    this.upsertInboundClaim =
      options.upsertInboundClaim ?? upsertInboundClaimSnapshot;
  }

  private async persistCurrentRecipient(
    client: TransactionClient,
    input: {
      run: LeasedNaverSyncRun;
      salesOrderId: string;
      recipient: MappedNaverRecipient;
      now: Date;
    },
  ): Promise<void> {
    const context = (field: RecipientField) => ({
      tenantId: input.run.tenantId,
      marketAccountId: input.run.marketAccountId,
      secretType: buildRecipientFieldSecretType(input.salesOrderId, field),
    });
    const encryptOptional = (
      value: string | null,
      field: RecipientField,
    ): string | null =>
      value === null
        ? null
        : this.encryptRecipientField(value, context(field));
    const fingerprint = this.recipientBlindIndex(
      recipientFingerprintInput(input.recipient),
      "FINGERPRINT",
    );
    const current = await client.query<CurrentRecipientRow>(
      `SELECT id, fingerprint_sha256
         FROM order_recipients
        WHERE tenant_id = $1
          AND sales_order_id = $2
          AND is_current
          AND deleted_at IS NULL
        FOR UPDATE`,
      [input.run.tenantId, input.salesOrderId],
    );
    const existing = current.rows[0];
    if (
      !recipientNeedsNewVersion(
        existing?.fingerprint_sha256 ?? null,
        fingerprint,
      )
    ) {
      return;
    }

    const encryptedName = this.encryptRecipientField(
      input.recipient.name,
      context("NAME"),
    );
    const encryptedAddressLine1 = this.encryptRecipientField(
      input.recipient.addressLine1,
      context("ADDRESS_LINE1"),
    );
    const encryptedPhone = encryptOptional(input.recipient.phone, "PHONE");
    const encryptedPostalCode = encryptOptional(
      input.recipient.postalCode,
      "POSTAL_CODE",
    );
    const encryptedAddressLine2 = encryptOptional(
      input.recipient.addressLine2,
      "ADDRESS_LINE2",
    );
    const encryptedCustomsCode = encryptOptional(
      input.recipient.personalCustomsCode,
      "CUSTOMS_CODE",
    );
    const encryptedDeliveryMessage = encryptOptional(
      input.recipient.deliveryMessage,
      "DELIVERY_MESSAGE",
    );
    const phoneBlindIndex = input.recipient.phone
      ? this.recipientBlindIndex(input.recipient.phone, "PHONE")
      : null;
    const customsBlindIndex = input.recipient.personalCustomsCode
      ? this.recipientBlindIndex(
          input.recipient.personalCustomsCode,
          "CUSTOMS",
        )
      : null;

    if (existing) {
      await client.query(
        `UPDATE order_recipients
            SET is_current = false,
                version = version + 1,
                updated_at = $3::timestamptz
          WHERE tenant_id = $1
            AND id = $2`,
        [input.run.tenantId, existing.id, input.now],
      );
    }

    await client.query(
      `INSERT INTO order_recipients (
           tenant_id, sales_order_id, recipient_name_masked,
           recipient_name_encrypted, phone_encrypted, postal_code_encrypted,
           address_line1_encrypted, address_line2_encrypted,
           personal_customs_code_encrypted, delivery_message_encrypted,
           phone_blind_index, customs_code_blind_index, fingerprint_sha256,
           encryption_key_version, is_current, created_at, updated_at
       ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           1, true, $14::timestamptz, $14::timestamptz
       )`,
      [
        input.run.tenantId,
        input.salesOrderId,
        input.recipient.nameMasked,
        encryptedName,
        encryptedPhone,
        encryptedPostalCode,
        encryptedAddressLine1,
        encryptedAddressLine2,
        encryptedCustomsCode,
        encryptedDeliveryMessage,
        phoneBlindIndex,
        customsBlindIndex,
        fingerprint,
        input.now,
      ],
    );
  }

  async leaseNext(input: {
    leaseOwner: string;
    now: Date;
    leaseDurationMs: number;
    retryBaseMs: number;
    retryCapMs: number;
  }): Promise<LeasedNaverSyncRun | null> {
    return withTransaction(
      async (client) => {
        await client.query(
          `WITH expired AS (
             SELECT sr.id
               FROM sync_runs sr
               JOIN market_accounts ma
                 ON ma.tenant_id = sr.tenant_id
                AND ma.id = sr.market_account_id
                AND ma.market_code = 'NAVER'
                AND ma.deleted_at IS NULL
              WHERE sr.stream IN ('ORDERS', 'ACCOUNT_VERIFY')
                AND sr.status = 'RUNNING'
                AND sr.lease_until <= $1::timestamptz
                AND sr.deleted_at IS NULL
              FOR UPDATE OF sr SKIP LOCKED
           )
           UPDATE sync_runs sr
              SET status = CASE
                    WHEN sr.attempt_count >= sr.max_attempts THEN 'FAILED'
                    ELSE 'RETRY'
                  END,
                  next_attempt_at = CASE
                    WHEN sr.attempt_count >= sr.max_attempts THEN sr.next_attempt_at
                    ELSE $1::timestamptz + (
                      LEAST(
                        $3::numeric,
                        $2::numeric * power(
                          2::numeric,
                          LEAST(GREATEST(sr.attempt_count - 1, 0), 20)
                        )
                      )::double precision * INTERVAL '1 millisecond'
                    )
                  END,
                  completed_at = CASE
                    WHEN sr.attempt_count >= sr.max_attempts THEN $1::timestamptz
                    ELSE NULL
                  END,
                  lease_owner = NULL,
                  lease_until = NULL,
                  error_count = sr.error_count + 1,
                  error_code = 'WORKER_LEASE_EXPIRED',
                  error_message = 'The previous worker lease expired before completion.',
                  version = sr.version + 1,
                  updated_at = $1::timestamptz
             FROM expired
            WHERE sr.id = expired.id`,
          [input.now, input.retryBaseMs, input.retryCapMs],
        );

        await client.query(
          `WITH exhausted AS (
             SELECT sr.id
               FROM sync_runs sr
               JOIN market_accounts ma
                 ON ma.tenant_id = sr.tenant_id
                AND ma.id = sr.market_account_id
                AND ma.market_code = 'NAVER'
                AND ma.deleted_at IS NULL
              WHERE sr.stream IN ('ORDERS', 'ACCOUNT_VERIFY')
                AND sr.status IN ('PENDING', 'RETRY')
                AND sr.attempt_count >= sr.max_attempts
                AND sr.deleted_at IS NULL
              FOR UPDATE OF sr SKIP LOCKED
           )
           UPDATE sync_runs sr
              SET status = 'FAILED',
                  completed_at = $1::timestamptz,
                  lease_owner = NULL,
                  lease_until = NULL,
                  error_count = sr.error_count + 1,
                  error_code = 'SYNC_MAX_ATTEMPTS_EXHAUSTED',
                  error_message = 'The sync run exhausted its retry budget.',
                  version = sr.version + 1,
                  updated_at = $1::timestamptz
             FROM exhausted
            WHERE sr.id = exhausted.id`,
          [input.now],
        );

        const leaseUntil = expiryDate(input.now, input.leaseDurationMs);
        const result = await client.query<LeaseRow>(
          `WITH candidate AS (
             SELECT sr.id
               FROM sync_runs sr
               JOIN market_accounts ma
                 ON ma.tenant_id = sr.tenant_id
                AND ma.id = sr.market_account_id
                AND ma.deleted_at IS NULL
                AND ma.is_active
              WHERE sr.deleted_at IS NULL
                AND sr.status IN ('PENDING', 'RETRY')
                AND sr.attempt_count < sr.max_attempts
                AND sr.scheduled_for <= $1::timestamptz
                AND sr.next_attempt_at <= $1::timestamptz
                AND sr.stream IN ('ORDERS', 'ACCOUNT_VERIFY')
                AND ma.market_code = 'NAVER'
                AND (
                  (sr.stream = 'ORDERS' AND ma.auth_status = 'CONNECTED')
                  OR (
                    sr.stream = 'ACCOUNT_VERIFY'
                    AND ma.auth_status <> 'DISCONNECTED'
                  )
                )
              ORDER BY sr.next_attempt_at, sr.scheduled_for, sr.id
              FOR UPDATE OF sr SKIP LOCKED
              LIMIT 1
           )
           UPDATE sync_runs sr
              SET status = 'RUNNING',
                  attempt_count = sr.attempt_count + 1,
                  started_at = COALESCE(sr.started_at, $1::timestamptz),
                  completed_at = NULL,
                  window_end = COALESCE(sr.window_end, $1::timestamptz),
                  lease_owner = $2,
                  lease_until = $3::timestamptz,
                  error_code = NULL,
                  error_message = NULL,
                  version = sr.version + 1,
                  updated_at = $1::timestamptz
             FROM candidate
            WHERE sr.id = candidate.id
            RETURNING sr.id, sr.tenant_id, sr.market_account_id, sr.stream,
                      sr.attempt_count, sr.max_attempts, sr.window_start,
                      sr.window_end`,
          [input.now, input.leaseOwner, leaseUntil],
        );

        return result.rows[0] ? toLeasedRun(result.rows[0]) : null;
      },
      {},
      this.pool,
    );
  }

  async renewLease(
    run: LeasedNaverSyncRun,
    leaseOwner: string,
    now: Date,
    leaseDurationMs: number,
  ): Promise<void> {
    await withTenantTransaction(
      run.tenantId,
      async (client) => {
        const result = await client.query(
          `UPDATE sync_runs
              SET lease_until = $5::timestamptz,
                  version = version + 1,
                  updated_at = $4::timestamptz
            WHERE tenant_id = $1
              AND market_account_id = $2
              AND id = $3
              AND status = 'RUNNING'
              AND lease_owner = $6
              AND deleted_at IS NULL`,
          [
            run.tenantId,
            run.marketAccountId,
            run.id,
            now,
            expiryDate(now, leaseDurationMs),
            leaseOwner,
          ],
        );
        if (result.rowCount !== 1) {
          throw new NaverSyncStoreError(
            "SYNC_LEASE_LOST",
            "The sync run lease could not be renewed.",
          );
        }
      },
      {},
      this.pool,
    );
  }

  async loadContext(
    run: LeasedNaverSyncRun,
    leaseOwner: string,
    now: Date,
  ): Promise<NaverSyncContext> {
    return withTenantTransaction(
      run.tenantId,
      async (client) => {
        const result = await client.query<ContextRow>(
          `SELECT secret.id AS secret_id,
                  secret.encrypted_payload,
                  ma.settings AS account_settings,
                  cursor.cursor_value,
                  cursor.watermark_at,
                  cursor.overlap_seconds
             FROM sync_runs sr
             JOIN market_accounts ma
               ON ma.tenant_id = sr.tenant_id
              AND ma.id = sr.market_account_id
              AND ma.deleted_at IS NULL
             LEFT JOIN LATERAL (
               SELECT s.id, s.encrypted_payload
                 FROM integration_secrets s
                WHERE s.tenant_id = sr.tenant_id
                  AND s.market_account_id = sr.market_account_id
                  AND s.secret_type = $5
                  AND s.revoked_at IS NULL
                  AND s.deleted_at IS NULL
                ORDER BY s.created_at DESC, s.id DESC
                LIMIT 1
             ) secret ON true
             LEFT JOIN sync_cursors cursor
               ON cursor.tenant_id = sr.tenant_id
              AND cursor.market_account_id = sr.market_account_id
              AND cursor.stream = 'ORDERS'
              AND cursor.deleted_at IS NULL
            WHERE sr.tenant_id = $1
              AND sr.market_account_id = $2
              AND sr.id = $3
              AND sr.status = 'RUNNING'
              AND sr.lease_owner = $4
              AND sr.deleted_at IS NULL`,
          [
            run.tenantId,
            run.marketAccountId,
            run.id,
            leaseOwner,
            CREDENTIAL_SECRET_TYPE,
          ],
        );
        const row = result.rows[0];
        if (!row) {
          throw new NaverSyncStoreError(
            "SYNC_CONTEXT_NOT_FOUND",
            "The leased sync context is unavailable.",
          );
        }
        if (!row.secret_id || !row.encrypted_payload) {
          throw new NaverSyncStoreError(
            "SYNC_CREDENTIALS_NOT_FOUND",
            "Active marketplace API credentials are unavailable.",
          );
        }

        await client.query(
          `UPDATE integration_secrets
              SET last_used_at = $3::timestamptz,
                  version = version + 1,
                  updated_at = $3::timestamptz
            WHERE tenant_id = $1
              AND id = $2`,
          [run.tenantId, row.secret_id, now],
        );

        return {
          encryptedCredentials: row.encrypted_payload,
          credentialSecretType: CREDENTIAL_SECRET_TYPE,
          accountSettings: row.account_settings ?? {},
          cursor:
            row.cursor_value === null
              ? null
              : {
                  cursorValue: row.cursor_value,
                  watermarkAt: row.watermark_at?.toISOString() ?? null,
                  overlapSeconds: row.overlap_seconds ?? 300,
                },
        };
      },
      {},
      this.pool,
    );
  }

  async persistPage(
    input: PersistNaverPageInput,
  ): Promise<PagePersistenceResult> {
    return withTenantTransaction(
      input.run.tenantId,
      async (client) => {
        await lockMarketAccountLifecycle(client, input.run.marketAccountId);
        await assertLease(client, input.run, input.leaseOwner);
        const counts: PagePersistenceResult = {
          inserted: 0,
          updated: 0,
          skipped: input.additionalSkipped,
          errors: input.additionalErrors,
        };
        const expiresAt = new Date(
          input.now.getTime() + input.rawRetentionDays * 86_400_000,
        );
        const affectedSalesOrderIds = new Set<string>();

        for (const record of input.records) {
          const encryptedPayload = this.encryptPayload(record.rawPayload, {
            tenantId: input.run.tenantId,
            marketAccountId: input.run.marketAccountId,
            secretType: RAW_SECRET_TYPE,
          });
          const snapshot = await client.query<IdRow>(
            `INSERT INTO raw_snapshots (
                 tenant_id, market_account_id, sync_run_id, direction, stream,
                 resource_type, external_resource_id, payload_encrypted,
                 payload_sha256, content_type, schema_version, source_event_at,
                 received_at, expires_at
             ) VALUES (
                 $1, $2, $3, 'INBOUND', 'ORDERS', 'NAVER_PRODUCT_ORDER',
                 $4, $5, $6, 'application/json', 1, $7::timestamptz,
                 $8::timestamptz, $9::timestamptz
             )
             ON CONFLICT (
               tenant_id,
               market_account_id,
               stream,
               resource_type,
               (COALESCE(external_resource_id, '')),
               payload_sha256
             ) WHERE deleted_at IS NULL AND direction = 'INBOUND'
             DO UPDATE SET payload_sha256 = raw_snapshots.payload_sha256
             RETURNING id`,
            [
              input.run.tenantId,
              input.run.marketAccountId,
              input.run.id,
              record.externalResourceId,
              encryptedPayload,
              record.payloadSha256,
              record.sourceEventAt,
              input.now,
              expiresAt,
            ],
          );
          const snapshotId = snapshot.rows[0]?.id;
          if (!snapshotId) {
            throw new NaverSyncStoreError(
              "ORDER_UPSERT_FAILED",
              "The inbound payload snapshot could not be stored.",
            );
          }

          const eventStatus = record.mapping.ok ? "PENDING" : "FAILED";
          const event = await client.query<IdRow>(
            `INSERT INTO integration_events (
                 tenant_id, market_account_id, sync_run_id, raw_snapshot_id,
                 event_type, dedupe_key, aggregate_type,
                 aggregate_external_id, normalized_payload, status,
                 occurred_at, received_at, processed_at, attempt_count,
                 error_code, error_message
             ) VALUES (
                 $1, $2, $3, $4, 'NAVER_PRODUCT_ORDER_CHANGED', $5,
                 'ORDER_ITEM', $6, $7::jsonb, $8, $9::timestamptz,
                 $10::timestamptz,
                 CASE WHEN $8 = 'FAILED' THEN $10::timestamptz ELSE NULL END,
                 1, $11, $12
             )
             ON CONFLICT (tenant_id, market_account_id, dedupe_key)
             WHERE deleted_at IS NULL
             DO NOTHING
             RETURNING id`,
            [
              input.run.tenantId,
              input.run.marketAccountId,
              input.run.id,
              snapshotId,
              record.dedupeKey,
              record.externalResourceId,
              JSON.stringify(normalizedEventPayload(record)),
              eventStatus,
              record.sourceEventAt,
              input.now,
              record.mapping.ok ? null : record.mapping.code,
              record.mapping.ok
                ? null
                : "The marketplace record could not be normalized.",
            ],
          );
          const eventId = event.rows[0]?.id;
          if (!eventId) {
            counts.skipped += 1;
            continue;
          }
          if (!record.mapping.ok) {
            counts.skipped += 1;
            counts.errors += 1;
            continue;
          }

          const mapped = record.mapping.value;
          const orderResult = await client.query<UpsertRow>(
            `INSERT INTO sales_orders (
                 tenant_id, market_account_id, external_order_id,
                 external_order_number, normalized_status, market_status_raw,
                 currency_code, gross_amount, paid_amount, buyer_name_masked,
                 ordered_at, paid_at, source_created_at, source_updated_at,
                 market_status_updated_at, attributes
             ) VALUES (
                 $1, $2, $3, $4, $5, $6, 'KRW', $7, $8, $9,
                 $10::timestamptz, $11::timestamptz, $12::timestamptz,
                 $13::timestamptz, $14::timestamptz, $15::jsonb
             )
             ON CONFLICT (tenant_id, market_account_id, external_order_id)
             WHERE deleted_at IS NULL
             DO UPDATE SET
                 external_order_number = COALESCE(
                   EXCLUDED.external_order_number,
                   sales_orders.external_order_number
                 ),
                 normalized_status = sales_orders.normalized_status,
                 market_status_raw = EXCLUDED.market_status_raw,
                 gross_amount = GREATEST(
                   sales_orders.gross_amount,
                   EXCLUDED.gross_amount
                 ),
                 paid_amount = GREATEST(
                   sales_orders.paid_amount,
                   EXCLUDED.paid_amount
                 ),
                 buyer_name_masked = COALESCE(
                   EXCLUDED.buyer_name_masked,
                   sales_orders.buyer_name_masked
                 ),
                 ordered_at = LEAST(
                   sales_orders.ordered_at,
                   EXCLUDED.ordered_at
                 ),
                 paid_at = COALESCE(EXCLUDED.paid_at, sales_orders.paid_at),
                 source_created_at = COALESCE(
                   sales_orders.source_created_at,
                   EXCLUDED.source_created_at
                 ),
                 source_updated_at = EXCLUDED.source_updated_at,
                 market_status_updated_at = EXCLUDED.market_status_updated_at,
                 attributes = sales_orders.attributes || EXCLUDED.attributes,
                 version = sales_orders.version + 1,
                 updated_at = $16::timestamptz
             WHERE sales_orders.source_updated_at IS NULL
                OR EXCLUDED.source_updated_at > sales_orders.source_updated_at
             RETURNING id, (xmax = 0) AS inserted`,
            [
              input.run.tenantId,
              input.run.marketAccountId,
              mapped.order.externalOrderId,
              mapped.order.externalOrderNumber,
              mapped.order.normalizedStatus,
              mapped.order.marketStatusRaw,
              mapped.order.grossAmount,
              mapped.order.paidAmount,
              mapped.order.buyerNameMasked,
              mapped.order.orderedAt,
              mapped.order.paidAt,
              mapped.order.sourceCreatedAt,
              mapped.order.sourceUpdatedAt,
              mapped.order.marketStatusUpdatedAt,
              JSON.stringify(mapped.order.attributes),
              input.now,
            ],
          );
          const orderApplied = orderResult.rows[0] !== undefined;
          let salesOrderId = orderResult.rows[0]?.id;
          if (!salesOrderId) {
            const existingOrder = await client.query<IdRow>(
              `SELECT id
                 FROM sales_orders
                WHERE tenant_id = $1
                  AND market_account_id = $2
                  AND external_order_id = $3
                  AND deleted_at IS NULL`,
              [
                input.run.tenantId,
                input.run.marketAccountId,
                mapped.order.externalOrderId,
              ],
            );
            salesOrderId = existingOrder.rows[0]?.id;
          }
          if (!salesOrderId) {
            throw new NaverSyncStoreError(
              "ORDER_UPSERT_FAILED",
              "The normalized sales order could not be stored.",
            );
          }

          const trackingPair =
            mapped.item.domesticCarrierCode &&
            mapped.item.domesticTrackingNumber
              ? [
                  mapped.item.domesticCarrierCode,
                  mapped.item.domesticTrackingNumber,
                ]
              : [null, null];
          const itemResult = await client.query<UpsertRow>(
            `INSERT INTO order_items (
                 tenant_id, market_account_id, sales_order_id,
                 external_order_item_id, source_line_key, market_product_id,
                 market_option_id, seller_sku, product_name, option_name,
                 product_url, thumbnail_url, quantity, unit_price, item_total,
                 internal_work_status, market_status_raw,
                 market_fulfillment_status, sourcing_status,
                 market_delivery_method, domestic_carrier_code,
                 domestic_tracking_number, source_updated_at, attributes
             ) VALUES (
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, $18, 'UNMATCHED', $19, $20,
                 $21, $22::timestamptz, $23::jsonb
             )
             ON CONFLICT (tenant_id, market_account_id, source_line_key)
             WHERE deleted_at IS NULL
             DO UPDATE SET
                 sales_order_id = EXCLUDED.sales_order_id,
                 external_order_item_id = EXCLUDED.external_order_item_id,
                 market_product_id = EXCLUDED.market_product_id,
                 market_option_id = EXCLUDED.market_option_id,
                 seller_sku = EXCLUDED.seller_sku,
                 product_name = EXCLUDED.product_name,
                 option_name = EXCLUDED.option_name,
                 product_url = EXCLUDED.product_url,
                 thumbnail_url = EXCLUDED.thumbnail_url,
                 quantity = EXCLUDED.quantity,
                 unit_price = EXCLUDED.unit_price,
                 item_total = EXCLUDED.item_total,
                 internal_work_status = CASE
                   WHEN order_items.internal_work_status IN ('DELIVERED', 'CANCELED')
                   THEN order_items.internal_work_status
                   WHEN EXCLUDED.internal_work_status IN ('DELIVERED', 'CANCELED')
                   THEN EXCLUDED.internal_work_status
                   WHEN EXCLUDED.internal_work_status = 'ON_HOLD'
                   THEN 'ON_HOLD'
                   WHEN order_items.internal_work_status = 'ON_HOLD'
                   THEN order_items.internal_work_status
                   WHEN EXCLUDED.internal_work_status = 'SHIPPING'
                   THEN 'SHIPPING'
                   WHEN EXCLUDED.internal_work_status = 'READY_TO_SHIP'
                    AND order_items.internal_work_status IN ('NEW', 'PREPARING')
                   THEN 'READY_TO_SHIP'
                   WHEN EXCLUDED.internal_work_status = 'PREPARING'
                    AND order_items.internal_work_status = 'NEW'
                   THEN 'PREPARING'
                   ELSE order_items.internal_work_status
                 END,
                 market_status_raw = EXCLUDED.market_status_raw,
                 market_fulfillment_status = EXCLUDED.market_fulfillment_status,
                 market_delivery_method = EXCLUDED.market_delivery_method,
                 domestic_carrier_code = CASE
                   WHEN EXCLUDED.domestic_carrier_code IS NOT NULL
                    AND EXCLUDED.domestic_tracking_number IS NOT NULL
                   THEN EXCLUDED.domestic_carrier_code
                   ELSE order_items.domestic_carrier_code
                 END,
                 domestic_tracking_number = CASE
                   WHEN EXCLUDED.domestic_carrier_code IS NOT NULL
                    AND EXCLUDED.domestic_tracking_number IS NOT NULL
                   THEN EXCLUDED.domestic_tracking_number
                   ELSE order_items.domestic_tracking_number
                 END,
                 source_updated_at = EXCLUDED.source_updated_at,
                 attributes = order_items.attributes || EXCLUDED.attributes,
                 version = order_items.version + 1,
                 updated_at = $24::timestamptz
             WHERE order_items.source_updated_at IS NULL
                OR EXCLUDED.source_updated_at > order_items.source_updated_at
             RETURNING id, (xmax = 0) AS inserted`,
            [
              input.run.tenantId,
              input.run.marketAccountId,
              salesOrderId,
              mapped.item.externalOrderItemId,
              mapped.item.sourceLineKey,
              mapped.item.marketProductId,
              mapped.item.marketOptionId,
              mapped.item.sellerSku,
              mapped.item.productName,
              mapped.item.optionName,
              mapped.item.productUrl,
              mapped.item.thumbnailUrl,
              mapped.item.quantity,
              mapped.item.unitPrice,
              mapped.item.itemTotal,
              mapped.item.internalWorkStatus,
              mapped.item.marketStatusRaw,
              mapped.item.marketFulfillmentStatus,
              mapped.item.marketDeliveryMethod,
              trackingPair[0],
              trackingPair[1],
              mapped.item.sourceUpdatedAt,
              JSON.stringify(mapped.item.attributes),
              input.now,
            ],
          );
          const item = itemResult.rows[0];
          const claimQuarantineCodes: string[] = [];
          if (item) {
            affectedSalesOrderIds.add(salesOrderId);
            if (orderApplied && mapped.recipient) {
              await this.persistCurrentRecipient(client, {
                run: input.run,
                salesOrderId,
                recipient: mapped.recipient,
                now: input.now,
              });
            }

            for (const issue of record.claimMapping.issues) {
              counts.errors += 1;
              claimQuarantineCodes.push(`CLAIM_MAPPING_${issue.code}`);
              await client.query(
                `INSERT INTO audit_logs (
                     tenant_id, market_account_id, actor_type, action,
                     entity_type, entity_id, correlation_id, metadata
                 ) VALUES (
                     $1,$2,'WORKER','CLAIM_INBOUND_SKIPPED','ORDER_ITEM',$3,$4::uuid,$5::jsonb
                 )`,
                [
                  input.run.tenantId,
                  input.run.marketAccountId,
                  item.id,
                  eventId,
                  JSON.stringify({
                    code: issue.code,
                    providerClaimType: issue.providerClaimType,
                    providerClaimStatus: issue.providerClaimStatus,
                    providerWriteIssued: false,
                  }),
                ],
              );
            }

            for (const claim of record.claimMapping.snapshots) {
              await client.query("SAVEPOINT claim_snapshot_upsert");
              try {
                const claimResult = await this.upsertInboundClaim(
                  client,
                  {
                    tenantId: input.run.tenantId,
                    marketAccountId: input.run.marketAccountId,
                    correlationId: eventId,
                  },
                  { ...claim, rawSnapshotRef: snapshotId },
                );
                // Surface deferred case/line invariant failures inside this
                // savepoint so one malformed claim cannot abort sibling orders.
                await client.query(
                  "SET CONSTRAINTS claim_cases_line_consistency, claim_lines_case_consistency IMMEDIATE",
                );
                await client.query(
                  "SET CONSTRAINTS claim_cases_line_consistency, claim_lines_case_consistency DEFERRED",
                );
                await client.query("RELEASE SAVEPOINT claim_snapshot_upsert");
                if (claimResult.ignoredReason === "SAME_TIMESTAMP_CONFLICT"
                  || claimResult.ignoredReason === "INVALID_TRANSITION") {
                  counts.errors += 1;
                  claimQuarantineCodes.push(
                    `CLAIM_${claimResult.ignoredReason}`,
                  );
                }
              } catch (error) {
                const quarantineCode = durableClaimQuarantineCode(error);
                if (!quarantineCode) throw error;

                await client.query("ROLLBACK TO SAVEPOINT claim_snapshot_upsert");
                await client.query("RELEASE SAVEPOINT claim_snapshot_upsert");
                counts.errors += 1;
                claimQuarantineCodes.push(quarantineCode);
                await client.query(
                  `INSERT INTO audit_logs (
                       tenant_id, market_account_id, actor_type, action,
                       entity_type, entity_id, correlation_id, metadata
                   ) VALUES (
                       $1,$2,'WORKER','CLAIM_INBOUND_QUARANTINED','ORDER_ITEM',
                       $3,$4::uuid,$5::jsonb
                   )`,
                  [
                    input.run.tenantId,
                    input.run.marketAccountId,
                    item.id,
                    eventId,
                    JSON.stringify({
                      code: quarantineCode,
                      claimType: claim.claimType,
                      providerWriteIssued: false,
                      rawSnapshotRetained: true,
                    }),
                  ],
                );
              }
            }
          }
          const finalEventStatus = item
            ? claimQuarantineCodes.length > 0
              ? "FAILED"
              : "APPLIED"
            : "IGNORED";
          await client.query(
            `UPDATE integration_events
                SET status = $3,
                    processed_at = $4::timestamptz,
                    error_code = $5,
                    error_message = $6,
                    version = version + 1,
                    updated_at = $4::timestamptz
              WHERE tenant_id = $1
                AND id = $2`,
            [
              input.run.tenantId,
              eventId,
              finalEventStatus,
              input.now,
              claimQuarantineCodes[0] ?? null,
              claimQuarantineCodes.length > 0
                ? "One or more marketplace claim snapshots were quarantined."
                : null,
            ],
          );

          if (!item) counts.skipped += 1;
          else if (item.inserted) counts.inserted += 1;
          else counts.updated += 1;
        }

        for (const salesOrderId of affectedSalesOrderIds) {
          const aggregate = await client.query<OrderAggregateRow>(
            `SELECT COALESCE(SUM(item_total), 0)::text AS item_total,
                    COALESCE(
                      array_agg(internal_work_status ORDER BY id),
                      ARRAY[]::text[]
                    ) AS item_statuses
               FROM order_items
              WHERE tenant_id = $1
                AND market_account_id = $2
                AND sales_order_id = $3
                AND deleted_at IS NULL`,
            [input.run.tenantId, input.run.marketAccountId, salesOrderId],
          );
          const totals = aggregate.rows[0];
          const headerStatus = deriveSalesOrderNormalizedStatus(
            totals?.item_statuses ?? [],
          );
          await client.query(
            `UPDATE sales_orders
                SET normalized_status = $4,
                    gross_amount = $5,
                    paid_amount = CASE
                      WHEN paid_at IS NOT NULL THEN $5
                      ELSE paid_amount
                    END
              WHERE tenant_id = $1
                AND market_account_id = $2
                AND id = $3`,
            [
              input.run.tenantId,
              input.run.marketAccountId,
              salesOrderId,
              headerStatus,
              totals?.item_total ?? "0",
            ],
          );
        }

        if (input.advanceCursor) {
          await client.query(
            `INSERT INTO sync_cursors (
                 tenant_id, market_account_id, stream, cursor_value,
                 watermark_at, overlap_seconds, last_sync_run_id
             ) VALUES (
                 $1, $2, 'ORDERS', $3::jsonb, $4::timestamptz, $5, $6
             )
             ON CONFLICT (tenant_id, market_account_id, stream)
             WHERE deleted_at IS NULL
             DO UPDATE SET
                 cursor_value = EXCLUDED.cursor_value,
                 watermark_at = COALESCE(
                   EXCLUDED.watermark_at,
                   sync_cursors.watermark_at
                 ),
                 last_sync_run_id = EXCLUDED.last_sync_run_id,
                 version = sync_cursors.version + 1,
                 updated_at = $7::timestamptz`,
            [
              input.run.tenantId,
              input.run.marketAccountId,
              JSON.stringify(input.cursorAfter.cursorValue),
              input.cursorAfter.watermarkAt,
              input.overlapSeconds,
              input.run.id,
              input.now,
            ],
          );
        }

        await client.query(
          `UPDATE sync_runs
              SET cursor_before = COALESCE(cursor_before, $5::jsonb),
                  cursor_after = CASE
                    WHEN $6::boolean THEN $7::jsonb
                    ELSE cursor_after
                  END,
                  window_start = COALESCE(window_start, $8::timestamptz),
                  records_seen = records_seen + $9,
                  records_inserted = records_inserted + $10,
                  records_updated = records_updated + $11,
                  records_skipped = records_skipped + $12,
                  error_count = error_count + $13,
                  lease_until = clock_timestamp()
                    + ($14::bigint * INTERVAL '1 millisecond'),
                  version = version + 1,
                  updated_at = $4::timestamptz
            WHERE tenant_id = $1
              AND market_account_id = $2
              AND id = $3
              AND status = 'RUNNING'
              AND lease_owner = $15`,
          [
            input.run.tenantId,
            input.run.marketAccountId,
            input.run.id,
            input.now,
            JSON.stringify(input.cursorBefore),
            input.advanceCursor,
            JSON.stringify(input.cursorAfter.cursorValue),
            input.queryStartedAt,
            input.records.length + input.additionalSeen,
            counts.inserted,
            counts.updated,
            counts.skipped,
            counts.errors,
            input.leaseDurationMs,
            input.leaseOwner,
          ],
        );

        return counts;
      },
      {},
      this.pool,
    );
  }

  async finishRun(input: FinishRunInput): Promise<void> {
    await withTenantTransaction(
      input.run.tenantId,
      async (client) => {
        await lockMarketAccountLifecycle(client, input.run.marketAccountId);
        await assertLease(client, input.run, input.leaseOwner);
        await client.query(
          `UPDATE sync_runs
              SET status = $4,
                  completed_at = $5::timestamptz,
                  lease_owner = NULL,
                  lease_until = NULL,
                  error_code = $6,
                  error_message = $7,
                  version = version + 1,
                  updated_at = $5::timestamptz
            WHERE tenant_id = $1
              AND market_account_id = $2
              AND id = $3`,
          [
            input.run.tenantId,
            input.run.marketAccountId,
            input.run.id,
            input.status,
            input.now,
            input.errorCode ?? null,
            input.errorMessage ?? null,
          ],
        );
        await client.query(
          `UPDATE market_accounts
              SET last_successful_sync_at = CASE
                    WHEN $4 = 'SUCCEEDED' THEN $3::timestamptz
                    ELSE last_successful_sync_at
                  END,
                  last_error_code = CASE
                    WHEN $4 = 'SUCCEEDED' THEN NULL
                    ELSE $5
                  END,
                  last_error_message = CASE
                    WHEN $4 = 'SUCCEEDED' THEN NULL
                    ELSE $6
                  END,
                  version = version + 1,
                  updated_at = $3::timestamptz
            WHERE tenant_id = $1
              AND id = $2
              AND deleted_at IS NULL`,
          [
            input.run.tenantId,
            input.run.marketAccountId,
            input.now,
            input.status,
            input.errorCode ?? "NAVER_SYNC_PARTIAL",
            input.errorMessage ?? "The marketplace sync completed with omissions.",
          ],
        );
      },
      {},
      this.pool,
    );
  }

  async failRun(input: FailRunInput): Promise<void> {
    await withTenantTransaction(
      input.run.tenantId,
      async (client) => {
        await lockMarketAccountLifecycle(client, input.run.marketAccountId);
        await assertLease(client, input.run, input.leaseOwner);
        await client.query(
          `UPDATE sync_runs
              SET status = $4,
                  completed_at = CASE
                    WHEN $4 = 'FAILED' THEN $5::timestamptz
                    ELSE NULL
                  END,
                  next_attempt_at = $6::timestamptz,
                  lease_owner = NULL,
                  lease_until = NULL,
                  error_count = error_count + 1,
                  error_code = $7,
                  error_message = $8,
                  version = version + 1,
                  updated_at = $5::timestamptz
            WHERE tenant_id = $1
              AND market_account_id = $2
              AND id = $3`,
          [
            input.run.tenantId,
            input.run.marketAccountId,
            input.run.id,
            input.status,
            input.now,
            input.nextAttemptAt,
            input.failure.code,
            input.failure.message,
          ],
        );
        await client.query(
          `UPDATE market_accounts
              SET auth_status = CASE
                    WHEN $4 IS NOT NULL
                     AND is_active
                     AND auth_status <> 'DISCONNECTED'
                    THEN $4
                    ELSE auth_status
                  END,
                  last_error_code = $5,
                  last_error_message = $6,
                  version = version + 1,
                  updated_at = $3::timestamptz
            WHERE tenant_id = $1
              AND id = $2
              AND deleted_at IS NULL`,
          [
            input.run.tenantId,
            input.run.marketAccountId,
            input.now,
            input.failure.accountStatus ?? null,
            input.failure.code,
            input.failure.message,
          ],
        );
      },
      {},
      this.pool,
    );
  }

  async completeAccountVerification(
    input: CompleteAccountVerificationInput,
  ): Promise<void> {
    await withTenantTransaction(
      input.run.tenantId,
      async (client) => {
        await lockMarketAccountLifecycle(client, input.run.marketAccountId);
        await assertLease(client, input.run, input.leaseOwner);
        const accountUpdate = await client.query(
          `UPDATE market_accounts ma
              SET auth_status = 'CONNECTED',
                  capabilities =
                    ($4::jsonb || ma.capabilities)
                    || jsonb_build_object(
                      'adapterManifest',
                      $4::jsonb -> 'adapterManifest'
                    ),
                  last_auth_verified_at = $3::timestamptz,
                  last_error_code = NULL,
                  last_error_message = NULL,
                  version = version + 1,
                  updated_at = $3::timestamptz
            WHERE tenant_id = $1
              AND id = $2
              AND market_code = 'NAVER'
              AND is_active
              AND auth_status <> 'DISCONNECTED'
              AND deleted_at IS NULL`,
          [
            input.run.tenantId,
            input.run.marketAccountId,
            input.now,
            JSON.stringify(input.capabilities),
          ],
        );
        if (accountUpdate.rowCount !== 1) {
          throw new NaverSyncStoreError(
            "SYNC_CONTEXT_NOT_FOUND",
            "The marketplace account is no longer eligible for verification.",
          );
        }
        await client.query(
          `UPDATE sync_runs
              SET status = $4,
                  completed_at = $5::timestamptz,
                  records_seen = records_seen + 1,
                  lease_owner = NULL,
                  lease_until = NULL,
                  error_code = $6,
                  error_message = $7,
                  version = version + 1,
                  updated_at = $5::timestamptz
            WHERE tenant_id = $1
              AND market_account_id = $2
              AND id = $3`,
          [
            input.run.tenantId,
            input.run.marketAccountId,
            input.run.id,
            input.status,
            input.now,
            input.errorCode ?? null,
            input.errorMessage ?? null,
          ],
        );
      },
      {},
      this.pool,
    );
  }
}
