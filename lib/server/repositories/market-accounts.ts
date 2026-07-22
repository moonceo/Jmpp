import { createHash, randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { TransactionClient } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http/api-error";
import { requireEnabledMarketAdapter } from "@/lib/server/market-accounts/adapter-registry";
import type { NaverCredentialsInput } from "@/lib/server/market-accounts/credentials";
import { encryptCredential } from "@/lib/server/security";
import type { OrderMarketCode } from "@/lib/server/repositories/orders";

export type MarketAccountAuthStatus =
    | "PENDING"
    | "CONNECTED"
    | "EXPIRED"
    | "REAUTH_REQUIRED"
    | "ERROR"
    | "DISCONNECTED";

interface MarketAccountRow extends QueryResultRow {
    id: string;
    market_code: OrderMarketCode;
    store_name: string;
    seller_id: string;
    external_account_id: string | null;
    auth_status: MarketAccountAuthStatus;
    is_active: boolean;
    capabilities: Record<string, unknown>;
    settings: Record<string, unknown>;
    credential_expires_at: Date | null;
    last_auth_verified_at: Date | null;
    last_successful_sync_at: Date | null;
    last_error_code: string | null;
    last_error_message: string | null;
    version: string;
    created_at: Date;
    updated_at: Date;
}

export interface MarketAccount {
    id: string;
    marketCode: OrderMarketCode;
    storeName: string;
    sellerId: string;
    externalAccountId: string | null;
    authStatus: MarketAccountAuthStatus;
    isActive: boolean;
    capabilities: Record<string, unknown>;
    settings: Record<string, unknown>;
    credentialExpiresAt: string | null;
    lastAuthVerifiedAt: string | null;
    lastSuccessfulSyncAt: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    version: string;
    createdAt: string;
    updatedAt: string;
}

export interface CreateMarketAccountInput {
    tenantId: string;
    membershipId: string;
    marketCode: OrderMarketCode;
    storeName: string;
    sellerId: string;
    externalAccountId?: string;
    credentials: Record<string, string>;
    settings?: Record<string, unknown>;
    correlationId: string;
}

export interface UpdateMarketAccountInput {
    tenantId: string;
    marketAccountId: string;
    membershipId: string;
    expectedVersion: string;
    storeName?: string;
    isActive?: boolean;
    settings?: Record<string, unknown>;
    correlationId: string;
}

export interface RotateMarketAccountCredentialsInput {
    tenantId: string;
    marketAccountId: string;
    membershipId: string;
    expectedVersion: string;
    credentials: NaverCredentialsInput;
    correlationId: string;
    rotatedAt?: Date;
}

interface CredentialSecretRow extends QueryResultRow {
    id: string;
    fingerprint_sha256: string | null;
}

function toMarketAccount(row: MarketAccountRow): MarketAccount {
    const publicCapabilities = Object.fromEntries(
        Object.entries(row.capabilities).flatMap(([action, value]) => {
            if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
            const candidate = value as Record<string, unknown>;
            if (typeof candidate.mode !== "string") return [];

            return [[action, {
                mode: candidate.mode,
                uatStatus: typeof candidate.uatStatus === "string" ? candidate.uatStatus : "NOT_RUN",
            }]];
        }),
    );

    return {
        id: row.id,
        marketCode: row.market_code,
        storeName: row.store_name,
        sellerId: row.seller_id,
        externalAccountId: row.external_account_id,
        authStatus: row.auth_status,
        isActive: row.is_active,
        capabilities: publicCapabilities,
        settings: row.settings,
        credentialExpiresAt: row.credential_expires_at?.toISOString() ?? null,
        lastAuthVerifiedAt: row.last_auth_verified_at?.toISOString() ?? null,
        lastSuccessfulSyncAt: row.last_successful_sync_at?.toISOString() ?? null,
        lastErrorCode: row.last_error_code,
        lastErrorMessage: row.last_error_message,
        version: row.version,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}

const accountColumns = `
    id, market_code, store_name, seller_id, external_account_id,
    auth_status, is_active, capabilities, settings, credential_expires_at,
    last_auth_verified_at, last_successful_sync_at, last_error_code,
    last_error_message, version::text AS version, created_at, updated_at`;

async function lockMarketAccountLifecycle(
    client: TransactionClient,
    marketAccountId: string,
): Promise<void> {
    await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [marketAccountId],
    );
}

export async function listMarketAccounts(
    client: TransactionClient,
    tenantId: string,
): Promise<MarketAccount[]> {
    const result = await client.query<MarketAccountRow>(
        `SELECT ${accountColumns}
           FROM market_accounts
          WHERE tenant_id = $1
            AND deleted_at IS NULL
          ORDER BY market_code, store_name, id`,
        [tenantId],
    );

    return result.rows.map(toMarketAccount);
}

export async function createMarketAccount(
    client: TransactionClient,
    input: CreateMarketAccountInput,
): Promise<MarketAccount> {
    const accountId = randomUUID();
    const secretType = "MARKET_API_CREDENTIALS";
    const plaintext = JSON.stringify(input.credentials);
    const encryptedPayload = encryptCredential(plaintext, {
        tenantId: input.tenantId,
        marketAccountId: accountId,
        secretType,
    });
    const fingerprint = createHash("sha256").update(plaintext, "utf8").digest("hex");
    const result = await client.query<MarketAccountRow>(
        `INSERT INTO market_accounts (
             id, tenant_id, market_code, store_name, seller_id,
             external_account_id, auth_status, is_active, capabilities, settings
         ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', true, '{}'::jsonb, $7::jsonb)
         RETURNING ${accountColumns}`,
        [
            accountId,
            input.tenantId,
            input.marketCode,
            input.storeName,
            input.sellerId,
            input.externalAccountId ?? null,
            JSON.stringify(input.settings ?? {}),
        ],
    );

    await client.query(
        `INSERT INTO integration_secrets (
             tenant_id, market_account_id, secret_type, encrypted_payload,
             encryption_key_version, fingerprint_sha256
         ) VALUES ($1, $2, $3, $4, 1, $5)`,
        [input.tenantId, accountId, secretType, encryptedPayload, fingerprint],
    );

    await client.query(
        `INSERT INTO audit_logs (
             tenant_id, market_account_id, actor_type, actor_membership_id,
             action, entity_type, entity_id, correlation_id, after_snapshot
         ) VALUES ($1, $2, 'USER', $3, 'MARKET_ACCOUNT_CREATED',
                   'MARKET_ACCOUNT', $2::text, $4::uuid, $5::jsonb)`,
        [
            input.tenantId,
            accountId,
            input.membershipId,
            input.correlationId,
            JSON.stringify({
                marketCode: input.marketCode,
                storeName: input.storeName,
                sellerId: input.sellerId,
                authStatus: "PENDING",
            }),
        ],
    );

    return toMarketAccount(result.rows[0]);
}

export async function updateMarketAccount(
    client: TransactionClient,
    input: UpdateMarketAccountInput,
): Promise<MarketAccount> {
    await lockMarketAccountLifecycle(client, input.marketAccountId);
    const currentResult = await client.query<MarketAccountRow>(
        `SELECT ${accountColumns}
           FROM market_accounts
          WHERE tenant_id = $1
            AND id = $2
            AND deleted_at IS NULL
          FOR UPDATE`,
        [input.tenantId, input.marketAccountId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new Error("MARKET_ACCOUNT_NOT_FOUND");
    if (current.version !== input.expectedVersion) throw new Error("MARKET_ACCOUNT_VERSION_CONFLICT");

    const result = await client.query<MarketAccountRow>(
        `UPDATE market_accounts
            SET store_name = COALESCE($3::text, store_name),
                is_active = COALESCE($4::boolean, is_active),
                settings = COALESCE($5::jsonb, settings)
          WHERE tenant_id = $1
            AND id = $2
            AND version = $6::bigint
            AND deleted_at IS NULL
         RETURNING ${accountColumns}`,
        [
            input.tenantId,
            input.marketAccountId,
            input.storeName ?? null,
            input.isActive ?? null,
            input.settings === undefined ? null : JSON.stringify(input.settings),
            input.expectedVersion,
        ],
    );
    const updated = result.rows[0];
    if (!updated) throw new Error("MARKET_ACCOUNT_VERSION_CONFLICT");

    await client.query(
        `INSERT INTO audit_logs (
             tenant_id, market_account_id, actor_type, actor_membership_id,
             action, entity_type, entity_id, correlation_id,
             before_snapshot, after_snapshot
         ) VALUES ($1, $2, 'USER', $3, 'MARKET_ACCOUNT_UPDATED',
                   'MARKET_ACCOUNT', $2::text, $4::uuid, $5::jsonb, $6::jsonb)`,
        [
            input.tenantId,
            input.marketAccountId,
            input.membershipId,
            input.correlationId,
            JSON.stringify({
                storeName: current.store_name,
                isActive: current.is_active,
                settings: current.settings,
            }),
            JSON.stringify({
                storeName: updated.store_name,
                isActive: updated.is_active,
                settings: updated.settings,
            }),
        ],
    );

    return toMarketAccount(updated);
}

export async function rotateMarketAccountCredentials(
    client: TransactionClient,
    input: RotateMarketAccountCredentialsInput,
): Promise<MarketAccount> {
    await lockMarketAccountLifecycle(client, input.marketAccountId);
    const currentResult = await client.query<MarketAccountRow & { has_active_work: boolean }>(
        `SELECT ${accountColumns},
                (
                    EXISTS (
                        SELECT 1 FROM sync_runs sr
                         WHERE sr.tenant_id = ma.tenant_id
                           AND sr.market_account_id = ma.id
                           AND sr.status IN ('PENDING', 'RUNNING', 'RETRY')
                           AND sr.deleted_at IS NULL
                    ) OR EXISTS (
                        SELECT 1 FROM outbound_commands oc
                         WHERE oc.tenant_id = ma.tenant_id
                           AND oc.market_account_id = ma.id
                           AND oc.status IN ('PENDING', 'LEASED', 'RETRY', 'UNKNOWN')
                           AND oc.deleted_at IS NULL
                    )
                ) AS has_active_work
           FROM market_accounts ma
          WHERE ma.tenant_id = $1
            AND ma.id = $2
            AND ma.deleted_at IS NULL
          FOR UPDATE`,
        [input.tenantId, input.marketAccountId],
    );
    const current = currentResult.rows[0];
    if (!current) {
        throw new ApiError(404, "MARKET_ACCOUNT_NOT_FOUND", "마켓 계정을 찾을 수 없습니다.");
    }
    if (current.version !== input.expectedVersion) {
        throw new ApiError(409, "MARKET_ACCOUNT_VERSION_CONFLICT", "계정 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }
    if (!current.is_active) {
        throw new ApiError(409, "MARKET_ACCOUNT_INACTIVE", "활성 계정만 자격증명을 교체할 수 있습니다.");
    }
    if (current.has_active_work) {
        throw new ApiError(409, "MARKET_ACCOUNT_HAS_ACTIVE_WORK", "진행 중인 수집 또는 마켓 명령을 먼저 완료해 주세요.");
    }
    requireEnabledMarketAdapter(current.market_code);

    const secretType = "MARKET_API_CREDENTIALS";
    const existingSecretResult = await client.query<CredentialSecretRow>(
        `SELECT id, fingerprint_sha256
           FROM integration_secrets
          WHERE tenant_id = $1
            AND market_account_id = $2
            AND secret_type = $3
            AND revoked_at IS NULL
            AND deleted_at IS NULL
          ORDER BY created_at DESC, id DESC
          LIMIT 1
          FOR UPDATE`,
        [input.tenantId, input.marketAccountId, secretType],
    );
    const existingSecret = existingSecretResult.rows[0];
    const plaintext = JSON.stringify(input.credentials);
    const fingerprint = createHash("sha256").update(plaintext, "utf8").digest("hex");
    const encryptedPayload = encryptCredential(plaintext, {
        tenantId: input.tenantId,
        marketAccountId: input.marketAccountId,
        secretType,
    });
    const rotatedAt = input.rotatedAt ?? new Date();
    const secretId = randomUUID();

    if (existingSecret) {
        await client.query(
            `UPDATE integration_secrets
                SET revoked_at = $3::timestamptz
              WHERE tenant_id = $1
                AND id = $2
                AND revoked_at IS NULL
                AND deleted_at IS NULL`,
            [input.tenantId, existingSecret.id, rotatedAt],
        );
    }

    await client.query(
        `INSERT INTO integration_secrets (
             id, tenant_id, market_account_id, secret_type, encrypted_payload,
             encryption_key_version, fingerprint_sha256, rotated_from_id,
             created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8::timestamptz, $8::timestamptz)`,
        [
            secretId,
            input.tenantId,
            input.marketAccountId,
            secretType,
            encryptedPayload,
            fingerprint,
            existingSecret?.id ?? null,
            rotatedAt,
        ],
    );

    const updatedResult = await client.query<MarketAccountRow>(
        `UPDATE market_accounts
            SET auth_status = 'PENDING',
                capabilities = '{}'::jsonb,
                credential_expires_at = NULL,
                last_auth_verified_at = NULL,
                last_error_code = NULL,
                last_error_message = NULL
          WHERE tenant_id = $1
            AND id = $2
            AND version = $3::bigint
            AND deleted_at IS NULL
         RETURNING ${accountColumns}`,
        [input.tenantId, input.marketAccountId, input.expectedVersion],
    );
    const updated = updatedResult.rows[0];
    if (!updated) {
        throw new ApiError(409, "MARKET_ACCOUNT_VERSION_CONFLICT", "계정 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }

    await client.query(
        `INSERT INTO audit_logs (
             tenant_id, market_account_id, actor_type, actor_membership_id,
             action, entity_type, entity_id, correlation_id,
             before_snapshot, after_snapshot, occurred_at
         ) VALUES ($1, $2, 'USER', $3, 'MARKET_CREDENTIALS_ROTATED',
                   'MARKET_ACCOUNT', $2::text, $4::uuid, $5::jsonb, $6::jsonb,
                   $7::timestamptz)`,
        [
            input.tenantId,
            input.marketAccountId,
            input.membershipId,
            input.correlationId,
            existingSecret?.fingerprint_sha256
                ? JSON.stringify({ credentialFingerprint: existingSecret.fingerprint_sha256 })
                : null,
            JSON.stringify({ credentialFingerprint: fingerprint }),
            rotatedAt,
        ],
    );

    return toMarketAccount(updated);
}

export async function deleteMarketAccount(
    client: TransactionClient,
    input: Omit<UpdateMarketAccountInput, "storeName" | "isActive" | "settings">,
): Promise<void> {
    await lockMarketAccountLifecycle(client, input.marketAccountId);
    const currentResult = await client.query<MarketAccountRow & { has_active_work: boolean }>(
        `SELECT ${accountColumns},
                (
                    EXISTS (
                        SELECT 1 FROM sync_runs sr
                         WHERE sr.tenant_id = ma.tenant_id
                           AND sr.market_account_id = ma.id
                           AND sr.status IN ('PENDING', 'RUNNING', 'RETRY')
                           AND sr.deleted_at IS NULL
                    ) OR EXISTS (
                        SELECT 1 FROM outbound_commands oc
                         WHERE oc.tenant_id = ma.tenant_id
                           AND oc.market_account_id = ma.id
                           AND oc.status IN ('PENDING', 'LEASED', 'RETRY', 'UNKNOWN')
                           AND oc.deleted_at IS NULL
                    )
                ) AS has_active_work
           FROM market_accounts ma
          WHERE ma.tenant_id = $1
            AND ma.id = $2
            AND ma.deleted_at IS NULL
          FOR UPDATE`,
        [input.tenantId, input.marketAccountId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new Error("MARKET_ACCOUNT_NOT_FOUND");
    if (current.version !== input.expectedVersion) throw new Error("MARKET_ACCOUNT_VERSION_CONFLICT");
    if (current.has_active_work) throw new Error("MARKET_ACCOUNT_HAS_ACTIVE_WORK");

    const deleted = await client.query(
        `UPDATE market_accounts
            SET is_active = false,
                auth_status = 'DISCONNECTED',
                deleted_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $1
            AND id = $2
            AND version = $3::bigint
            AND deleted_at IS NULL`,
        [input.tenantId, input.marketAccountId, input.expectedVersion],
    );
    if (deleted.rowCount !== 1) throw new Error("MARKET_ACCOUNT_VERSION_CONFLICT");

    await client.query(
        `UPDATE integration_secrets
            SET revoked_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $1
            AND market_account_id = $2
            AND revoked_at IS NULL
            AND deleted_at IS NULL`,
        [input.tenantId, input.marketAccountId],
    );

    await client.query(
        `INSERT INTO audit_logs (
             tenant_id, market_account_id, actor_type, actor_membership_id,
             action, entity_type, entity_id, correlation_id, before_snapshot
         ) VALUES ($1, $2, 'USER', $3, 'MARKET_ACCOUNT_DELETED',
                   'MARKET_ACCOUNT', $2::text, $4::uuid, $5::jsonb)`,
        [
            input.tenantId,
            input.marketAccountId,
            input.membershipId,
            input.correlationId,
            JSON.stringify({
                marketCode: current.market_code,
                storeName: current.store_name,
                sellerId: current.seller_id,
                authStatus: current.auth_status,
            }),
        ],
    );
}
