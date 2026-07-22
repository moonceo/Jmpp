-- Jumunpangpang production foundation.
-- PostgreSQL 16+ is required. All application-owned mutable rows use
-- optimistic versions and database-managed updated_at values.

CREATE TABLE tenants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    timezone text NOT NULL DEFAULT 'Asia/Seoul',
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT tenants_slug_length_ck CHECK (char_length(slug) BETWEEN 1 AND 63),
    CONSTRAINT tenants_slug_format_ck CHECK (
        slug = lower(slug)
        AND slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
    ),
    CONSTRAINT tenants_name_not_blank_ck CHECK (btrim(name) <> ''),
    CONSTRAINT tenants_status_ck CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
    CONSTRAINT tenants_settings_object_ck CHECK (jsonb_typeof(settings) = 'object'),
    CONSTRAINT tenants_version_positive_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX tenants_active_slug_uidx
    ON tenants (lower(slug))
    WHERE deleted_at IS NULL;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_subject text NOT NULL,
    email text NOT NULL,
    display_name text,
    status text NOT NULL DEFAULT 'ACTIVE',
    last_login_at timestamptz,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT users_auth_subject_not_blank_ck CHECK (btrim(auth_subject) <> ''),
    CONSTRAINT users_email_not_blank_ck CHECK (btrim(email) <> ''),
    CONSTRAINT users_status_ck CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED')),
    CONSTRAINT users_version_positive_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX users_active_auth_subject_uidx
    ON users (auth_subject)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX users_active_email_uidx
    ON users (lower(email))
    WHERE deleted_at IS NULL;

CREATE TABLE memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    invited_by_user_id uuid,
    joined_at timestamptz,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT memberships_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT memberships_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT memberships_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT memberships_invited_by_user_fk
        FOREIGN KEY (invited_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT memberships_role_ck CHECK (role IN ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER')),
    CONSTRAINT memberships_status_ck CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
    CONSTRAINT memberships_version_positive_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX memberships_active_tenant_user_uidx
    ON memberships (tenant_id, user_id)
    WHERE deleted_at IS NULL;

CREATE INDEX memberships_active_user_idx
    ON memberships (user_id, tenant_id)
    WHERE deleted_at IS NULL AND status = 'ACTIVE';

CREATE TABLE market_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_code text NOT NULL,
    store_name text NOT NULL,
    seller_id text NOT NULL,
    external_account_id text,
    auth_status text NOT NULL DEFAULT 'PENDING',
    is_active boolean NOT NULL DEFAULT true,
    capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    credential_expires_at timestamptz,
    last_auth_verified_at timestamptz,
    last_successful_sync_at timestamptz,
    last_error_code text,
    last_error_message text,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT market_accounts_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT market_accounts_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT market_accounts_market_code_not_blank_ck CHECK (btrim(market_code) <> ''),
    CONSTRAINT market_accounts_store_name_not_blank_ck CHECK (btrim(store_name) <> ''),
    CONSTRAINT market_accounts_seller_id_not_blank_ck CHECK (btrim(seller_id) <> ''),
    CONSTRAINT market_accounts_auth_status_ck CHECK (
        auth_status IN ('PENDING', 'CONNECTED', 'EXPIRED', 'REAUTH_REQUIRED', 'ERROR', 'DISCONNECTED')
    ),
    CONSTRAINT market_accounts_capabilities_object_ck CHECK (jsonb_typeof(capabilities) = 'object'),
    CONSTRAINT market_accounts_settings_object_ck CHECK (jsonb_typeof(settings) = 'object'),
    CONSTRAINT market_accounts_version_positive_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX market_accounts_active_seller_uidx
    ON market_accounts (tenant_id, lower(market_code), lower(seller_id))
    WHERE deleted_at IS NULL AND is_active;

CREATE UNIQUE INDEX market_accounts_active_store_name_uidx
    ON market_accounts (tenant_id, lower(store_name))
    WHERE deleted_at IS NULL AND is_active;

CREATE INDEX market_accounts_syncable_idx
    ON market_accounts (tenant_id, market_code, last_successful_sync_at)
    WHERE deleted_at IS NULL AND is_active AND auth_status = 'CONNECTED';

CREATE TABLE integration_secrets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    secret_type text NOT NULL,
    encrypted_payload text NOT NULL,
    encryption_key_version integer NOT NULL DEFAULT 1,
    fingerprint_sha256 char(64),
    expires_at timestamptz,
    last_used_at timestamptz,
    rotated_from_id uuid,
    revoked_at timestamptz,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT integration_secrets_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT integration_secrets_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT integration_secrets_market_account_fk
        FOREIGN KEY (tenant_id, market_account_id)
        REFERENCES market_accounts (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT integration_secrets_rotated_from_fk
        FOREIGN KEY (tenant_id, rotated_from_id)
        REFERENCES integration_secrets (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT integration_secrets_type_not_blank_ck CHECK (btrim(secret_type) <> ''),
    CONSTRAINT integration_secrets_payload_not_blank_ck CHECK (btrim(encrypted_payload) <> ''),
    CONSTRAINT integration_secrets_key_version_positive_ck CHECK (encryption_key_version > 0),
    CONSTRAINT integration_secrets_fingerprint_ck CHECK (
        fingerprint_sha256 IS NULL OR fingerprint_sha256 ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT integration_secrets_version_positive_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX integration_secrets_active_type_uidx
    ON integration_secrets (tenant_id, market_account_id, lower(secret_type))
    WHERE deleted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX integration_secrets_expiry_idx
    ON integration_secrets (expires_at)
    WHERE deleted_at IS NULL AND revoked_at IS NULL AND expires_at IS NOT NULL;

CREATE TABLE sales_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    external_order_id text NOT NULL,
    external_order_number text,
    normalized_status text NOT NULL DEFAULT 'NEW',
    market_status_raw text NOT NULL,
    currency_code char(3) NOT NULL DEFAULT 'KRW',
    gross_amount numeric(18, 2) NOT NULL DEFAULT 0,
    paid_amount numeric(18, 2) NOT NULL DEFAULT 0,
    buyer_name_masked text,
    buyer_snapshot_encrypted text,
    ordered_at timestamptz NOT NULL,
    paid_at timestamptz,
    source_created_at timestamptz,
    source_updated_at timestamptz,
    market_status_updated_at timestamptz,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT sales_orders_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT sales_orders_tenant_account_id_key UNIQUE (tenant_id, market_account_id, id),
    CONSTRAINT sales_orders_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT sales_orders_market_account_fk
        FOREIGN KEY (tenant_id, market_account_id)
        REFERENCES market_accounts (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sales_orders_external_id_not_blank_ck CHECK (btrim(external_order_id) <> ''),
    CONSTRAINT sales_orders_normalized_status_ck CHECK (
        normalized_status IN (
            'NEW', 'PREPARING', 'READY_TO_SHIP', 'SHIPPING', 'DELIVERED',
            'CANCELED', 'ON_HOLD'
        )
    ),
    CONSTRAINT sales_orders_market_status_not_blank_ck CHECK (btrim(market_status_raw) <> ''),
    CONSTRAINT sales_orders_currency_code_ck CHECK (currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT sales_orders_gross_amount_nonnegative_ck CHECK (gross_amount >= 0),
    CONSTRAINT sales_orders_paid_amount_nonnegative_ck CHECK (paid_amount >= 0),
    CONSTRAINT sales_orders_attributes_object_ck CHECK (jsonb_typeof(attributes) = 'object'),
    CONSTRAINT sales_orders_version_positive_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX sales_orders_external_order_uidx
    ON sales_orders (tenant_id, market_account_id, external_order_id)
    WHERE deleted_at IS NULL;

CREATE INDEX sales_orders_tenant_ordered_idx
    ON sales_orders (tenant_id, ordered_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX sales_orders_tenant_status_ordered_idx
    ON sales_orders (tenant_id, normalized_status, ordered_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX sales_orders_source_updated_idx
    ON sales_orders (tenant_id, market_account_id, source_updated_at, id)
    WHERE deleted_at IS NULL;

CREATE TABLE order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    sales_order_id uuid NOT NULL,
    external_order_item_id text,
    source_line_key text NOT NULL,
    market_product_id text,
    market_option_id text,
    seller_sku text,
    product_name text NOT NULL,
    option_name text,
    product_url text,
    thumbnail_url text,
    quantity integer NOT NULL,
    unit_price numeric(18, 2) NOT NULL DEFAULT 0,
    item_total numeric(18, 2) NOT NULL DEFAULT 0,
    internal_work_status text NOT NULL DEFAULT 'NEW',
    market_status_raw text NOT NULL,
    market_fulfillment_status text,
    sourcing_status text NOT NULL DEFAULT 'UNMATCHED',
    market_delivery_method text,
    domestic_carrier_code text,
    domestic_tracking_number text,
    confirmed_at timestamptz,
    market_invoice_submitted_at timestamptz,
    market_purchase_confirmed_at timestamptz,
    source_updated_at timestamptz,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT order_items_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT order_items_tenant_account_id_key UNIQUE (tenant_id, market_account_id, id),
    CONSTRAINT order_items_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT order_items_sales_order_fk
        FOREIGN KEY (tenant_id, market_account_id, sales_order_id)
        REFERENCES sales_orders (tenant_id, market_account_id, id) ON DELETE RESTRICT,
    CONSTRAINT order_items_source_line_key_not_blank_ck CHECK (btrim(source_line_key) <> ''),
    CONSTRAINT order_items_external_item_id_ck CHECK (
        external_order_item_id IS NULL OR btrim(external_order_item_id) <> ''
    ),
    CONSTRAINT order_items_product_name_not_blank_ck CHECK (btrim(product_name) <> ''),
    CONSTRAINT order_items_quantity_positive_ck CHECK (quantity > 0),
    CONSTRAINT order_items_unit_price_nonnegative_ck CHECK (unit_price >= 0),
    CONSTRAINT order_items_total_nonnegative_ck CHECK (item_total >= 0),
    CONSTRAINT order_items_internal_work_status_ck CHECK (
        internal_work_status IN (
            'NEW', 'PREPARING', 'READY_TO_SHIP', 'SHIPPING', 'DELIVERED',
            'CANCELED', 'ON_HOLD'
        )
    ),
    CONSTRAINT order_items_sourcing_status_ck CHECK (
        sourcing_status IN (
            'UNMATCHED', 'MATCHED', 'PAYMENT_READY', 'PAID', 'INVOICE_RECEIVED',
            'EXTERNAL_PURCHASE', 'HOLD'
        )
    ),
    CONSTRAINT order_items_delivery_method_ck CHECK (
        market_delivery_method IS NULL OR market_delivery_method IN ('DELIVERY', 'DIRECT_DELIVERY')
    ),
    CONSTRAINT order_items_tracking_pair_ck CHECK (
        (domestic_carrier_code IS NULL AND domestic_tracking_number IS NULL)
        OR (
            domestic_carrier_code IS NOT NULL
            AND domestic_tracking_number IS NOT NULL
            AND btrim(domestic_carrier_code) <> ''
            AND btrim(domestic_tracking_number) <> ''
        )
    ),
    CONSTRAINT order_items_attributes_object_ck CHECK (jsonb_typeof(attributes) = 'object'),
    CONSTRAINT order_items_version_positive_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX order_items_external_item_uidx
    ON order_items (tenant_id, market_account_id, external_order_item_id)
    WHERE deleted_at IS NULL AND external_order_item_id IS NOT NULL;

CREATE UNIQUE INDEX order_items_source_line_uidx
    ON order_items (tenant_id, market_account_id, source_line_key)
    WHERE deleted_at IS NULL;

CREATE INDEX order_items_order_idx
    ON order_items (tenant_id, sales_order_id, created_at, id)
    WHERE deleted_at IS NULL;

CREATE INDEX order_items_work_queue_idx
    ON order_items (tenant_id, internal_work_status, updated_at, id)
    WHERE deleted_at IS NULL
      AND internal_work_status IN ('NEW', 'PREPARING', 'READY_TO_SHIP', 'ON_HOLD');

CREATE TABLE order_recipients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    sales_order_id uuid NOT NULL,
    recipient_name_masked text NOT NULL,
    recipient_name_encrypted text NOT NULL,
    phone_encrypted text,
    postal_code_encrypted text,
    address_line1_encrypted text NOT NULL,
    address_line2_encrypted text,
    personal_customs_code_encrypted text,
    delivery_message_encrypted text,
    phone_blind_index char(64),
    customs_code_blind_index char(64),
    fingerprint_sha256 char(64) NOT NULL,
    encryption_key_version integer NOT NULL DEFAULT 1,
    is_current boolean NOT NULL DEFAULT true,
    updated_by_membership_id uuid,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT order_recipients_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT order_recipients_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT order_recipients_sales_order_fk
        FOREIGN KEY (tenant_id, sales_order_id)
        REFERENCES sales_orders (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT order_recipients_updated_by_membership_fk
        FOREIGN KEY (tenant_id, updated_by_membership_id)
        REFERENCES memberships (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT order_recipients_name_masked_not_blank_ck CHECK (btrim(recipient_name_masked) <> ''),
    CONSTRAINT order_recipients_name_encrypted_not_blank_ck CHECK (btrim(recipient_name_encrypted) <> ''),
    CONSTRAINT order_recipients_address_encrypted_not_blank_ck CHECK (btrim(address_line1_encrypted) <> ''),
    CONSTRAINT order_recipients_phone_blind_index_ck CHECK (
        phone_blind_index IS NULL OR phone_blind_index ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT order_recipients_customs_blind_index_ck CHECK (
        customs_code_blind_index IS NULL OR customs_code_blind_index ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT order_recipients_fingerprint_ck CHECK (fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT order_recipients_key_version_positive_ck CHECK (encryption_key_version > 0),
    CONSTRAINT order_recipients_version_positive_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX order_recipients_current_order_uidx
    ON order_recipients (tenant_id, sales_order_id)
    WHERE deleted_at IS NULL AND is_current;

CREATE INDEX order_recipients_phone_lookup_idx
    ON order_recipients (tenant_id, phone_blind_index)
    WHERE deleted_at IS NULL AND is_current AND phone_blind_index IS NOT NULL;

CREATE TABLE sync_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    stream text NOT NULL,
    trigger_type text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
    requested_by_membership_id uuid,
    cursor_before jsonb,
    cursor_after jsonb,
    window_start timestamptz,
    window_end timestamptz,
    scheduled_for timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at timestamptz,
    completed_at timestamptz,
    records_seen integer NOT NULL DEFAULT 0,
    records_inserted integer NOT NULL DEFAULT 0,
    records_updated integer NOT NULL DEFAULT 0,
    records_skipped integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 8,
    next_attempt_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_owner text,
    lease_until timestamptz,
    error_code text,
    error_message text,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT sync_runs_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT sync_runs_tenant_account_id_key UNIQUE (tenant_id, market_account_id, id),
    CONSTRAINT sync_runs_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT sync_runs_market_account_fk
        FOREIGN KEY (tenant_id, market_account_id)
        REFERENCES market_accounts (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sync_runs_requested_by_membership_fk
        FOREIGN KEY (tenant_id, requested_by_membership_id)
        REFERENCES memberships (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sync_runs_stream_not_blank_ck CHECK (btrim(stream) <> ''),
    CONSTRAINT sync_runs_trigger_type_ck CHECK (trigger_type IN ('SCHEDULED', 'MANUAL', 'RECONCILIATION', 'RECOVERY')),
    CONSTRAINT sync_runs_status_ck CHECK (
        status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'RETRY', 'FAILED', 'CANCELED', 'DEAD')
    ),
    CONSTRAINT sync_runs_window_ck CHECK (
        window_start IS NULL OR window_end IS NULL OR window_end >= window_start
    ),
    CONSTRAINT sync_runs_counts_nonnegative_ck CHECK (
        records_seen >= 0 AND records_inserted >= 0 AND records_updated >= 0
        AND records_skipped >= 0 AND error_count >= 0
    ),
    CONSTRAINT sync_runs_attempts_ck CHECK (attempt_count >= 0 AND max_attempts > 0),
    CONSTRAINT sync_runs_lease_pair_ck CHECK (
        (lease_owner IS NULL AND lease_until IS NULL)
        OR (
            lease_owner IS NOT NULL
            AND lease_until IS NOT NULL
            AND btrim(lease_owner) <> ''
        )
    ),
    CONSTRAINT sync_runs_completion_ck CHECK (
        completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at
    ),
    CONSTRAINT sync_runs_version_positive_ck CHECK (version > 0)
);

CREATE INDEX sync_runs_dispatch_idx
    ON sync_runs (next_attempt_at, scheduled_for, id)
    WHERE deleted_at IS NULL AND status IN ('PENDING', 'RETRY');

CREATE UNIQUE INDEX sync_runs_one_active_stream_uidx
    ON sync_runs (tenant_id, market_account_id, stream)
    WHERE deleted_at IS NULL AND status IN ('PENDING', 'RUNNING', 'RETRY');

CREATE INDEX sync_runs_expired_lease_idx
    ON sync_runs (lease_until, id)
    WHERE deleted_at IS NULL AND status = 'RUNNING' AND lease_until IS NOT NULL;

CREATE INDEX sync_runs_account_history_idx
    ON sync_runs (tenant_id, market_account_id, stream, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX sync_runs_tenant_history_idx
    ON sync_runs (tenant_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX sync_runs_correlation_idx
    ON sync_runs (tenant_id, correlation_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE raw_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    sync_run_id uuid,
    direction text NOT NULL DEFAULT 'INBOUND',
    stream text NOT NULL,
    resource_type text NOT NULL,
    external_resource_id text,
    payload_encrypted text NOT NULL,
    payload_sha256 char(64) NOT NULL,
    content_type text NOT NULL DEFAULT 'application/json',
    schema_version integer NOT NULL DEFAULT 1,
    source_event_at timestamptz,
    received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT raw_snapshots_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT raw_snapshots_tenant_account_id_key UNIQUE (tenant_id, market_account_id, id),
    CONSTRAINT raw_snapshots_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT raw_snapshots_market_account_fk
        FOREIGN KEY (tenant_id, market_account_id)
        REFERENCES market_accounts (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT raw_snapshots_sync_run_fk
        FOREIGN KEY (tenant_id, market_account_id, sync_run_id)
        REFERENCES sync_runs (tenant_id, market_account_id, id) ON DELETE RESTRICT,
    CONSTRAINT raw_snapshots_direction_ck CHECK (direction IN ('INBOUND', 'OUTBOUND')),
    CONSTRAINT raw_snapshots_stream_not_blank_ck CHECK (btrim(stream) <> ''),
    CONSTRAINT raw_snapshots_resource_type_not_blank_ck CHECK (btrim(resource_type) <> ''),
    CONSTRAINT raw_snapshots_payload_not_blank_ck CHECK (btrim(payload_encrypted) <> ''),
    CONSTRAINT raw_snapshots_payload_hash_ck CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT raw_snapshots_schema_version_positive_ck CHECK (schema_version > 0),
    CONSTRAINT raw_snapshots_expiry_ck CHECK (expires_at IS NULL OR expires_at > received_at),
    CONSTRAINT raw_snapshots_version_positive_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX raw_snapshots_inbound_dedupe_uidx
    ON raw_snapshots (
        tenant_id,
        market_account_id,
        stream,
        resource_type,
        COALESCE(external_resource_id, ''),
        payload_sha256
    )
    WHERE deleted_at IS NULL AND direction = 'INBOUND';

CREATE INDEX raw_snapshots_resource_idx
    ON raw_snapshots (tenant_id, market_account_id, resource_type, external_resource_id, received_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX raw_snapshots_expiry_idx
    ON raw_snapshots (expires_at)
    WHERE deleted_at IS NULL AND expires_at IS NOT NULL;

CREATE TABLE integration_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    sync_run_id uuid,
    raw_snapshot_id uuid NOT NULL,
    event_type text NOT NULL,
    external_event_id text,
    dedupe_key text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_external_id text NOT NULL,
    normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'PENDING',
    occurred_at timestamptz,
    received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    error_code text,
    error_message text,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT integration_events_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT integration_events_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT integration_events_market_account_fk
        FOREIGN KEY (tenant_id, market_account_id)
        REFERENCES market_accounts (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT integration_events_sync_run_fk
        FOREIGN KEY (tenant_id, market_account_id, sync_run_id)
        REFERENCES sync_runs (tenant_id, market_account_id, id) ON DELETE RESTRICT,
    CONSTRAINT integration_events_raw_snapshot_fk
        FOREIGN KEY (tenant_id, market_account_id, raw_snapshot_id)
        REFERENCES raw_snapshots (tenant_id, market_account_id, id) ON DELETE RESTRICT,
    CONSTRAINT integration_events_event_type_not_blank_ck CHECK (btrim(event_type) <> ''),
    CONSTRAINT integration_events_dedupe_key_not_blank_ck CHECK (btrim(dedupe_key) <> ''),
    CONSTRAINT integration_events_aggregate_type_not_blank_ck CHECK (btrim(aggregate_type) <> ''),
    CONSTRAINT integration_events_aggregate_id_not_blank_ck CHECK (btrim(aggregate_external_id) <> ''),
    CONSTRAINT integration_events_payload_object_ck CHECK (jsonb_typeof(normalized_payload) = 'object'),
    CONSTRAINT integration_events_status_ck CHECK (
        status IN ('PENDING', 'PROCESSING', 'APPLIED', 'IGNORED', 'RETRY', 'FAILED', 'DEAD')
    ),
    CONSTRAINT integration_events_attempt_count_ck CHECK (attempt_count >= 0),
    CONSTRAINT integration_events_version_positive_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX integration_events_dedupe_uidx
    ON integration_events (tenant_id, market_account_id, dedupe_key)
    WHERE deleted_at IS NULL;

CREATE INDEX integration_events_dispatch_idx
    ON integration_events (next_attempt_at, received_at, id)
    WHERE deleted_at IS NULL AND status IN ('PENDING', 'RETRY');

CREATE INDEX integration_events_aggregate_idx
    ON integration_events (
        tenant_id, market_account_id, aggregate_type, aggregate_external_id, occurred_at DESC
    )
    WHERE deleted_at IS NULL;

CREATE TABLE sync_cursors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    stream text NOT NULL,
    cursor_value jsonb NOT NULL DEFAULT '{}'::jsonb,
    watermark_at timestamptz,
    overlap_seconds integer NOT NULL DEFAULT 300,
    last_sync_run_id uuid,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT sync_cursors_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT sync_cursors_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT sync_cursors_market_account_fk
        FOREIGN KEY (tenant_id, market_account_id)
        REFERENCES market_accounts (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT sync_cursors_last_sync_run_fk
        FOREIGN KEY (tenant_id, market_account_id, last_sync_run_id)
        REFERENCES sync_runs (tenant_id, market_account_id, id) ON DELETE RESTRICT,
    CONSTRAINT sync_cursors_stream_not_blank_ck CHECK (btrim(stream) <> ''),
    CONSTRAINT sync_cursors_cursor_object_ck CHECK (jsonb_typeof(cursor_value) = 'object'),
    CONSTRAINT sync_cursors_overlap_seconds_ck CHECK (overlap_seconds BETWEEN 0 AND 86400),
    CONSTRAINT sync_cursors_version_positive_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX sync_cursors_active_stream_uidx
    ON sync_cursors (tenant_id, market_account_id, stream)
    WHERE deleted_at IS NULL;

CREATE TABLE outbound_commands (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    order_item_id uuid,
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    command_type text NOT NULL,
    idempotency_key text NOT NULL,
    expected_version bigint,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'PENDING',
    correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
    requested_by_membership_id uuid,
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 8,
    next_attempt_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_owner text,
    lease_until timestamptz,
    lease_purpose text,
    result jsonb,
    last_error_code text,
    last_error_message text,
    succeeded_at timestamptz,
    failed_at timestamptz,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT outbound_commands_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT outbound_commands_tenant_account_id_key UNIQUE (tenant_id, market_account_id, id),
    CONSTRAINT outbound_commands_tenant_idempotency_key UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT outbound_commands_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT outbound_commands_market_account_fk
        FOREIGN KEY (tenant_id, market_account_id)
        REFERENCES market_accounts (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT outbound_commands_order_item_fk
        FOREIGN KEY (tenant_id, market_account_id, order_item_id)
        REFERENCES order_items (tenant_id, market_account_id, id) ON DELETE RESTRICT,
    CONSTRAINT outbound_commands_requested_by_membership_fk
        FOREIGN KEY (tenant_id, requested_by_membership_id)
        REFERENCES memberships (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT outbound_commands_aggregate_type_not_blank_ck CHECK (btrim(aggregate_type) <> ''),
    CONSTRAINT outbound_commands_aggregate_id_not_blank_ck CHECK (btrim(aggregate_id) <> ''),
    CONSTRAINT outbound_commands_type_not_blank_ck CHECK (btrim(command_type) <> ''),
    CONSTRAINT outbound_commands_idempotency_not_blank_ck CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT outbound_commands_expected_version_ck CHECK (expected_version IS NULL OR expected_version > 0),
    CONSTRAINT outbound_commands_payload_object_ck CHECK (jsonb_typeof(payload) = 'object'),
    CONSTRAINT outbound_commands_result_object_ck CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
    CONSTRAINT outbound_commands_status_ck CHECK (
        status IN ('PENDING', 'LEASED', 'SUCCEEDED', 'RETRY', 'UNKNOWN', 'FAILED', 'DEAD', 'CANCELED')
    ),
    CONSTRAINT outbound_commands_attempts_ck CHECK (attempt_count >= 0 AND max_attempts > 0),
    CONSTRAINT outbound_commands_lease_pair_ck CHECK (
        (lease_owner IS NULL AND lease_until IS NULL AND lease_purpose IS NULL)
        OR (
            lease_owner IS NOT NULL
            AND lease_until IS NOT NULL
            AND lease_purpose IN ('EXECUTE', 'RECONCILE')
            AND btrim(lease_owner) <> ''
        )
    ),
    CONSTRAINT outbound_commands_terminal_time_ck CHECK (
        NOT (succeeded_at IS NOT NULL AND failed_at IS NOT NULL)
    ),
    CONSTRAINT outbound_commands_version_positive_ck CHECK (version > 0)
);

CREATE INDEX outbound_commands_dispatch_idx
    ON outbound_commands (next_attempt_at, created_at, id)
    WHERE deleted_at IS NULL AND status IN ('PENDING', 'RETRY');

CREATE INDEX outbound_commands_unknown_idx
    ON outbound_commands (next_attempt_at, updated_at, id)
    WHERE deleted_at IS NULL AND status = 'UNKNOWN';

CREATE INDEX outbound_commands_expired_lease_idx
    ON outbound_commands (lease_until, id)
    WHERE deleted_at IS NULL AND status = 'LEASED' AND lease_until IS NOT NULL;

CREATE INDEX outbound_commands_order_item_idx
    ON outbound_commands (tenant_id, order_item_id, created_at DESC)
    WHERE deleted_at IS NULL AND order_item_id IS NOT NULL;

CREATE INDEX outbound_commands_correlation_idx
    ON outbound_commands (tenant_id, correlation_id, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE outbound_attempts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    outbound_command_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    request_sha256 char(64) NOT NULL,
    request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    response_summary jsonb,
    http_status integer,
    provider_code text,
    provider_message text,
    outcome text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at timestamptz,
    duration_ms integer,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT outbound_attempts_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT outbound_attempts_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT outbound_attempts_command_fk
        FOREIGN KEY (tenant_id, market_account_id, outbound_command_id)
        REFERENCES outbound_commands (tenant_id, market_account_id, id) ON DELETE RESTRICT,
    CONSTRAINT outbound_attempts_attempt_number_positive_ck CHECK (attempt_number > 0),
    CONSTRAINT outbound_attempts_request_hash_ck CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT outbound_attempts_request_summary_object_ck CHECK (jsonb_typeof(request_summary) = 'object'),
    CONSTRAINT outbound_attempts_response_summary_object_ck CHECK (
        response_summary IS NULL OR jsonb_typeof(response_summary) = 'object'
    ),
    CONSTRAINT outbound_attempts_http_status_ck CHECK (
        http_status IS NULL OR http_status BETWEEN 100 AND 599
    ),
    CONSTRAINT outbound_attempts_outcome_ck CHECK (
        outcome IN ('IN_PROGRESS', 'SUCCESS', 'RETRYABLE', 'PERMANENT', 'UNKNOWN')
    ),
    CONSTRAINT outbound_attempts_time_ck CHECK (
        completed_at IS NULL OR completed_at >= started_at
    ),
    CONSTRAINT outbound_attempts_duration_ck CHECK (duration_ms IS NULL OR duration_ms >= 0),
    CONSTRAINT outbound_attempts_version_positive_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX outbound_attempts_command_number_uidx
    ON outbound_attempts (tenant_id, outbound_command_id, attempt_number)
    WHERE deleted_at IS NULL;

CREATE INDEX outbound_attempts_command_history_idx
    ON outbound_attempts (tenant_id, outbound_command_id, started_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid,
    actor_type text NOT NULL,
    actor_membership_id uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    correlation_id uuid,
    request_id text,
    source_ip inet,
    user_agent text,
    before_snapshot jsonb,
    after_snapshot jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT audit_logs_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT audit_logs_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT audit_logs_market_account_fk
        FOREIGN KEY (tenant_id, market_account_id)
        REFERENCES market_accounts (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT audit_logs_actor_membership_fk
        FOREIGN KEY (tenant_id, actor_membership_id)
        REFERENCES memberships (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT audit_logs_actor_type_ck CHECK (actor_type IN ('USER', 'SYSTEM', 'WORKER')),
    CONSTRAINT audit_logs_action_not_blank_ck CHECK (btrim(action) <> ''),
    CONSTRAINT audit_logs_entity_type_not_blank_ck CHECK (btrim(entity_type) <> ''),
    CONSTRAINT audit_logs_entity_id_not_blank_ck CHECK (btrim(entity_id) <> ''),
    CONSTRAINT audit_logs_before_snapshot_object_ck CHECK (
        before_snapshot IS NULL OR jsonb_typeof(before_snapshot) = 'object'
    ),
    CONSTRAINT audit_logs_after_snapshot_object_ck CHECK (
        after_snapshot IS NULL OR jsonb_typeof(after_snapshot) = 'object'
    ),
    CONSTRAINT audit_logs_metadata_object_ck CHECK (jsonb_typeof(metadata) = 'object'),
    CONSTRAINT audit_logs_version_positive_ck CHECK (version > 0)
);

CREATE INDEX audit_logs_entity_history_idx
    ON audit_logs (tenant_id, entity_type, entity_id, occurred_at DESC, id);

CREATE INDEX audit_logs_correlation_idx
    ON audit_logs (tenant_id, correlation_id, occurred_at)
    WHERE correlation_id IS NOT NULL;

-- The application updates mutable rows using version predicates. This trigger
-- guarantees monotonic versions and a server-side timestamp even for workers.
CREATE FUNCTION touch_versioned_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_touch_version
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER users_touch_version
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER memberships_touch_version
    BEFORE UPDATE ON memberships
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER market_accounts_touch_version
    BEFORE UPDATE ON market_accounts
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER integration_secrets_touch_version
    BEFORE UPDATE ON integration_secrets
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER sales_orders_touch_version
    BEFORE UPDATE ON sales_orders
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER order_items_touch_version
    BEFORE UPDATE ON order_items
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER order_recipients_touch_version
    BEFORE UPDATE ON order_recipients
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER sync_runs_touch_version
    BEFORE UPDATE ON sync_runs
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER raw_snapshots_touch_version
    BEFORE UPDATE ON raw_snapshots
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER integration_events_touch_version
    BEFORE UPDATE ON integration_events
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER sync_cursors_touch_version
    BEFORE UPDATE ON sync_cursors
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER outbound_commands_touch_version
    BEFORE UPDATE ON outbound_commands
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER outbound_attempts_touch_version
    BEFORE UPDATE ON outbound_attempts
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();
CREATE TRIGGER audit_logs_touch_version
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();

-- Tenant context is transaction-local and is set by withTenantTransaction().
-- Composite foreign keys above prevent cross-tenant references; these policies
-- additionally prevent a missed WHERE predicate from exposing another tenant.
CREATE FUNCTION current_app_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON tenants
    USING (id = current_app_tenant_id())
    WITH CHECK (id = current_app_tenant_id());

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_tenant_isolation ON memberships
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE market_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY market_accounts_tenant_isolation ON market_accounts
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE integration_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_secrets_tenant_isolation ON integration_secrets
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_orders_tenant_isolation ON sales_orders
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_items_tenant_isolation ON order_items
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE order_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_recipients_tenant_isolation ON order_recipients
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_runs_tenant_isolation ON sync_runs
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE raw_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY raw_snapshots_tenant_isolation ON raw_snapshots
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE integration_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_events_tenant_isolation ON integration_events
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE sync_cursors ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_cursors_tenant_isolation ON sync_cursors
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE outbound_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbound_commands_tenant_isolation ON outbound_commands
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE outbound_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbound_attempts_tenant_isolation ON outbound_attempts
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_tenant_isolation ON audit_logs
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

-- Runtime roles are provisioned by infrastructure. If they exist, grant only
-- data access; schema ownership and DDL remain with the migration owner.
DO $$
DECLARE
    runtime_role text;
BEGIN
    FOREACH runtime_role IN ARRAY ARRAY['jumunpangpang_app', 'jumunpangpang_worker']
    LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
            EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', runtime_role);
            EXECUTE format(
                'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO %I',
                runtime_role
            );
            -- The migration runner creates this ledger before applying 001, so
            -- the broad current-table grant above would otherwise let runtime
            -- roles forge checksums or mark unapplied migrations as complete.
            IF to_regclass('public.schema_migrations') IS NOT NULL THEN
                EXECUTE format(
                    'REVOKE ALL PRIVILEGES ON TABLE public.schema_migrations FROM %I',
                    runtime_role
                );
            END IF;
            -- Audit evidence is append-only for every runtime role. Reading and
            -- inserting are required, but prior entries must not be rewritten or
            -- removed even if a future broad grant is added accidentally.
            EXECUTE format(
                'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_logs FROM %I',
                runtime_role
            );
            EXECUTE format(
                'GRANT SELECT, INSERT ON TABLE public.audit_logs TO %I',
                runtime_role
            );
            EXECUTE format(
                'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
                runtime_role
            );
            -- New tables receive explicit grants in their owning migration so
            -- append-only or otherwise sensitive tables never inherit UPDATE.
            EXECUTE format(
                'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
                runtime_role
            );
        END IF;
    END LOOP;
END;
$$;
