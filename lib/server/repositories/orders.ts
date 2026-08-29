import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { TransactionClient } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http/api-error";

const cursorSchema = z.object({
    v: z.literal(1),
    orderedAt: z.iso.datetime(),
    id: z.uuid(),
    filterHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export const ORDER_MARKET_CODES = [
    "NAVER",
    "COUPANG",
    "ELEVEN_STREET",
    "GMARKET",
    "AUCTION",
] as const;

export type OrderMarketCode = (typeof ORDER_MARKET_CODES)[number];

export const NORMALIZED_ORDER_STATUSES = [
    "NEW",
    "PREPARING",
    "READY_TO_SHIP",
    "SHIPPING",
    "DELIVERED",
    "CANCELED",
    "ON_HOLD",
] as const;

export type NormalizedOrderStatus = (typeof NORMALIZED_ORDER_STATUSES)[number];

export interface OrderItemListItem {
    id: string;
    externalOrderItemId: string | null;
    marketProductId: string | null;
    productName: string;
    optionName: string | null;
    productUrl: string | null;
    thumbnailUrl: string | null;
    quantity: number;
    unitPrice: string;
    itemTotal: string;
    paymentShippingFee: string;
    internalWorkStatus: NormalizedOrderStatus;
    sourcingStatus: string;
    sourcingVerificationProvenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED" | null;
    marketFulfillmentStatus: string | null;
    marketDeliveryMethod: string | null;
    shippingProcessStarted: boolean;
    domesticCarrierCode: string | null;
    domesticTrackingNumber: string | null;
    version: string;
}

interface OrderHeaderRow extends QueryResultRow {
    id: string;
    external_order_id: string;
    external_order_number: string | null;
    normalized_status: NormalizedOrderStatus;
    market_status_raw: string;
    currency_code: string;
    gross_amount: string;
    paid_amount: string;
    buyer_name_masked: string | null;
    ordered_at: Date;
    paid_at: Date | null;
    version: string;
    market_account_id: string;
    market_code: OrderMarketCode;
    store_name: string;
    recipient_name_masked: string | null;
}

type OrderDetailRow = OrderHeaderRow;

interface OrderItemsRow extends QueryResultRow {
    sales_order_id: string;
    items: OrderItemListItem[];
}

export interface OrderListQuery {
    limit: number;
    cursor?: string;
    marketCode?: OrderMarketCode;
    normalizedStatus?: NormalizedOrderStatus;
    search?: string;
}

export interface OrderListItem {
    id: string;
    marketAccountId: string;
    marketCode: OrderMarketCode;
    storeName: string;
    externalOrderId: string;
    externalOrderNumber: string | null;
    normalizedStatus: NormalizedOrderStatus;
    marketStatusRaw: string;
    currencyCode: string;
    grossAmount: string;
    paidAmount: string;
    buyerNameMasked: string | null;
    recipientNameMasked: string | null;
    orderedAt: string;
    paidAt: string | null;
    version: string;
    items: OrderItemListItem[];
}

export interface OrderDetail extends OrderListItem {
    recipientNameMasked: string | null;
}

export interface CursorPage<T> {
    items: T[];
    nextCursor: string | null;
}

function filterHash(query: OrderListQuery): string {
    return createHash("sha256").update(JSON.stringify({
        marketCode: query.marketCode ?? null,
        normalizedStatus: query.normalizedStatus ?? null,
        search: query.search?.trim() || null,
    }), "utf8").digest("hex");
}

function cursorSigningSecret(): string {
    const secret = process.env.CURSOR_SIGNING_SECRET?.trim();
    if (!secret || secret.length < 32) {
        throw new ApiError(503, "CURSOR_SIGNING_NOT_CONFIGURED", "목록 커서 서명 구성이 완료되지 않았습니다.");
    }

    return secret;
}

function cursorSignature(encodedPayload: string, secret: string): Buffer {
    return createHmac("sha256", secret).update(encodedPayload, "utf8").digest();
}

function decodeCursor(
    value: string | undefined,
    expectedFilterHash: string,
): z.infer<typeof cursorSchema> | null {
    if (!value) return null;
    const secret = cursorSigningSecret();

    try {
        const parts = value.split(".");
        if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("invalid cursor envelope");
        const suppliedSignature = Buffer.from(parts[1], "base64url");
        const expectedSignature = cursorSignature(parts[0], secret);
        if (
            suppliedSignature.length !== expectedSignature.length
            || !timingSafeEqual(suppliedSignature, expectedSignature)
        ) {
            throw new Error("invalid cursor signature");
        }

        const decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as unknown;
        const result = cursorSchema.safeParse(decoded);

        if (!result.success || result.data.filterHash !== expectedFilterHash) {
            throw new Error("invalid cursor shape or filters");
        }

        return result.data;
    } catch {
        throw new ApiError(400, "INVALID_CURSOR", "주문 목록 커서가 현재 검색조건과 맞지 않습니다.");
    }
}

function encodeCursor(row: OrderHeaderRow, currentFilterHash: string): string {
    const encodedPayload = Buffer.from(JSON.stringify({
        v: 1,
        orderedAt: row.ordered_at.toISOString(),
        id: row.id,
        filterHash: currentFilterHash,
    })).toString("base64url");
    const signature = cursorSignature(encodedPayload, cursorSigningSecret()).toString("base64url");

    return `${encodedPayload}.${signature}`;
}

function toOrderListItem(
    row: OrderHeaderRow,
    items: OrderItemListItem[],
): OrderListItem {
    return {
        id: row.id,
        marketAccountId: row.market_account_id,
        marketCode: row.market_code,
        storeName: row.store_name,
        externalOrderId: row.external_order_id,
        externalOrderNumber: row.external_order_number,
        normalizedStatus: row.normalized_status,
        marketStatusRaw: row.market_status_raw,
        currencyCode: row.currency_code,
        grossAmount: row.gross_amount,
        paidAmount: row.paid_amount,
        buyerNameMasked: row.buyer_name_masked,
        recipientNameMasked: row.recipient_name_masked,
        orderedAt: row.ordered_at.toISOString(),
        paidAt: row.paid_at?.toISOString() ?? null,
        version: row.version,
        items,
    };
}

const orderHeaderColumns = `
    so.id, so.external_order_id, so.external_order_number,
    so.normalized_status, so.market_status_raw, so.currency_code,
    so.gross_amount::text AS gross_amount,
    so.paid_amount::text AS paid_amount,
    so.buyer_name_masked, so.ordered_at, so.paid_at,
    so.version::text AS version,
    ma.id AS market_account_id, ma.market_code, ma.store_name,
    (
        SELECT recipient.recipient_name_masked
          FROM order_recipients recipient
         WHERE recipient.tenant_id = so.tenant_id
           AND recipient.sales_order_id = so.id
           AND recipient.is_current
           AND recipient.deleted_at IS NULL
         LIMIT 1
    ) AS recipient_name_masked`;

async function loadItemsByOrderId(
    client: TransactionClient,
    tenantId: string,
    orderIds: readonly string[],
): Promise<Map<string, OrderItemListItem[]>> {
    if (orderIds.length === 0) return new Map();

    const result = await client.query<OrderItemsRow>(
        `SELECT oi.sales_order_id,
                jsonb_agg(
                    jsonb_build_object(
                        'id', oi.id,
                        'externalOrderItemId', oi.external_order_item_id,
                        'marketProductId', oi.market_product_id,
                        'productName', oi.product_name,
                        'optionName', oi.option_name,
                        'productUrl', oi.product_url,
                        'thumbnailUrl', oi.thumbnail_url,
                        'quantity', oi.quantity,
                        'unitPrice', oi.unit_price::text,
                        'itemTotal', oi.item_total::text,
                        'paymentShippingFee', COALESCE(oi.attributes ->> 'paymentShippingFee', '0'),
                        'internalWorkStatus', oi.internal_work_status,
                        'sourcingStatus', oi.sourcing_status,
                        'sourcingVerificationProvenance', CASE
                            WHEN sourcing_mapping.id IS NULL THEN NULL
                            WHEN sourcing_mapping.product_verification_snapshot = 'SERVER_VERIFIED'
                             AND sourcing_mapping.option_verification_snapshot = 'SERVER_VERIFIED'
                                THEN 'SERVER_VERIFIED'
                            ELSE 'MANUAL_UNVERIFIED'
                        END,
                        'marketFulfillmentStatus', oi.market_fulfillment_status,
                        'marketDeliveryMethod', oi.market_delivery_method,
                        'marketCarrierCode', oi.attributes #>> '{marketShippingReference,carrierCode}',
                        'marketTrackingNumber', oi.attributes #>> '{marketShippingReference,trackingNumber}',
                        'marketShippingRegisteredAt', oi.attributes #>> '{marketShippingReference,registeredAt}',
                        'shippingProcessStarted', EXISTS (
                            SELECT 1
                              FROM outbound_commands shipping_command
                             WHERE shipping_command.tenant_id = oi.tenant_id
                               AND shipping_command.order_item_id = oi.id
                               AND shipping_command.deleted_at IS NULL
                               AND shipping_command.command_type IN ('SHIPPING_PROCESS', 'INVOICE_SUBMIT', 'DIRECT_DELIVERY')
                               AND shipping_command.status IN ('PENDING', 'LEASED', 'RETRY', 'UNKNOWN', 'SUCCEEDED')
                        ),
                        'domesticCarrierCode', oi.domestic_carrier_code,
                        'domesticTrackingNumber', oi.domestic_tracking_number,
                        'version', oi.version::text
                    ) ORDER BY oi.created_at, oi.id
                ) AS items
           FROM order_items oi
           LEFT JOIN order_item_sourcing_mappings sourcing_mapping
             ON sourcing_mapping.tenant_id = oi.tenant_id
            AND sourcing_mapping.order_item_id = oi.id
            AND sourcing_mapping.status = 'ACTIVE'
            AND sourcing_mapping.deleted_at IS NULL
          WHERE oi.tenant_id = $1
            AND oi.sales_order_id = ANY($2::uuid[])
            AND oi.deleted_at IS NULL
          GROUP BY oi.sales_order_id`,
        [tenantId, orderIds],
    );

    return new Map(result.rows.map((row) => [row.sales_order_id, row.items]));
}

export async function listOrders(
    client: TransactionClient,
    tenantId: string,
    query: OrderListQuery,
): Promise<CursorPage<OrderListItem>> {
    const currentFilterHash = filterHash(query);
    const cursor = decodeCursor(query.cursor, currentFilterHash);
    const search = query.search?.trim() || null;
    const result = await client.query<OrderHeaderRow>(
        `SELECT ${orderHeaderColumns}
           FROM sales_orders so
           JOIN market_accounts ma
             ON ma.tenant_id = so.tenant_id
            AND ma.id = so.market_account_id
          WHERE so.tenant_id = $1
            AND so.deleted_at IS NULL
            AND ($2::text IS NULL OR ma.market_code = $2)
            AND ($3::text IS NULL OR so.normalized_status = $3)
            AND (
                $4::text IS NULL
                OR so.external_order_id ILIKE '%' || $4 || '%'
                OR so.external_order_number ILIKE '%' || $4 || '%'
                OR EXISTS (
                    SELECT 1
                      FROM order_items search_item
                     WHERE search_item.tenant_id = so.tenant_id
                       AND search_item.sales_order_id = so.id
                       AND search_item.deleted_at IS NULL
                       AND (
                           search_item.product_name ILIKE '%' || $4 || '%'
                           OR search_item.external_order_item_id ILIKE '%' || $4 || '%'
                       )
                )
            )
            AND (
                $5::timestamptz IS NULL
                OR (so.ordered_at, so.id) < ($5::timestamptz, $6::uuid)
            )
          ORDER BY so.ordered_at DESC, so.id DESC
          LIMIT $7`,
        [
            tenantId,
            query.marketCode ?? null,
            query.normalizedStatus ?? null,
            search,
            cursor?.orderedAt ?? null,
            cursor?.id ?? null,
            query.limit + 1,
        ],
    );

    const hasNextPage = result.rows.length > query.limit;
    const rows = result.rows.slice(0, query.limit);
    const itemsByOrderId = await loadItemsByOrderId(client, tenantId, rows.map((row) => row.id));

    return {
        items: rows.map((row) => toOrderListItem(row, itemsByOrderId.get(row.id) ?? [])),
        nextCursor: hasNextPage && rows.length > 0
            ? encodeCursor(rows[rows.length - 1], currentFilterHash)
            : null,
    };
}

export async function getOrderDetail(
    client: TransactionClient,
    tenantId: string,
    orderId: string,
): Promise<OrderDetail | null> {
    const result = await client.query<OrderDetailRow>(
        `SELECT ${orderHeaderColumns}
           FROM sales_orders so
           JOIN market_accounts ma
             ON ma.tenant_id = so.tenant_id
            AND ma.id = so.market_account_id
          WHERE so.tenant_id = $1
            AND so.id = $2
            AND so.deleted_at IS NULL`,
        [tenantId, orderId],
    );
    const row = result.rows[0];
    if (!row) return null;

    const itemsByOrderId = await loadItemsByOrderId(client, tenantId, [orderId]);

    return {
        ...toOrderListItem(row, itemsByOrderId.get(orderId) ?? []),
        recipientNameMasked: row.recipient_name_masked,
    };
}
