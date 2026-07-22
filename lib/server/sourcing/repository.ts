import type { QueryResultRow } from "pg";
import type { TransactionClient } from "@/lib/server/db";
import type {
    ActiveSourcingMapping,
    MappingValidationContext,
    PurchaseDraftRecord,
    ReusableSourcingRule,
    SavedSourcingMapping,
    SaveMappingInput,
    SourcingOrderItemRow,
    StoredSourceOption,
    StoredSourceProduct,
} from "@/lib/server/sourcing/types";

interface OrderItemDbRow extends QueryResultRow {
    id: string;
    market_account_id: string;
    sales_order_id: string;
    quantity: number;
    market_product_id: string | null;
    market_option_id: string | null;
    sourcing_status: string;
    internal_work_status: string;
    version: string;
}

interface SourceProductRow extends QueryResultRow {
    id: string;
    source_version: string;
    last_checked_at: Date;
    verification_provenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
}

type SourceOptionRow = SourceProductRow;

interface MappingRow extends QueryResultRow {
    id: string;
    mapping_revision: number;
    order_item_version: string;
    market_account_id: string;
    mapping_rule_id: string | null;
    rule_revision_snapshot: number | null;
    source_product_id: string;
    source_option_id: string;
    source_product_version_snapshot: string;
    source_option_version_snapshot: string;
    product_verification_snapshot: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
    option_verification_snapshot: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
    external_sku_id_snapshot: string;
    option_attributes_snapshot: Record<string, string>;
    option_label_ko_snapshot: string | null;
    option_label_zh_snapshot: string | null;
    unit_price_cny_snapshot: string;
    stock_status_snapshot: string;
    stock_quantity_snapshot: number | null;
    minimum_quantity_snapshot: number;
    quantity_step_snapshot: number;
    china_shipping_status_snapshot: "CONFIRMED" | "ESTIMATED" | "UNKNOWN";
    china_shipping_cny_snapshot: string | null;
    quantity_multiplier: number;
    source_checked_at_snapshot: Date;
}

interface ValidationRow extends OrderItemDbRow, MappingRow {
    item_id: string;
    mapping_id: string;
    product_sale_status: string;
    product_restriction_status: "CLEAR" | "REVIEW_REQUIRED" | "PROHIBITED";
    product_customs_requirement: "NOT_REQUIRED" | "FORMAT_VALID" | "IDENTITY_VERIFIED";
    product_source_version: string;
    product_verification_provenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
    product_last_checked_at: Date;
    option_external_sku_id: string;
    option_unit_price_cny: string;
    option_stock_status: "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
    option_stock_quantity: number | null;
    option_minimum_quantity: number;
    option_quantity_step: number;
    option_china_shipping_status: "CONFIRMED" | "ESTIMATED" | "UNKNOWN";
    option_china_shipping_cny: string | null;
    option_source_version: string;
    option_verification_provenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
    option_last_checked_at: Date;
    recipient_id: string | null;
    recipient_ready: boolean | null;
    has_customs_code: boolean | null;
    customs_code_format_status: "NOT_CHECKED" | "MISSING" | "FORMAT_VALID" | "INVALID" | null;
    customs_identity_status: "NOT_CHECKED" | "MATCHED" | "MISMATCH" | "NOT_REQUIRED" | null;
    customs_consent_at: Date | null;
    customs_verified_at: Date | null;
}

interface DraftDbRow extends QueryResultRow {
    id: string;
    order_item_id: string;
    mapping_id: string;
    mapping_revision: number;
    status: PurchaseDraftRecord["status"];
    source_quantity: number;
    external_sku_id_snapshot: string;
    source_verification_provenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
    unit_price_cny: string;
    product_subtotal_cny: string;
    china_shipping_status: string;
    china_shipping_cny: string | null;
    exchange_rate_krw_per_cny: string;
    exchange_rate_source: string;
    exchange_rate_observed_at: Date;
    product_amount_krw: string;
    china_shipping_amount_krw: string | null;
    agency_fee_krw: string;
    international_shipping_status: string;
    international_shipping_amount_krw: string | null;
    customs_tax_status: string;
    customs_tax_amount_krw: string | null;
    other_fee_krw: string;
    discount_krw: string;
    discount_status: "CONFIRMED" | "ESTIMATED";
    known_cost_total_krw: string;
    blocking_reasons: string[];
    warnings: string[];
    quote_expires_at: Date;
    request_fingerprint: string;
}

interface MappingRuleRow extends QueryResultRow {
    id: string;
    rule_revision: number;
    market_product_id: string;
    market_option_id: string | null;
    source_product_id: string;
    source_option_id: string;
    external_sku_id_snapshot: string;
    quantity_multiplier: number;
    verification_provenance: "MANUAL_UNVERIFIED" | "SERVER_VERIFIED";
    approval_status: "DRAFT" | "APPROVED" | "SUPERSEDED" | "REVOKED";
    approved_at: Date | null;
}

export interface InsertDraftInput {
    tenantId: string;
    membershipId: string;
    correlationId: string;
    context: MappingValidationContext;
    status: "BLOCKED" | "READY_FOR_REVIEW";
    sourceQuantity: number;
    productSubtotalCny: string;
    exchangeRateKrwPerCny: string;
    exchangeRateSource: string;
    exchangeRateObservedAt: string;
    productAmountKrw: number;
    chinaShippingAmountKrw: number | null;
    agencyFeeKrw: number;
    internationalShippingStatus: string;
    internationalShippingAmountKrw: number | null;
    customsTaxStatus: string;
    customsTaxAmountKrw: number | null;
    otherFeeKrw: number;
    discountKrw: number;
    discountStatus: "CONFIRMED" | "ESTIMATED";
    knownCostTotalKrw: number;
    forwarderStatus: string;
    blockingReasons: string[];
    warnings: string[];
    requestRevision: string;
    idempotencyKey: string;
    requestFingerprint: string;
    quoteExpiresAt: string;
    userNote?: string;
}

function toItem(row: OrderItemDbRow): SourcingOrderItemRow {
    return {
        id: row.id,
        marketAccountId: row.market_account_id,
        salesOrderId: row.sales_order_id,
        quantity: row.quantity,
        marketProductId: row.market_product_id,
        marketOptionId: row.market_option_id,
        sourcingStatus: row.sourcing_status,
        internalWorkStatus: row.internal_work_status,
        version: row.version,
    };
}

function toMapping(row: MappingRow): ActiveSourcingMapping {
    return {
        id: row.id,
        mappingRevision: row.mapping_revision,
        orderItemVersion: row.order_item_version,
        marketAccountId: row.market_account_id,
        mappingRuleId: row.mapping_rule_id,
        ruleRevisionSnapshot: row.rule_revision_snapshot,
        sourceProductId: row.source_product_id,
        sourceOptionId: row.source_option_id,
        sourceProductVersionSnapshot: row.source_product_version_snapshot,
        sourceOptionVersionSnapshot: row.source_option_version_snapshot,
        productVerificationSnapshot: row.product_verification_snapshot,
        optionVerificationSnapshot: row.option_verification_snapshot,
        externalSkuIdSnapshot: row.external_sku_id_snapshot,
        optionAttributesSnapshot: row.option_attributes_snapshot,
        optionLabelKoSnapshot: row.option_label_ko_snapshot,
        optionLabelZhSnapshot: row.option_label_zh_snapshot,
        unitPriceCnySnapshot: row.unit_price_cny_snapshot,
        stockStatusSnapshot: row.stock_status_snapshot,
        stockQuantitySnapshot: row.stock_quantity_snapshot,
        minimumQuantitySnapshot: row.minimum_quantity_snapshot,
        quantityStepSnapshot: row.quantity_step_snapshot,
        chinaShippingStatusSnapshot: row.china_shipping_status_snapshot,
        chinaShippingCnySnapshot: row.china_shipping_cny_snapshot,
        quantityMultiplier: row.quantity_multiplier,
        sourceCheckedAtSnapshot: row.source_checked_at_snapshot.toISOString(),
    };
}

export async function lockSourcingOrderItem(
    client: TransactionClient,
    tenantId: string,
    orderItemId: string,
): Promise<SourcingOrderItemRow | null> {
    const result = await client.query<OrderItemDbRow>(
        `SELECT id, market_account_id, sales_order_id, quantity,
                market_product_id, market_option_id, sourcing_status,
                internal_work_status, version::text AS version
           FROM order_items
          WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
          FOR UPDATE`,
        [tenantId, orderItemId],
    );
    return result.rows[0] ? toItem(result.rows[0]) : null;
}

export async function upsertSourceProduct(
    client: TransactionClient,
    input: SaveMappingInput,
): Promise<StoredSourceProduct | null> {
    const value = input.sourceProduct;
    const result = await client.query<SourceProductRow>(
        `INSERT INTO sourcing_source_products (
             tenant_id, source_platform, external_product_id, canonical_url,
             seller_id, title_ko, title_zh, thumbnail_url, sale_status,
             restriction_status, restriction_reason, customs_requirement,
             verification_provenance, source_version, last_checked_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'MANUAL_UNVERIFIED',$13,$14::timestamptz)
         ON CONFLICT (tenant_id, source_platform, external_product_id)
         WHERE deleted_at IS NULL
         DO UPDATE SET canonical_url = EXCLUDED.canonical_url,
                       seller_id = EXCLUDED.seller_id,
                       title_ko = EXCLUDED.title_ko,
                       title_zh = EXCLUDED.title_zh,
                       thumbnail_url = EXCLUDED.thumbnail_url,
                       sale_status = EXCLUDED.sale_status,
                       restriction_status = EXCLUDED.restriction_status,
                       restriction_reason = EXCLUDED.restriction_reason,
                       customs_requirement = EXCLUDED.customs_requirement,
                       source_version = EXCLUDED.source_version,
                       last_checked_at = EXCLUDED.last_checked_at
         WHERE sourcing_source_products.verification_provenance = 'MANUAL_UNVERIFIED'
           AND sourcing_source_products.last_checked_at <= EXCLUDED.last_checked_at
         RETURNING id, source_version, last_checked_at, verification_provenance`,
        [
            input.tenantId, value.platform, value.externalProductId, value.canonicalUrl,
            value.sellerId ?? null, value.titleKo ?? null, value.titleZh ?? null,
            value.thumbnailUrl ?? null, value.saleStatus, value.restrictionStatus,
            value.restrictionReason ?? null, value.customsRequirement,
            value.sourceVersion, value.lastCheckedAt,
        ],
    );
    const row = result.rows[0];
    return row ? { id: row.id, sourceVersion: row.source_version,
        lastCheckedAt: row.last_checked_at.toISOString(),
        verificationProvenance: row.verification_provenance } : null;
}

export async function upsertSourceOption(
    client: TransactionClient,
    input: SaveMappingInput,
    productId: string,
): Promise<StoredSourceOption | null> {
    const value = input.sourceOption;
    const result = await client.query<SourceOptionRow>(
        `INSERT INTO sourcing_source_options (
             tenant_id, source_product_id, external_sku_id, option_attributes,
             option_label_ko, option_label_zh, unit_price_cny, stock_status,
             stock_quantity, minimum_quantity, quantity_step,
             china_shipping_status, china_shipping_cny, source_version, last_checked_at
             , verification_provenance
         ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::numeric,$8,$9,$10,$11,$12,$13::numeric,$14,$15::timestamptz,'MANUAL_UNVERIFIED')
         ON CONFLICT (tenant_id, source_product_id, external_sku_id)
         WHERE deleted_at IS NULL
         DO UPDATE SET option_attributes = EXCLUDED.option_attributes,
                       option_label_ko = EXCLUDED.option_label_ko,
                       option_label_zh = EXCLUDED.option_label_zh,
                       unit_price_cny = EXCLUDED.unit_price_cny,
                       stock_status = EXCLUDED.stock_status,
                       stock_quantity = EXCLUDED.stock_quantity,
                       minimum_quantity = EXCLUDED.minimum_quantity,
                       quantity_step = EXCLUDED.quantity_step,
                       china_shipping_status = EXCLUDED.china_shipping_status,
                       china_shipping_cny = EXCLUDED.china_shipping_cny,
                       source_version = EXCLUDED.source_version,
                       last_checked_at = EXCLUDED.last_checked_at
         WHERE sourcing_source_options.verification_provenance = 'MANUAL_UNVERIFIED'
           AND sourcing_source_options.last_checked_at <= EXCLUDED.last_checked_at
         RETURNING id, source_version, last_checked_at, verification_provenance`,
        [
            input.tenantId, productId, value.externalSkuId,
            JSON.stringify(value.optionAttributes), value.optionLabelKo ?? null,
            value.optionLabelZh ?? null, value.unitPriceCny, value.stockStatus,
            value.stockQuantity, value.minimumQuantity, value.quantityStep,
            value.chinaShippingStatus, value.chinaShippingCny,
            value.sourceVersion, value.lastCheckedAt,
        ],
    );
    const row = result.rows[0];
    return row ? { id: row.id, sourceVersion: row.source_version,
        lastCheckedAt: row.last_checked_at.toISOString(),
        verificationProvenance: row.verification_provenance } : null;
}

async function insertManualDraftMappingRule(
    client: TransactionClient,
    input: SaveMappingInput,
    item: SourcingOrderItemRow,
    product: StoredSourceProduct,
    option: StoredSourceOption,
): Promise<{ id: string; revision: number } | null> {
    if (!item.marketProductId?.trim()) return null;
    const lockKey = [input.tenantId, item.marketAccountId,
        item.marketProductId, item.marketOptionId ?? "<NO_OPTION>"].join(":");
    await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
        [lockKey],
    );
    const revisionResult = await client.query<{ revision: number } & QueryResultRow>(
        `SELECT COALESCE(MAX(rule_revision), 0) + 1 AS revision
           FROM sourcing_mapping_rules
          WHERE tenant_id = $1 AND market_account_id = $2
            AND market_product_id = $3
            AND market_option_id IS NOT DISTINCT FROM $4::text`,
        [input.tenantId, item.marketAccountId, item.marketProductId, item.marketOptionId],
    );
    const revision = Number(revisionResult.rows[0]?.revision ?? 1);
    const result = await client.query<{ id: string } & QueryResultRow>(
        `INSERT INTO sourcing_mapping_rules (
             tenant_id, market_account_id, market_product_id, market_option_id,
             rule_revision, source_product_id, source_option_id,
             external_sku_id_snapshot, quantity_multiplier,
             verification_provenance, approval_status,
             created_by_membership_id, correlation_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MANUAL_UNVERIFIED','DRAFT',$10,$11::uuid)
         RETURNING id`,
        [input.tenantId, item.marketAccountId, item.marketProductId, item.marketOptionId,
            revision, product.id, option.id, input.sourceOption.externalSkuId,
            input.quantityMultiplier, input.membershipId, input.correlationId],
    );
    return { id: result.rows[0].id, revision };
}

export async function findLatestApprovedReusableRule(
    client: TransactionClient,
    tenantId: string,
    orderItemId: string,
): Promise<ReusableSourcingRule | null> {
    const result = await client.query<MappingRuleRow>(
        `SELECT rule.id, rule.rule_revision, rule.market_product_id,
                rule.market_option_id, rule.source_product_id,
                rule.source_option_id, rule.external_sku_id_snapshot,
                rule.quantity_multiplier, rule.verification_provenance,
                rule.approval_status, rule.approved_at
           FROM order_items item
           JOIN sourcing_mapping_rules rule
             ON rule.tenant_id = item.tenant_id
            AND rule.market_account_id = item.market_account_id
            AND rule.market_product_id = item.market_product_id
            AND rule.market_option_id IS NOT DISTINCT FROM item.market_option_id
            AND rule.approval_status = 'APPROVED'
            AND rule.verification_provenance = 'SERVER_VERIFIED'
            AND rule.deleted_at IS NULL
           JOIN sourcing_source_products product
             ON product.tenant_id = rule.tenant_id AND product.id = rule.source_product_id
            AND product.verification_provenance = 'SERVER_VERIFIED'
            AND product.deleted_at IS NULL
           JOIN sourcing_source_options option
             ON option.tenant_id = rule.tenant_id
            AND option.source_product_id = rule.source_product_id
            AND option.id = rule.source_option_id
            AND option.verification_provenance = 'SERVER_VERIFIED'
            AND option.deleted_at IS NULL
          WHERE item.tenant_id = $1 AND item.id = $2 AND item.deleted_at IS NULL
          ORDER BY rule.rule_revision DESC, rule.approved_at DESC, rule.id DESC
          LIMIT 1`,
        [tenantId, orderItemId],
    );
    const row = result.rows[0];
    if (!row || !row.approved_at || row.verification_provenance !== "SERVER_VERIFIED"
        || row.approval_status !== "APPROVED") return null;
    return {
        id: row.id, ruleRevision: row.rule_revision,
        marketProductId: row.market_product_id, marketOptionId: row.market_option_id,
        sourceProductId: row.source_product_id, sourceOptionId: row.source_option_id,
        externalSkuId: row.external_sku_id_snapshot,
        quantityMultiplier: row.quantity_multiplier,
        verificationProvenance: "SERVER_VERIFIED", approvalStatus: "APPROVED",
        approvedAt: row.approved_at.toISOString(),
    };
}

export async function getActiveMapping(
    client: TransactionClient,
    tenantId: string,
    orderItemId: string,
    lock = false,
): Promise<ActiveSourcingMapping | null> {
    const result = await client.query<MappingRow>(
        `SELECT id, mapping_revision, order_item_version::text AS order_item_version,
                market_account_id, mapping_rule_id, rule_revision_snapshot,
                source_product_id, source_option_id,
                source_product_version_snapshot, source_option_version_snapshot,
                product_verification_snapshot, option_verification_snapshot,
                external_sku_id_snapshot, option_attributes_snapshot,
                option_label_ko_snapshot, option_label_zh_snapshot,
                unit_price_cny_snapshot::text, stock_status_snapshot,
                stock_quantity_snapshot, minimum_quantity_snapshot,
                quantity_step_snapshot, china_shipping_status_snapshot,
                china_shipping_cny_snapshot::text, quantity_multiplier,
                source_checked_at_snapshot
           FROM order_item_sourcing_mappings
          WHERE tenant_id = $1 AND order_item_id = $2
            AND status = 'ACTIVE' AND deleted_at IS NULL
          ${lock ? "FOR UPDATE" : ""}`,
        [tenantId, orderItemId],
    );
    return result.rows[0] ? toMapping(result.rows[0]) : null;
}

export async function insertMapping(
    client: TransactionClient,
    input: SaveMappingInput,
    item: SourcingOrderItemRow,
    product: StoredSourceProduct,
    option: StoredSourceOption,
    previous: ActiveSourcingMapping | null,
): Promise<SavedSourcingMapping> {
    if (previous) {
        await client.query(
            `UPDATE order_item_sourcing_mappings
                SET status = 'SUPERSEDED'
              WHERE tenant_id = $1 AND id = $2 AND status = 'ACTIVE'`,
            [input.tenantId, previous.id],
        );
    }
    let orderItemVersion = item.version;
    if (item.sourcingStatus === "UNMATCHED") {
        const updated = await client.query<{ version: string } & QueryResultRow>(
            `UPDATE order_items SET sourcing_status = 'MATCHED'
              WHERE tenant_id = $1 AND id = $2 AND version = $3::bigint
              RETURNING version::text AS version`,
            [input.tenantId, item.id, item.version],
        );
        orderItemVersion = updated.rows[0]?.version ?? item.version;
    }
    const revision = (previous?.mappingRevision ?? 0) + 1;
    const value = input.sourceOption;
    const checkedAt = new Date(Math.min(
        Date.parse(product.lastCheckedAt),
        Date.parse(option.lastCheckedAt),
    )).toISOString();
    const rule = await insertManualDraftMappingRule(client, input, item, product, option);
    const result = await client.query<MappingRow>(
        `INSERT INTO order_item_sourcing_mappings (
             tenant_id, market_account_id, order_item_id, mapping_revision,
             order_item_version, market_product_id, market_option_id,
             mapping_rule_id, rule_revision_snapshot,
             source_product_id, source_option_id,
             source_product_version_snapshot, source_option_version_snapshot,
             product_verification_snapshot, option_verification_snapshot,
             external_sku_id_snapshot, option_attributes_snapshot,
             option_label_ko_snapshot, option_label_zh_snapshot,
             unit_price_cny_snapshot, stock_status_snapshot, stock_quantity_snapshot,
             minimum_quantity_snapshot, quantity_step_snapshot,
             china_shipping_status_snapshot, china_shipping_cny_snapshot,
             quantity_multiplier, source_checked_at_snapshot,
             selected_by_membership_id, correlation_id
         ) VALUES (
             $1,$2,$3,$4,$5::bigint,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
             $16,$17::jsonb,$18,$19,$20::numeric,$21,$22,$23,$24,$25,$26::numeric,$27,
             $28::timestamptz,$29,$30::uuid
         )
         RETURNING id, mapping_revision, order_item_version::text,
                   market_account_id, mapping_rule_id, rule_revision_snapshot,
                   source_product_id, source_option_id,
                   source_product_version_snapshot, source_option_version_snapshot,
                   product_verification_snapshot, option_verification_snapshot,
                   external_sku_id_snapshot, option_attributes_snapshot,
                   option_label_ko_snapshot, option_label_zh_snapshot,
                   unit_price_cny_snapshot::text, stock_status_snapshot,
                   stock_quantity_snapshot, minimum_quantity_snapshot,
                   quantity_step_snapshot, china_shipping_status_snapshot,
                   china_shipping_cny_snapshot::text, quantity_multiplier,
                   source_checked_at_snapshot`,
        [
            input.tenantId, item.marketAccountId, item.id, revision, orderItemVersion,
            item.marketProductId, item.marketOptionId, rule?.id ?? null,
            rule?.revision ?? null, product.id, option.id,
            product.sourceVersion, option.sourceVersion,
            product.verificationProvenance, option.verificationProvenance,
            value.externalSkuId,
            JSON.stringify(value.optionAttributes), value.optionLabelKo ?? null,
            value.optionLabelZh ?? null, value.unitPriceCny, value.stockStatus,
            value.stockQuantity, value.minimumQuantity, value.quantityStep,
            value.chinaShippingStatus, value.chinaShippingCny,
            input.quantityMultiplier, checkedAt, input.membershipId, input.correlationId,
        ],
    );
    const mapping = toMapping(result.rows[0]);
    await client.query(
        `INSERT INTO audit_logs (
             tenant_id, market_account_id, actor_type, actor_membership_id,
             action, entity_type, entity_id, correlation_id, after_snapshot
         ) VALUES ($1,$2,'USER',$3,'SOURCING_MAPPING_SAVED',
                   'ORDER_ITEM_SOURCING_MAPPING',$4,$5::uuid,$6::jsonb)`,
        [input.tenantId, item.marketAccountId, input.membershipId, mapping.id,
            input.correlationId, JSON.stringify({
                orderItemId: item.id,
                mappingRevision: mapping.mappingRevision,
                externalSkuId: mapping.externalSkuIdSnapshot,
                quantityMultiplier: mapping.quantityMultiplier,
            })],
    );
    return {
        id: mapping.id,
        mappingRevision: mapping.mappingRevision,
        orderItemId: item.id,
        orderItemVersion,
        sourceProductId: product.id,
        sourceOptionId: option.id,
        externalSkuId: mapping.externalSkuIdSnapshot,
        selectedOption: mapping.optionAttributesSnapshot,
        unitPriceCny: mapping.unitPriceCnySnapshot,
        sourceCheckedAt: mapping.sourceCheckedAtSnapshot,
        quantityMultiplier: mapping.quantityMultiplier,
        verificationProvenance: product.verificationProvenance === "SERVER_VERIFIED"
            && option.verificationProvenance === "SERVER_VERIFIED"
            ? "SERVER_VERIFIED" : "MANUAL_UNVERIFIED",
        mappingRuleId: rule?.id ?? null,
        ruleRevision: rule?.revision ?? null,
    };
}

export async function loadMappingValidationContext(
    client: TransactionClient,
    tenantId: string,
    orderItemId: string,
    lock: boolean,
): Promise<MappingValidationContext | null> {
    const result = await client.query<ValidationRow>(
        `SELECT oi.id AS item_id, oi.market_account_id, oi.sales_order_id, oi.quantity,
                oi.market_product_id, oi.market_option_id, oi.sourcing_status,
                oi.internal_work_status, oi.version::text AS version,
                mapping.id AS mapping_id, mapping.mapping_revision,
                mapping.order_item_version::text AS order_item_version,
                mapping.mapping_rule_id, mapping.rule_revision_snapshot,
                mapping.source_product_id, mapping.source_option_id,
                mapping.source_product_version_snapshot,
                mapping.source_option_version_snapshot,
                mapping.product_verification_snapshot,
                mapping.option_verification_snapshot,
                mapping.external_sku_id_snapshot, mapping.option_attributes_snapshot,
                mapping.option_label_ko_snapshot, mapping.option_label_zh_snapshot,
                mapping.unit_price_cny_snapshot::text,
                mapping.stock_status_snapshot, mapping.stock_quantity_snapshot,
                mapping.minimum_quantity_snapshot, mapping.quantity_step_snapshot,
                mapping.china_shipping_status_snapshot,
                mapping.china_shipping_cny_snapshot::text,
                mapping.quantity_multiplier, mapping.source_checked_at_snapshot,
                product.sale_status AS product_sale_status,
                product.restriction_status AS product_restriction_status,
                product.customs_requirement AS product_customs_requirement,
                product.source_version AS product_source_version,
                product.verification_provenance AS product_verification_provenance,
                product.last_checked_at AS product_last_checked_at,
                option.external_sku_id AS option_external_sku_id,
                option.unit_price_cny::text AS option_unit_price_cny,
                option.stock_status AS option_stock_status,
                option.stock_quantity AS option_stock_quantity,
                option.minimum_quantity AS option_minimum_quantity,
                option.quantity_step AS option_quantity_step,
                option.china_shipping_status AS option_china_shipping_status,
                option.china_shipping_cny::text AS option_china_shipping_cny,
                option.source_version AS option_source_version,
                option.verification_provenance AS option_verification_provenance,
                option.last_checked_at AS option_last_checked_at,
                recipient.id AS recipient_id,
                recipient.recipient_ready,
                recipient.has_customs_code,
                recipient.customs_code_format_status,
                recipient.customs_identity_status,
                recipient.customs_consent_at,
                recipient.customs_verified_at
           FROM order_items oi
           JOIN order_item_sourcing_mappings mapping
             ON mapping.tenant_id = oi.tenant_id AND mapping.order_item_id = oi.id
            AND mapping.status = 'ACTIVE' AND mapping.deleted_at IS NULL
           JOIN sourcing_source_products product
             ON product.tenant_id = mapping.tenant_id
            AND product.id = mapping.source_product_id AND product.deleted_at IS NULL
           JOIN sourcing_source_options option
             ON option.tenant_id = mapping.tenant_id
            AND option.source_product_id = mapping.source_product_id
            AND option.id = mapping.source_option_id AND option.deleted_at IS NULL
           LEFT JOIN LATERAL (
             SELECT r.id,
                    (r.recipient_name_encrypted IS NOT NULL
                     AND r.phone_encrypted IS NOT NULL
                     AND r.postal_code_encrypted IS NOT NULL
                     AND r.address_line1_encrypted IS NOT NULL) AS recipient_ready,
                    (r.personal_customs_code_encrypted IS NOT NULL) AS has_customs_code,
                    r.customs_code_format_status,
                    r.customs_identity_status,
                    r.customs_consent_at,
                    r.customs_verified_at
               FROM order_recipients r
              WHERE r.tenant_id = oi.tenant_id AND r.sales_order_id = oi.sales_order_id
                AND r.is_current AND r.deleted_at IS NULL
              ORDER BY r.created_at DESC, r.id DESC LIMIT 1
           ) recipient ON true
          WHERE oi.tenant_id = $1 AND oi.id = $2 AND oi.deleted_at IS NULL
          ${lock ? "FOR UPDATE OF oi, mapping, product, option" : ""}`,
        [tenantId, orderItemId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const item = toItem({ ...row, id: row.item_id });
    const mapping = toMapping({ ...row, id: row.mapping_id });
    return {
        item,
        mapping,
        product: {
            saleStatus: row.product_sale_status,
            restrictionStatus: row.product_restriction_status,
            customsRequirement: row.product_customs_requirement,
            sourceVersion: row.product_source_version,
            verificationProvenance: row.product_verification_provenance,
            lastCheckedAt: row.product_last_checked_at.toISOString(),
        },
        option: {
            externalSkuId: row.option_external_sku_id,
            unitPriceCny: row.option_unit_price_cny,
            stockStatus: row.option_stock_status,
            stockQuantity: row.option_stock_quantity,
            minimumQuantity: row.option_minimum_quantity,
            quantityStep: row.option_quantity_step,
            chinaShippingStatus: row.option_china_shipping_status,
            chinaShippingCny: row.option_china_shipping_cny,
            sourceVersion: row.option_source_version,
            verificationProvenance: row.option_verification_provenance,
            lastCheckedAt: row.option_last_checked_at.toISOString(),
        },
        recipient: row.recipient_id ? {
            id: row.recipient_id,
            recipientReady: row.recipient_ready === true,
            hasCustomsCode: row.has_customs_code === true,
            customsCodeFormatStatus: row.customs_code_format_status ?? "NOT_CHECKED",
            customsIdentityStatus: row.customs_identity_status ?? "NOT_CHECKED",
            customsConsentAt: row.customs_consent_at?.toISOString() ?? null,
            customsVerifiedAt: row.customs_verified_at?.toISOString() ?? null,
        } : null,
    };
}

function toDraft(row: DraftDbRow, replayed: boolean): PurchaseDraftRecord {
    const numberOrNull = (value: string | null) => value === null ? null : Number(value);
    return {
        id: row.id, orderItemId: row.order_item_id, mappingId: row.mapping_id,
        mappingRevision: row.mapping_revision, status: row.status,
        sourceQuantity: row.source_quantity, externalSkuId: row.external_sku_id_snapshot,
        sourceVerificationProvenance: row.source_verification_provenance,
        unitPriceCny: row.unit_price_cny, productSubtotalCny: row.product_subtotal_cny,
        chinaShippingStatus: row.china_shipping_status, chinaShippingCny: row.china_shipping_cny,
        exchangeRateKrwPerCny: row.exchange_rate_krw_per_cny,
        exchangeRateSource: row.exchange_rate_source,
        exchangeRateObservedAt: row.exchange_rate_observed_at.toISOString(),
        productAmountKrw: Number(row.product_amount_krw),
        chinaShippingAmountKrw: numberOrNull(row.china_shipping_amount_krw),
        agencyFeeKrw: Number(row.agency_fee_krw),
        internationalShippingStatus: row.international_shipping_status,
        internationalShippingAmountKrw: numberOrNull(row.international_shipping_amount_krw),
        customsTaxStatus: row.customs_tax_status,
        customsTaxAmountKrw: numberOrNull(row.customs_tax_amount_krw),
        otherFeeKrw: Number(row.other_fee_krw), discountKrw: Number(row.discount_krw),
        discountStatus: row.discount_status,
        knownCostTotalKrw: Number(row.known_cost_total_krw),
        blockingReasons: row.blocking_reasons, warnings: row.warnings,
        quoteExpiresAt: row.quote_expires_at.toISOString(), replayed,
        prePaymentOnly: true, purchaseSubmissionStatus: "NOT_SUBMITTED",
        paymentStatus: "NOT_STARTED", canSubmitPurchase: false,
        canCreatePaymentSession: false,
    };
}

const draftColumns = `id, order_item_id, mapping_id, mapping_revision, status,
    source_quantity, external_sku_id_snapshot, source_verification_provenance,
    unit_price_cny::text,
    product_subtotal_cny::text, china_shipping_status, china_shipping_cny::text,
    exchange_rate_krw_per_cny::text, exchange_rate_source, exchange_rate_observed_at,
    product_amount_krw::text, china_shipping_amount_krw::text, agency_fee_krw::text,
    international_shipping_status, international_shipping_amount_krw::text,
    customs_tax_status, customs_tax_amount_krw::text, other_fee_krw::text,
    discount_krw::text, discount_status, known_cost_total_krw::text, blocking_reasons, warnings,
    quote_expires_at, request_fingerprint`;

export async function findDraftByIdempotencyKey(
    client: TransactionClient,
    tenantId: string,
    key: string,
): Promise<{ draft: PurchaseDraftRecord; fingerprint: string } | null> {
    const result = await client.query<DraftDbRow>(
        `SELECT ${draftColumns} FROM sourcing_purchase_drafts
          WHERE tenant_id = $1 AND idempotency_key = $2 AND deleted_at IS NULL`,
        [tenantId, key],
    );
    return result.rows[0]
        ? { draft: toDraft(result.rows[0], true), fingerprint: result.rows[0].request_fingerprint }
        : null;
}

export async function insertPurchaseDraft(
    client: TransactionClient,
    input: InsertDraftInput,
): Promise<PurchaseDraftRecord> {
    const { context } = input;
    const superseded = await client.query<{ id: string } & QueryResultRow>(
        `UPDATE sourcing_purchase_drafts SET status = 'SUPERSEDED'
          WHERE tenant_id = $1 AND order_item_id = $2
            AND status IN ('BLOCKED','READY_FOR_REVIEW') AND deleted_at IS NULL
         RETURNING id`,
        [input.tenantId, context.item.id],
    );
    for (const previous of superseded.rows) {
        await client.query(
            `INSERT INTO sourcing_purchase_draft_events (
                 tenant_id, draft_id, event_type, actor_membership_id,
                 correlation_id, snapshot
             ) VALUES ($1,$2,'DRAFT_SUPERSEDED',$3,$4::uuid,$5::jsonb)`,
            [input.tenantId, previous.id, input.membershipId, input.correlationId,
                JSON.stringify({ supersededByRequestRevision: input.requestRevision })],
        );
    }
    const result = await client.query<DraftDbRow>(
        `INSERT INTO sourcing_purchase_drafts (
             tenant_id, market_account_id, order_item_id, mapping_id,
             mapping_revision, order_item_version, recipient_id,
             source_product_id, source_option_id, source_verification_provenance,
             external_sku_id_snapshot, source_quantity, unit_price_cny, product_subtotal_cny,
             china_shipping_status, china_shipping_cny,
             exchange_rate_krw_per_cny, exchange_rate_source, exchange_rate_observed_at,
             product_amount_krw, china_shipping_amount_krw, agency_fee_krw,
             international_shipping_status, international_shipping_amount_krw,
             customs_tax_status, customs_tax_amount_krw, other_fee_krw,
             discount_krw, discount_status, known_cost_total_krw, recipient_ready,
             customs_code_format_status, customs_identity_status,
             customs_consent_at_snapshot, customs_verified_at_snapshot, forwarder_status,
             blocking_reasons, warnings, status, request_revision,
             idempotency_key, request_fingerprint, quote_expires_at, user_note,
             created_by_membership_id, correlation_id
         ) VALUES (
             $1,$2,$3,$4,$5,$6::bigint,$7,$8,$9,$10,$11,$12,$13::numeric,$14::numeric,
             $15,$16::numeric,$17::numeric,$18,$19::timestamptz,$20,$21,$22,$23,$24,
             $25,$26,$27,$28,$29,$30,$31,$32,$33,$34::timestamptz,$35::timestamptz,
             $36,$37::jsonb,$38::jsonb,$39,$40,$41,$42,$43::timestamptz,$44,$45,$46::uuid
         ) RETURNING ${draftColumns}`,
        [
            input.tenantId, context.item.marketAccountId, context.item.id, context.mapping.id,
            context.mapping.mappingRevision, context.item.version, context.recipient?.id ?? null,
            context.mapping.sourceProductId, context.mapping.sourceOptionId,
            context.product.verificationProvenance === "SERVER_VERIFIED"
                && context.option.verificationProvenance === "SERVER_VERIFIED"
                ? "SERVER_VERIFIED" : "MANUAL_UNVERIFIED",
            context.mapping.externalSkuIdSnapshot, input.sourceQuantity,
            context.option.unitPriceCny, input.productSubtotalCny,
            context.option.chinaShippingStatus, context.option.chinaShippingCny,
            input.exchangeRateKrwPerCny, input.exchangeRateSource,
            input.exchangeRateObservedAt, input.productAmountKrw,
            input.chinaShippingAmountKrw, input.agencyFeeKrw,
            input.internationalShippingStatus, input.internationalShippingAmountKrw,
            input.customsTaxStatus, input.customsTaxAmountKrw,
            input.otherFeeKrw, input.discountKrw, input.discountStatus,
            input.knownCostTotalKrw,
            context.recipient?.recipientReady ?? false,
            context.recipient?.customsCodeFormatStatus ?? "MISSING",
            context.recipient?.customsIdentityStatus ?? "NOT_CHECKED",
            context.recipient?.customsConsentAt ?? null,
            context.recipient?.customsVerifiedAt ?? null,
            input.forwarderStatus, JSON.stringify(input.blockingReasons),
            JSON.stringify(input.warnings), input.status, input.requestRevision,
            input.idempotencyKey, input.requestFingerprint, input.quoteExpiresAt,
            input.userNote ?? null, input.membershipId, input.correlationId,
        ],
    );
    const draft = toDraft(result.rows[0], false);
    await client.query(
        `INSERT INTO sourcing_purchase_draft_events (
             tenant_id, draft_id, event_type, actor_membership_id,
             correlation_id, snapshot
         ) VALUES ($1,$2,$3,$4,$5::uuid,$6::jsonb)`,
        [input.tenantId, draft.id,
            draft.status === "BLOCKED" ? "DRAFT_BLOCKED" : "DRAFT_PREPARED",
            input.membershipId, input.correlationId,
            JSON.stringify({ status: draft.status, blockingReasons: draft.blockingReasons,
                knownCostTotalKrw: draft.knownCostTotalKrw, prePaymentOnly: true })],
    );
    await client.query(
        `INSERT INTO audit_logs (
             tenant_id, market_account_id, actor_type, actor_membership_id,
             action, entity_type, entity_id, correlation_id, after_snapshot
         ) VALUES ($1,$2,'USER',$3,'SOURCING_PURCHASE_DRAFT_PREPARED',
                   'SOURCING_PURCHASE_DRAFT',$4,$5::uuid,$6::jsonb)`,
        [input.tenantId, context.item.marketAccountId, input.membershipId,
            draft.id, input.correlationId,
            JSON.stringify({ orderItemId: context.item.id, status: draft.status,
                mappingRevision: draft.mappingRevision, prePaymentOnly: true })],
    );
    return draft;
}
