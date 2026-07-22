import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { TransactionClient } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http/api-error";

interface OrderItemInvoiceRow extends QueryResultRow {
    id: string;
    market_account_id: string;
    internal_work_status: string;
    market_invoice_submitted_at: Date | null;
    version: string;
}

const versionSchema = z.string()
    .regex(/^[1-9]\d*$/)
    .max(19)
    .refine((value) => BigInt(value) <= BigInt("9223372036854775807"));

export const domesticInvoiceBodySchema = z.object({
    expectedVersion: versionSchema,
    carrierCode: z.string()
        .trim()
        .min(1)
        .max(50)
        .regex(/^[^\u0000-\u001f\u007f]+$/, "Control characters are not allowed."),
    trackingNumber: z.string()
        .trim()
        .min(1)
        .max(100)
        .regex(/^[^\u0000-\u001f\u007f]+$/, "Control characters are not allowed."),
    receivedAt: z.iso.datetime({ offset: true }),
}).strict();

export interface SaveDomesticInvoiceInput {
    tenantId: string;
    orderItemId: string;
    membershipId: string;
    expectedVersion: string;
    carrierCode: string;
    trackingNumber: string;
    receivedAt: string;
    correlationId: string;
}

export interface SavedDomesticInvoice {
    orderItemId: string;
    carrierCode: string;
    trackingNumber: string;
    receivedAt: string;
    version: string;
}

export async function saveDomesticInvoice(
    client: TransactionClient,
    input: SaveDomesticInvoiceInput,
): Promise<SavedDomesticInvoice> {
    const currentResult = await client.query<OrderItemInvoiceRow>(
        `SELECT id, market_account_id, internal_work_status,
                market_invoice_submitted_at, version::text AS version
           FROM order_items
          WHERE tenant_id = $1
            AND id = $2
            AND deleted_at IS NULL
          FOR UPDATE`,
        [input.tenantId, input.orderItemId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new ApiError(404, "ORDER_ITEM_NOT_FOUND", "주문상품을 찾을 수 없습니다.");
    if (current.version !== input.expectedVersion) {
        throw new ApiError(409, "ORDER_ITEM_VERSION_CONFLICT", "주문상품이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }
    if (current.market_invoice_submitted_at !== null) {
        throw new ApiError(409, "INVOICE_ALREADY_SUBMITTED", "이미 마켓에 제출한 송장은 현재 기능에서 수정할 수 없습니다.");
    }
    if (!["PREPARING", "READY_TO_SHIP"].includes(current.internal_work_status)) {
        throw new ApiError(409, "INVOICE_NOT_ALLOWED", "현재 주문 단계에서는 국내송장을 저장할 수 없습니다.");
    }

    const updated = await client.query<{ version: string } & QueryResultRow>(
        `UPDATE order_items
            SET domestic_carrier_code = $3,
                domestic_tracking_number = $4,
                attributes = attributes || jsonb_build_object(
                    'domesticInvoiceReceivedAt', $5::timestamptz,
                    'domesticInvoiceSource', 'OPERATOR'
                )
          WHERE tenant_id = $1
            AND id = $2
            AND version = $6::bigint
            AND deleted_at IS NULL
         RETURNING version::text AS version`,
        [
            input.tenantId,
            input.orderItemId,
            input.carrierCode,
            input.trackingNumber,
            input.receivedAt,
            input.expectedVersion,
        ],
    );
    const nextVersion = updated.rows[0]?.version;
    if (!nextVersion) {
        throw new ApiError(409, "ORDER_ITEM_VERSION_CONFLICT", "주문상품이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }

    const visible = input.trackingNumber.slice(-4);
    const maskedTracking = `${"*".repeat(Math.max(4, input.trackingNumber.length - visible.length))}${visible}`;
    await client.query(
        `INSERT INTO audit_logs (
             tenant_id, market_account_id, actor_type, actor_membership_id,
             action, entity_type, entity_id, correlation_id, after_snapshot
         ) VALUES ($1, $2, 'USER', $3, 'DOMESTIC_INVOICE_SAVED',
                   'ORDER_ITEM', $4, $5::uuid, $6::jsonb)`,
        [
            input.tenantId,
            current.market_account_id,
            input.membershipId,
            input.orderItemId,
            input.correlationId,
            JSON.stringify({
                carrierCode: input.carrierCode,
                trackingNumberMasked: maskedTracking,
                receivedAt: input.receivedAt,
            }),
        ],
    );

    return {
        orderItemId: input.orderItemId,
        carrierCode: input.carrierCode,
        trackingNumber: input.trackingNumber,
        receivedAt: input.receivedAt,
        version: nextVersion,
    };
}
