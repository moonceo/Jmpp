-- Production sourcing core: reusable Taobao/SourcingLife catalog snapshots,
-- versioned order-item mappings, and a ledger that is structurally unable to
-- submit a purchase or start payment.

ALTER TABLE order_recipients
    ADD COLUMN customs_code_format_status text NOT NULL DEFAULT 'NOT_CHECKED',
    ADD COLUMN customs_identity_status text NOT NULL DEFAULT 'NOT_CHECKED',
    ADD COLUMN customs_consent_at timestamptz,
    ADD COLUMN customs_verified_at timestamptz,
    ADD CONSTRAINT order_recipients_customs_format_status_ck CHECK (
        customs_code_format_status IN ('NOT_CHECKED', 'MISSING', 'FORMAT_VALID', 'INVALID')
    ),
    ADD CONSTRAINT order_recipients_customs_identity_status_ck CHECK (
        customs_identity_status IN ('NOT_CHECKED', 'MATCHED', 'MISMATCH', 'NOT_REQUIRED')
    ),
    ADD CONSTRAINT order_recipients_customs_verified_time_ck CHECK (
        customs_verified_at IS NULL OR customs_code_format_status = 'FORMAT_VALID'
    );

CREATE TABLE sourcing_source_products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    source_platform text NOT NULL,
    external_product_id text NOT NULL,
    canonical_url text NOT NULL,
    seller_id text,
    title_ko text,
    title_zh text,
    thumbnail_url text,
    sale_status text NOT NULL,
    restriction_status text NOT NULL DEFAULT 'CLEAR',
    restriction_reason text,
    customs_requirement text NOT NULL DEFAULT 'FORMAT_VALID',
    verification_provenance text NOT NULL DEFAULT 'MANUAL_UNVERIFIED',
    source_version text NOT NULL,
    last_checked_at timestamptz NOT NULL,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT sourcing_products_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT sourcing_products_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_products_platform_ck CHECK (
        source_platform IN ('TAOBAO', 'TMALL', 'SOURCING_LIFE')
    ),
    CONSTRAINT sourcing_products_external_id_ck CHECK (btrim(external_product_id) <> ''),
    CONSTRAINT sourcing_products_url_ck CHECK (canonical_url ~ '^https://'),
    CONSTRAINT sourcing_products_sale_status_ck CHECK (
        sale_status IN ('ACTIVE', 'UNAVAILABLE', 'DELETED')
    ),
    CONSTRAINT sourcing_products_restriction_ck CHECK (
        restriction_status IN ('CLEAR', 'REVIEW_REQUIRED', 'PROHIBITED')
    ),
    CONSTRAINT sourcing_products_restriction_reason_ck CHECK (
        restriction_status = 'CLEAR' OR btrim(COALESCE(restriction_reason, '')) <> ''
    ),
    CONSTRAINT sourcing_products_customs_requirement_ck CHECK (
        customs_requirement IN ('NOT_REQUIRED', 'FORMAT_VALID', 'IDENTITY_VERIFIED')
    ),
    CONSTRAINT sourcing_products_verification_provenance_ck CHECK (
        verification_provenance IN ('MANUAL_UNVERIFIED', 'SERVER_VERIFIED')
    ),
    CONSTRAINT sourcing_products_source_version_ck CHECK (btrim(source_version) <> ''),
    CONSTRAINT sourcing_products_attributes_ck CHECK (jsonb_typeof(attributes) = 'object'),
    CONSTRAINT sourcing_products_version_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX sourcing_products_external_uidx
    ON sourcing_source_products (tenant_id, source_platform, external_product_id)
    WHERE deleted_at IS NULL;

CREATE INDEX sourcing_products_checked_idx
    ON sourcing_source_products (tenant_id, last_checked_at, id)
    WHERE deleted_at IS NULL;

CREATE TABLE sourcing_source_options (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    source_product_id uuid NOT NULL,
    external_sku_id text NOT NULL,
    option_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    option_label_ko text,
    option_label_zh text,
    unit_price_cny numeric(18, 2) NOT NULL,
    stock_status text NOT NULL,
    stock_quantity integer,
    minimum_quantity integer NOT NULL DEFAULT 1,
    quantity_step integer NOT NULL DEFAULT 1,
    china_shipping_status text NOT NULL DEFAULT 'UNKNOWN',
    china_shipping_cny numeric(18, 2),
    verification_provenance text NOT NULL DEFAULT 'MANUAL_UNVERIFIED',
    source_version text NOT NULL,
    last_checked_at timestamptz NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT sourcing_options_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT sourcing_options_tenant_product_id_key UNIQUE (tenant_id, source_product_id, id),
    CONSTRAINT sourcing_options_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_options_product_fk
        FOREIGN KEY (tenant_id, source_product_id)
        REFERENCES sourcing_source_products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_options_external_sku_ck CHECK (btrim(external_sku_id) <> ''),
    CONSTRAINT sourcing_options_attributes_ck CHECK (jsonb_typeof(option_attributes) = 'object'),
    CONSTRAINT sourcing_options_price_ck CHECK (unit_price_cny >= 0),
    CONSTRAINT sourcing_options_stock_status_ck CHECK (
        stock_status IN ('AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNKNOWN')
    ),
    CONSTRAINT sourcing_options_stock_quantity_ck CHECK (
        stock_quantity IS NULL OR stock_quantity >= 0
    ),
    CONSTRAINT sourcing_options_quantity_ck CHECK (
        minimum_quantity > 0 AND quantity_step > 0
    ),
    CONSTRAINT sourcing_options_china_shipping_status_ck CHECK (
        china_shipping_status IN ('CONFIRMED', 'ESTIMATED', 'UNKNOWN')
    ),
    CONSTRAINT sourcing_options_china_shipping_amount_ck CHECK (
        (china_shipping_status = 'UNKNOWN' AND china_shipping_cny IS NULL)
        OR (china_shipping_status <> 'UNKNOWN' AND china_shipping_cny IS NOT NULL AND china_shipping_cny >= 0)
    ),
    CONSTRAINT sourcing_options_source_version_ck CHECK (btrim(source_version) <> ''),
    CONSTRAINT sourcing_options_verification_provenance_ck CHECK (
        verification_provenance IN ('MANUAL_UNVERIFIED', 'SERVER_VERIFIED')
    ),
    CONSTRAINT sourcing_options_version_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX sourcing_options_external_uidx
    ON sourcing_source_options (tenant_id, source_product_id, external_sku_id)
    WHERE deleted_at IS NULL;

CREATE INDEX sourcing_options_checked_idx
    ON sourcing_source_options (tenant_id, last_checked_at, id)
    WHERE deleted_at IS NULL;

CREATE TABLE sourcing_mapping_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    market_product_id text NOT NULL,
    market_option_id text,
    rule_revision integer NOT NULL,
    source_product_id uuid NOT NULL,
    source_option_id uuid NOT NULL,
    external_sku_id_snapshot text NOT NULL,
    quantity_multiplier integer NOT NULL,
    verification_provenance text NOT NULL,
    approval_status text NOT NULL DEFAULT 'DRAFT',
    created_by_membership_id uuid NOT NULL,
    correlation_id uuid NOT NULL,
    approved_by_membership_id uuid,
    approved_at timestamptz,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT sourcing_rules_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT sourcing_rules_key_revision_key UNIQUE NULLS NOT DISTINCT (
        tenant_id, market_account_id, market_product_id, market_option_id, rule_revision
    ),
    CONSTRAINT sourcing_rules_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_rules_market_account_fk
        FOREIGN KEY (tenant_id, market_account_id)
        REFERENCES market_accounts (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_rules_source_product_fk
        FOREIGN KEY (tenant_id, source_product_id)
        REFERENCES sourcing_source_products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_rules_source_option_fk
        FOREIGN KEY (tenant_id, source_product_id, source_option_id)
        REFERENCES sourcing_source_options (tenant_id, source_product_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_rules_created_by_fk
        FOREIGN KEY (tenant_id, created_by_membership_id)
        REFERENCES memberships (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_rules_approved_by_fk
        FOREIGN KEY (tenant_id, approved_by_membership_id)
        REFERENCES memberships (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_rules_key_not_blank_ck CHECK (
        btrim(market_product_id) <> ''
        AND (market_option_id IS NULL OR btrim(market_option_id) <> '')
    ),
    CONSTRAINT sourcing_rules_revision_ck CHECK (rule_revision > 0),
    CONSTRAINT sourcing_rules_sku_ck CHECK (btrim(external_sku_id_snapshot) <> ''),
    CONSTRAINT sourcing_rules_quantity_ck CHECK (quantity_multiplier > 0),
    CONSTRAINT sourcing_rules_verification_ck CHECK (
        verification_provenance IN ('MANUAL_UNVERIFIED', 'SERVER_VERIFIED')
    ),
    CONSTRAINT sourcing_rules_approval_ck CHECK (
        approval_status IN ('DRAFT', 'APPROVED', 'SUPERSEDED', 'REVOKED')
    ),
    CONSTRAINT sourcing_rules_approval_evidence_ck CHECK (
        (approval_status = 'APPROVED' AND approved_by_membership_id IS NOT NULL AND approved_at IS NOT NULL)
        OR approval_status <> 'APPROVED'
    ),
    CONSTRAINT sourcing_rules_version_ck CHECK (version > 0)
);

CREATE INDEX sourcing_rules_approved_lookup_idx
    ON sourcing_mapping_rules (
        tenant_id, market_account_id, market_product_id, market_option_id,
        rule_revision DESC, created_at DESC
    )
    WHERE approval_status = 'APPROVED' AND deleted_at IS NULL;

CREATE TABLE order_item_sourcing_mappings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    mapping_revision integer NOT NULL,
    order_item_version bigint NOT NULL,
    market_product_id text,
    market_option_id text,
    mapping_rule_id uuid,
    rule_revision_snapshot integer,
    source_product_id uuid NOT NULL,
    source_option_id uuid NOT NULL,
    source_product_version_snapshot text NOT NULL,
    source_option_version_snapshot text NOT NULL,
    product_verification_snapshot text NOT NULL,
    option_verification_snapshot text NOT NULL,
    external_sku_id_snapshot text NOT NULL,
    option_attributes_snapshot jsonb NOT NULL,
    option_label_ko_snapshot text,
    option_label_zh_snapshot text,
    unit_price_cny_snapshot numeric(18, 2) NOT NULL,
    stock_status_snapshot text NOT NULL,
    stock_quantity_snapshot integer,
    minimum_quantity_snapshot integer NOT NULL,
    quantity_step_snapshot integer NOT NULL,
    china_shipping_status_snapshot text NOT NULL,
    china_shipping_cny_snapshot numeric(18, 2),
    quantity_multiplier integer NOT NULL DEFAULT 1,
    source_checked_at_snapshot timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    selected_by_membership_id uuid NOT NULL,
    correlation_id uuid NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT sourcing_mappings_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT sourcing_mappings_tenant_item_revision_key
        UNIQUE (tenant_id, order_item_id, mapping_revision),
    CONSTRAINT sourcing_mappings_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_mappings_order_item_fk
        FOREIGN KEY (tenant_id, market_account_id, order_item_id)
        REFERENCES order_items (tenant_id, market_account_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_mappings_source_product_fk
        FOREIGN KEY (tenant_id, source_product_id)
        REFERENCES sourcing_source_products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_mappings_rule_fk
        FOREIGN KEY (tenant_id, mapping_rule_id)
        REFERENCES sourcing_mapping_rules (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_mappings_source_option_fk
        FOREIGN KEY (tenant_id, source_product_id, source_option_id)
        REFERENCES sourcing_source_options (tenant_id, source_product_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_mappings_membership_fk
        FOREIGN KEY (tenant_id, selected_by_membership_id)
        REFERENCES memberships (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_mappings_revision_ck CHECK (mapping_revision > 0),
    CONSTRAINT sourcing_mappings_item_version_ck CHECK (order_item_version > 0),
    CONSTRAINT sourcing_mappings_snapshot_versions_ck CHECK (
        btrim(source_product_version_snapshot) <> ''
        AND btrim(source_option_version_snapshot) <> ''
        AND btrim(external_sku_id_snapshot) <> ''
    ),
    CONSTRAINT sourcing_mappings_verification_ck CHECK (
        product_verification_snapshot IN ('MANUAL_UNVERIFIED', 'SERVER_VERIFIED')
        AND option_verification_snapshot IN ('MANUAL_UNVERIFIED', 'SERVER_VERIFIED')
    ),
    CONSTRAINT sourcing_mappings_rule_revision_ck CHECK (
        (mapping_rule_id IS NULL AND rule_revision_snapshot IS NULL)
        OR (mapping_rule_id IS NOT NULL AND rule_revision_snapshot > 0)
    ),
    CONSTRAINT sourcing_mappings_option_attributes_ck CHECK (
        jsonb_typeof(option_attributes_snapshot) = 'object'
    ),
    CONSTRAINT sourcing_mappings_price_ck CHECK (unit_price_cny_snapshot >= 0),
    CONSTRAINT sourcing_mappings_stock_status_ck CHECK (
        stock_status_snapshot IN ('AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'UNKNOWN')
    ),
    CONSTRAINT sourcing_mappings_stock_quantity_ck CHECK (
        stock_quantity_snapshot IS NULL OR stock_quantity_snapshot >= 0
    ),
    CONSTRAINT sourcing_mappings_quantity_ck CHECK (
        minimum_quantity_snapshot > 0 AND quantity_step_snapshot > 0 AND quantity_multiplier > 0
    ),
    CONSTRAINT sourcing_mappings_china_shipping_ck CHECK (
        china_shipping_status_snapshot IN ('CONFIRMED', 'ESTIMATED', 'UNKNOWN')
        AND (
            (china_shipping_status_snapshot = 'UNKNOWN' AND china_shipping_cny_snapshot IS NULL)
            OR (china_shipping_status_snapshot <> 'UNKNOWN' AND china_shipping_cny_snapshot IS NOT NULL AND china_shipping_cny_snapshot >= 0)
        )
    ),
    CONSTRAINT sourcing_mappings_status_ck CHECK (
        status IN ('ACTIVE', 'SUPERSEDED', 'REVOKED')
    ),
    CONSTRAINT sourcing_mappings_version_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX sourcing_mappings_active_item_uidx
    ON order_item_sourcing_mappings (tenant_id, order_item_id)
    WHERE status = 'ACTIVE' AND deleted_at IS NULL;

CREATE INDEX sourcing_mappings_reuse_idx
    ON order_item_sourcing_mappings (
        tenant_id, market_account_id, market_product_id, market_option_id, created_at DESC
    )
    WHERE status = 'ACTIVE' AND deleted_at IS NULL;

CREATE TABLE sourcing_purchase_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    mapping_id uuid NOT NULL,
    mapping_revision integer NOT NULL,
    order_item_version bigint NOT NULL,
    recipient_id uuid,
    source_product_id uuid NOT NULL,
    source_option_id uuid NOT NULL,
    source_verification_provenance text NOT NULL,
    external_sku_id_snapshot text NOT NULL,
    source_quantity integer NOT NULL,
    unit_price_cny numeric(18, 2) NOT NULL,
    product_subtotal_cny numeric(18, 2) NOT NULL,
    china_shipping_status text NOT NULL,
    china_shipping_cny numeric(18, 2),
    exchange_rate_krw_per_cny numeric(18, 6) NOT NULL,
    exchange_rate_source text NOT NULL,
    exchange_rate_observed_at timestamptz NOT NULL,
    product_amount_krw bigint NOT NULL,
    china_shipping_amount_krw bigint,
    agency_fee_krw bigint NOT NULL,
    international_shipping_status text NOT NULL,
    international_shipping_amount_krw bigint,
    customs_tax_status text NOT NULL,
    customs_tax_amount_krw bigint,
    other_fee_krw bigint NOT NULL,
    discount_krw bigint NOT NULL,
    discount_status text NOT NULL,
    known_cost_total_krw bigint NOT NULL,
    recipient_ready boolean NOT NULL,
    customs_code_format_status text NOT NULL,
    customs_identity_status text NOT NULL,
    customs_consent_at_snapshot timestamptz,
    customs_verified_at_snapshot timestamptz,
    forwarder_status text NOT NULL,
    blocking_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
    warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL,
    request_revision text NOT NULL,
    idempotency_key text NOT NULL,
    request_fingerprint char(64) NOT NULL,
    quote_expires_at timestamptz NOT NULL,
    user_note text,
    pre_payment_only boolean NOT NULL DEFAULT true,
    purchase_submission_status text NOT NULL DEFAULT 'NOT_SUBMITTED',
    payment_status text NOT NULL DEFAULT 'NOT_STARTED',
    created_by_membership_id uuid NOT NULL,
    correlation_id uuid NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT sourcing_drafts_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT sourcing_drafts_tenant_idempotency_key UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT sourcing_drafts_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_drafts_order_item_fk
        FOREIGN KEY (tenant_id, market_account_id, order_item_id)
        REFERENCES order_items (tenant_id, market_account_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_drafts_mapping_fk
        FOREIGN KEY (tenant_id, mapping_id)
        REFERENCES order_item_sourcing_mappings (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_drafts_recipient_fk
        FOREIGN KEY (tenant_id, recipient_id)
        REFERENCES order_recipients (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_drafts_source_product_fk
        FOREIGN KEY (tenant_id, source_product_id)
        REFERENCES sourcing_source_products (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_drafts_source_option_fk
        FOREIGN KEY (tenant_id, source_product_id, source_option_id)
        REFERENCES sourcing_source_options (tenant_id, source_product_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_drafts_membership_fk
        FOREIGN KEY (tenant_id, created_by_membership_id)
        REFERENCES memberships (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_drafts_versions_ck CHECK (mapping_revision > 0 AND order_item_version > 0),
    CONSTRAINT sourcing_drafts_source_verification_ck CHECK (
        source_verification_provenance IN ('MANUAL_UNVERIFIED', 'SERVER_VERIFIED')
    ),
    CONSTRAINT sourcing_drafts_quantity_ck CHECK (source_quantity > 0),
    CONSTRAINT sourcing_drafts_costs_ck CHECK (
        unit_price_cny >= 0 AND product_subtotal_cny >= 0
        AND exchange_rate_krw_per_cny > 0
        AND product_amount_krw >= 0
        AND agency_fee_krw >= 0 AND other_fee_krw >= 0
        AND discount_krw >= 0 AND known_cost_total_krw >= 0
        AND (china_shipping_amount_krw IS NULL OR china_shipping_amount_krw >= 0)
        AND (international_shipping_amount_krw IS NULL OR international_shipping_amount_krw >= 0)
        AND (customs_tax_amount_krw IS NULL OR customs_tax_amount_krw >= 0)
    ),
    CONSTRAINT sourcing_drafts_shipping_status_ck CHECK (
        china_shipping_status IN ('CONFIRMED', 'ESTIMATED', 'UNKNOWN')
        AND international_shipping_status IN ('ESTIMATED', 'PAY_LATER', 'UNKNOWN')
        AND customs_tax_status IN ('ESTIMATED', 'PAY_LATER', 'NOT_APPLICABLE', 'UNKNOWN')
    ),
    CONSTRAINT sourcing_drafts_discount_status_ck CHECK (
        discount_status IN ('CONFIRMED', 'ESTIMATED')
    ),
    CONSTRAINT sourcing_drafts_later_cost_amount_ck CHECK (
        (international_shipping_status = 'ESTIMATED' AND international_shipping_amount_krw IS NOT NULL)
        OR (international_shipping_status = 'PAY_LATER')
        OR (international_shipping_status = 'UNKNOWN' AND international_shipping_amount_krw IS NULL)
    ),
    CONSTRAINT sourcing_drafts_customs_cost_amount_ck CHECK (
        (customs_tax_status = 'ESTIMATED' AND customs_tax_amount_krw IS NOT NULL)
        OR (customs_tax_status = 'PAY_LATER')
        OR (customs_tax_status IN ('NOT_APPLICABLE', 'UNKNOWN') AND customs_tax_amount_krw IS NULL)
    ),
    CONSTRAINT sourcing_drafts_customs_status_ck CHECK (
        customs_code_format_status IN ('NOT_CHECKED', 'MISSING', 'FORMAT_VALID', 'INVALID')
        AND customs_identity_status IN ('NOT_CHECKED', 'MATCHED', 'MISMATCH', 'NOT_REQUIRED')
    ),
    CONSTRAINT sourcing_drafts_forwarder_status_ck CHECK (
        forwarder_status IN ('READY', 'NOT_CONFIGURED', 'ACTION_REQUIRED')
    ),
    CONSTRAINT sourcing_drafts_reasons_array_ck CHECK (
        jsonb_typeof(blocking_reasons) = 'array' AND jsonb_typeof(warnings) = 'array'
    ),
    CONSTRAINT sourcing_drafts_status_ck CHECK (
        status IN ('BLOCKED', 'READY_FOR_REVIEW', 'EXPIRED', 'SUPERSEDED')
    ),
    CONSTRAINT sourcing_drafts_request_revision_ck CHECK (btrim(request_revision) <> ''),
    CONSTRAINT sourcing_drafts_idempotency_ck CHECK (idempotency_key ~ '^sourcing-draft:v1:[0-9a-f]{64}$'),
    CONSTRAINT sourcing_drafts_request_fingerprint_ck CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT sourcing_drafts_hard_stop_ck CHECK (
        pre_payment_only
        AND purchase_submission_status = 'NOT_SUBMITTED'
        AND payment_status = 'NOT_STARTED'
    ),
    CONSTRAINT sourcing_drafts_version_ck CHECK (version > 0)
);

CREATE INDEX sourcing_drafts_item_idx
    ON sourcing_purchase_drafts (tenant_id, order_item_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE sourcing_purchase_draft_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    draft_id uuid NOT NULL,
    event_type text NOT NULL,
    actor_membership_id uuid NOT NULL,
    correlation_id uuid NOT NULL,
    snapshot jsonb NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT sourcing_draft_events_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT sourcing_draft_events_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_draft_events_draft_fk
        FOREIGN KEY (tenant_id, draft_id)
        REFERENCES sourcing_purchase_drafts (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_draft_events_membership_fk
        FOREIGN KEY (tenant_id, actor_membership_id)
        REFERENCES memberships (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sourcing_draft_events_type_ck CHECK (
        event_type IN ('DRAFT_PREPARED', 'DRAFT_BLOCKED', 'DRAFT_SUPERSEDED')
    ),
    CONSTRAINT sourcing_draft_events_snapshot_ck CHECK (jsonb_typeof(snapshot) = 'object')
);

CREATE INDEX sourcing_draft_events_draft_idx
    ON sourcing_purchase_draft_events (tenant_id, draft_id, occurred_at, id);

-- Only the trusted worker/connector role may attest source data or approved
-- reusable mappings. The browser-facing app role may write manual snapshots,
-- but it cannot promote them or mutate an already verified catalog row.
CREATE FUNCTION current_user_is_trusted_sourcing_worker()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
    SELECT COALESCE((
        SELECT role.rolbypassrls
               AND NOT role.rolsuper
               AND NOT pg_has_role(current_user, relation.relowner, 'MEMBER')
          FROM pg_catalog.pg_roles role
          JOIN pg_catalog.pg_class relation
            ON relation.relname = 'sales_orders'
          JOIN pg_catalog.pg_namespace namespace
            ON namespace.oid = relation.relnamespace
           AND namespace.nspname = 'public'
         WHERE role.rolname = current_user
    ), false)
$$;

CREATE FUNCTION guard_server_verified_source_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT public.current_user_is_trusted_sourcing_worker()
       AND (
           NEW.verification_provenance = 'SERVER_VERIFIED'
           OR (
               TG_OP = 'UPDATE'
               AND OLD.verification_provenance = 'SERVER_VERIFIED'
           )
       ) THEN
        RAISE EXCEPTION 'SERVER_VERIFIED sourcing data requires the trusted worker role'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION guard_trusted_sourcing_rule_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT public.current_user_is_trusted_sourcing_worker()
       AND (
           NEW.verification_provenance = 'SERVER_VERIFIED'
           OR NEW.approval_status = 'APPROVED'
           OR (
               TG_OP = 'UPDATE'
               AND (
                   OLD.verification_provenance = 'SERVER_VERIFIED'
                   OR OLD.approval_status = 'APPROVED'
               )
           )
       ) THEN
        RAISE EXCEPTION 'Verified or approved sourcing rules require the trusted worker role'
            USING ERRCODE = '42501';
    END IF;
    IF NEW.approval_status = 'APPROVED'
       AND NEW.verification_provenance <> 'SERVER_VERIFIED' THEN
        RAISE EXCEPTION 'Only SERVER_VERIFIED sourcing rules may be approved'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER sourcing_products_guard_verification
    BEFORE INSERT OR UPDATE ON sourcing_source_products
    FOR EACH ROW EXECUTE FUNCTION guard_server_verified_source_write();
CREATE TRIGGER sourcing_options_guard_verification
    BEFORE INSERT OR UPDATE ON sourcing_source_options
    FOR EACH ROW EXECUTE FUNCTION guard_server_verified_source_write();
CREATE TRIGGER sourcing_rules_guard_trusted_write
    BEFORE INSERT OR UPDATE ON sourcing_mapping_rules
    FOR EACH ROW EXECUTE FUNCTION guard_trusted_sourcing_rule_write();

CREATE TRIGGER sourcing_products_touch_version
    BEFORE UPDATE ON sourcing_source_products
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER sourcing_options_touch_version
    BEFORE UPDATE ON sourcing_source_options
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER sourcing_rules_touch_version
    BEFORE UPDATE ON sourcing_mapping_rules
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER sourcing_mappings_touch_version
    BEFORE UPDATE ON order_item_sourcing_mappings
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER sourcing_drafts_touch_version
    BEFORE UPDATE ON sourcing_purchase_drafts
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();

ALTER TABLE sourcing_source_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY sourcing_products_tenant_isolation ON sourcing_source_products
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());
ALTER TABLE sourcing_source_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY sourcing_options_tenant_isolation ON sourcing_source_options
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());
ALTER TABLE order_item_sourcing_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY sourcing_mappings_tenant_isolation ON order_item_sourcing_mappings
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());
ALTER TABLE sourcing_mapping_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY sourcing_rules_tenant_isolation ON sourcing_mapping_rules
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());
ALTER TABLE sourcing_purchase_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY sourcing_drafts_tenant_isolation ON sourcing_purchase_drafts
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());
ALTER TABLE sourcing_purchase_draft_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY sourcing_draft_events_tenant_isolation ON sourcing_purchase_draft_events
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

DO $$
DECLARE
    runtime_role text;
BEGIN
    FOREACH runtime_role IN ARRAY ARRAY['jumunpangpang_app', 'jumunpangpang_worker']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
            EXECUTE format(
                'GRANT SELECT, INSERT, UPDATE ON sourcing_source_products, sourcing_source_options, sourcing_mapping_rules, order_item_sourcing_mappings, sourcing_purchase_drafts TO %I',
                runtime_role
            );
            EXECUTE format(
                'GRANT SELECT, INSERT ON sourcing_purchase_draft_events TO %I',
                runtime_role
            );
            EXECUTE format(
                'REVOKE UPDATE, DELETE ON sourcing_purchase_draft_events FROM %I',
                runtime_role
            );
        END IF;
    END LOOP;
END;
$$;
