import type { QueryResultRow } from "pg";
import type { TransactionClient } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http/api-error";

export const UAT_APPROVABLE_NAVER_ACTIONS = [
    "ORDER_CONFIRM",
    "INVOICE_SUBMIT",
    "DIRECT_DELIVERY",
    "SELLER_CANCEL",
] as const;

export type UatApprovableNaverAction = (typeof UAT_APPROVABLE_NAVER_ACTIONS)[number];

interface CapabilityAccountRow extends QueryResultRow {
    market_code: string;
    auth_status: string;
    is_active: boolean;
    version: string;
}

export interface ApproveCapabilityUatInput {
    tenantId: string;
    marketAccountId: string;
    membershipId: string;
    expectedVersion: string;
    action: UatApprovableNaverAction;
    evidenceRef: string;
    note?: string;
    correlationId: string;
    approvedAt: string;
}

export async function approveCapabilityUat(
    client: TransactionClient,
    input: ApproveCapabilityUatInput,
): Promise<{ action: UatApprovableNaverAction; mode: "API"; uatStatus: "PASSED"; version: string }> {
    await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [input.marketAccountId],
    );
    const accountResult = await client.query<CapabilityAccountRow>(
        `SELECT market_code, auth_status, is_active, version::text AS version
           FROM market_accounts
          WHERE tenant_id = $1
            AND id = $2
            AND deleted_at IS NULL
          FOR UPDATE`,
        [input.tenantId, input.marketAccountId],
    );
    const account = accountResult.rows[0];

    if (!account) throw new ApiError(404, "MARKET_ACCOUNT_NOT_FOUND", "마켓 계정을 찾을 수 없습니다.");
    if (account.market_code !== "NAVER") {
        throw new ApiError(422, "CAPABILITY_UAT_NOT_SUPPORTED", "현재 계정별 쓰기 UAT 승격은 스마트스토어만 지원합니다.");
    }
    if (!account.is_active || account.auth_status !== "CONNECTED") {
        throw new ApiError(409, "MARKET_ACCOUNT_NOT_CONNECTED", "연결 완료된 활성 계정만 UAT를 승인할 수 있습니다.");
    }
    if (account.version !== input.expectedVersion) {
        throw new ApiError(409, "MARKET_ACCOUNT_VERSION_CONFLICT", "계정 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }

    const capability = {
        action: input.action,
        mode: "API" as const,
        officialDocumentReviewedAt: input.approvedAt,
        uatStatus: "PASSED" as const,
        note: input.note ?? null,
        evidenceRef: input.evidenceRef,
    };
    const updated = await client.query<{ version: string } & QueryResultRow>(
        `UPDATE market_accounts
            SET capabilities = jsonb_set(capabilities, ARRAY[$3::text], $4::jsonb, true)
          WHERE tenant_id = $1
            AND id = $2
            AND version = $5::bigint
            AND deleted_at IS NULL
         RETURNING version::text AS version`,
        [
            input.tenantId,
            input.marketAccountId,
            input.action,
            JSON.stringify(capability),
            input.expectedVersion,
        ],
    );
    const nextVersion = updated.rows[0]?.version;
    if (!nextVersion) {
        throw new ApiError(409, "MARKET_ACCOUNT_VERSION_CONFLICT", "계정 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }

    await client.query(
        `INSERT INTO audit_logs (
             tenant_id, market_account_id, actor_type, actor_membership_id,
             action, entity_type, entity_id, correlation_id, after_snapshot
         ) VALUES ($1, $2, 'USER', $3, 'MARKET_CAPABILITY_UAT_APPROVED',
                   'MARKET_ACCOUNT', $2::text, $4::uuid, $5::jsonb)`,
        [
            input.tenantId,
            input.marketAccountId,
            input.membershipId,
            input.correlationId,
            JSON.stringify({
                action: input.action,
                mode: "API",
                uatStatus: "PASSED",
                evidenceRef: input.evidenceRef,
                approvedAt: input.approvedAt,
            }),
        ],
    );

    return { action: input.action, mode: "API", uatStatus: "PASSED", version: nextVersion };
}
