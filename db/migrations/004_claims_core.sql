-- Common, provider-neutral claim ledger. Provider writes remain intentionally
-- unavailable; the worker may only persist verified inbound marketplace state.

CREATE TABLE claim_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    sales_order_id uuid NOT NULL,
    external_claim_id text NOT NULL,
    dedupe_key char(64) NOT NULL,
    claim_type text NOT NULL,
    source text NOT NULL,
    requester_type text NOT NULL,
    fault_type text NOT NULL DEFAULT 'UNKNOWN',
    normalized_status text NOT NULL,
    market_status_raw text NOT NULL,
    market_reason_code text,
    market_reason_encrypted text,
    market_reason_masked text,
    reason_encryption_key_version integer NOT NULL DEFAULT 1,
    provider_processing_id text,
    provider_error_code text,
    raw_snapshot_ref text,
    deadline_at timestamptz,
    deadline_type text,
    resolution_type text,
    resolution_status text NOT NULL DEFAULT 'UNDECIDED',
    purchase_compensation_status text NOT NULL,
    purchase_compensation_reference text,
    purchase_compensation_next_action_at timestamptz,
    purchase_compensation_completed_at timestamptz,
    order_status_at_request text NOT NULL,
    item_status_at_request text NOT NULL,
    sourcing_status_at_request text NOT NULL,
    fulfillment_status_at_request text,
    requested_at timestamptz NOT NULL,
    reviewed_at timestamptz,
    approved_at timestamptz,
    rejected_at timestamptz,
    collection_started_at timestamptz,
    received_at timestamptz,
    resolved_at timestamptz,
    completed_at timestamptz,
    source_created_at timestamptz,
    source_updated_at timestamptz NOT NULL,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT claim_cases_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT claim_cases_tenant_account_id_key UNIQUE (tenant_id, market_account_id, id),
    CONSTRAINT claim_cases_tenant_order_id_key UNIQUE (tenant_id, sales_order_id, id),
    CONSTRAINT claim_cases_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT claim_cases_market_account_fk
        FOREIGN KEY (tenant_id, market_account_id)
        REFERENCES market_accounts (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT claim_cases_sales_order_fk
        FOREIGN KEY (tenant_id, market_account_id, sales_order_id)
        REFERENCES sales_orders (tenant_id, market_account_id, id) ON DELETE RESTRICT,
    CONSTRAINT claim_cases_external_id_ck CHECK (
        btrim(external_claim_id) <> '' AND char_length(external_claim_id) <= 500
    ),
    CONSTRAINT claim_cases_dedupe_key_ck CHECK (dedupe_key ~ '^[0-9a-f]{64}$'),
    CONSTRAINT claim_cases_type_ck CHECK (claim_type IN ('CANCEL', 'RETURN', 'EXCHANGE')),
    CONSTRAINT claim_cases_source_ck CHECK (source IN ('MARKET', 'SELLER', 'INTERNAL')),
    CONSTRAINT claim_cases_requester_ck CHECK (
        requester_type IN ('CUSTOMER', 'SELLER', 'MARKET', 'INTERNAL', 'UNKNOWN')
    ),
    CONSTRAINT claim_cases_fault_ck CHECK (
        fault_type IN ('CUSTOMER', 'SELLER', 'MARKET', 'CARRIER', 'SOURCING', 'UNKNOWN')
    ),
    CONSTRAINT claim_cases_status_ck CHECK (
        normalized_status IN (
            'REQUESTED', 'UNDER_REVIEW', 'APPROVAL_PENDING', 'APPROVED',
            'REJECTED', 'ON_HOLD', 'COLLECTION_PENDING', 'IN_TRANSIT',
            'RECEIVED', 'REFUND_PENDING', 'REFUNDED', 'REPLACEMENT_PENDING',
            'REPLACEMENT_SHIPPED', 'WITHDRAWN', 'COMPLETED'
        )
    ),
    CONSTRAINT claim_cases_market_status_ck CHECK (
        btrim(market_status_raw) <> '' AND char_length(market_status_raw) <= 300
    ),
    CONSTRAINT claim_cases_reason_code_ck CHECK (
        market_reason_code IS NULL
        OR (btrim(market_reason_code) <> '' AND char_length(market_reason_code) <= 200)
    ),
    CONSTRAINT claim_cases_reason_pair_ck CHECK (
        (market_reason_encrypted IS NULL AND market_reason_masked IS NULL)
        OR (
            market_reason_encrypted IS NOT NULL
            AND btrim(market_reason_encrypted) <> ''
            AND market_reason_masked IS NOT NULL
            AND btrim(market_reason_masked) <> ''
        )
    ),
    CONSTRAINT claim_cases_reason_key_version_ck CHECK (reason_encryption_key_version > 0),
    CONSTRAINT claim_cases_provider_fields_ck CHECK (
        (provider_processing_id IS NULL OR (btrim(provider_processing_id) <> '' AND char_length(provider_processing_id) <= 500))
        AND (provider_error_code IS NULL OR (btrim(provider_error_code) <> '' AND char_length(provider_error_code) <= 200))
        AND (raw_snapshot_ref IS NULL OR (btrim(raw_snapshot_ref) <> '' AND char_length(raw_snapshot_ref) <= 1000))
    ),
    CONSTRAINT claim_cases_deadline_pair_ck CHECK (
        (deadline_at IS NULL AND deadline_type IS NULL)
        OR (deadline_at IS NOT NULL AND deadline_type IS NOT NULL AND btrim(deadline_type) <> '')
    ),
    CONSTRAINT claim_cases_resolution_type_ck CHECK (
        resolution_type IS NULL OR resolution_type IN ('REFUND', 'REPLACEMENT', 'REJECT', 'NO_ACTION')
    ),
    CONSTRAINT claim_cases_resolution_status_ck CHECK (
        resolution_status IN ('UNDECIDED', 'PENDING', 'PARTIAL', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'NOT_REQUIRED')
        AND (
            (resolution_type IS NULL AND resolution_status = 'UNDECIDED')
            OR (resolution_type IS NOT NULL AND resolution_status <> 'UNDECIDED')
        )
    ),
    CONSTRAINT claim_cases_terminal_resolution_ck CHECK (
        normalized_status NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED')
        OR resolution_status IN ('SUCCEEDED', 'NOT_REQUIRED')
    ),
    CONSTRAINT claim_cases_compensation_status_ck CHECK (
        purchase_compensation_status IN (
            'NOT_REQUIRED', 'PENDING', 'IN_PROGRESS', 'SUCCEEDED',
            'FAILED', 'NEEDS_ATTENTION', 'UNKNOWN'
        )
    ),
    CONSTRAINT claim_cases_compensation_completion_ck CHECK (
        purchase_compensation_completed_at IS NULL
        OR purchase_compensation_status = 'SUCCEEDED'
    ),
    CONSTRAINT claim_cases_type_state_ck CHECK (
        (claim_type <> 'CANCEL' OR normalized_status NOT IN (
            'COLLECTION_PENDING', 'IN_TRANSIT', 'RECEIVED',
            'REPLACEMENT_PENDING', 'REPLACEMENT_SHIPPED'
        ))
        AND (claim_type <> 'RETURN' OR normalized_status NOT IN (
            'REPLACEMENT_PENDING', 'REPLACEMENT_SHIPPED'
        ))
        AND (claim_type = 'EXCHANGE' OR resolution_type IS DISTINCT FROM 'REPLACEMENT')
    ),
    CONSTRAINT claim_cases_attributes_ck CHECK (jsonb_typeof(attributes) = 'object'),
    CONSTRAINT claim_cases_source_time_ck CHECK (
        source_created_at IS NULL OR source_updated_at >= source_created_at
    ),
    CONSTRAINT claim_cases_version_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX claim_cases_external_identity_uidx
    ON claim_cases (tenant_id, market_account_id, external_claim_id)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX claim_cases_dedupe_uidx
    ON claim_cases (tenant_id, market_account_id, dedupe_key)
    WHERE deleted_at IS NULL;

CREATE INDEX claim_cases_inbox_idx
    ON claim_cases (tenant_id, source_updated_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX claim_cases_status_inbox_idx
    ON claim_cases (tenant_id, normalized_status, source_updated_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX claim_cases_deadline_idx
    ON claim_cases (tenant_id, deadline_at, id)
    WHERE deleted_at IS NULL
      AND deadline_at IS NOT NULL
      AND normalized_status NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED');

CREATE TABLE claim_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    claim_case_id uuid NOT NULL,
    sales_order_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    external_claim_line_id text,
    line_key char(64) NOT NULL,
    requested_quantity integer NOT NULL,
    order_quantity_snapshot integer NOT NULL,
    item_status_at_request text NOT NULL,
    sourcing_status_at_request text NOT NULL,
    fulfillment_status_at_request text,
    normalized_status text NOT NULL,
    market_status_raw text NOT NULL,
    market_reason_code text,
    market_reason_encrypted text,
    market_reason_masked text,
    reason_encryption_key_version integer NOT NULL DEFAULT 1,
    resolution_type text,
    resolution_status text NOT NULL DEFAULT 'UNDECIDED',
    refund_amount numeric(18, 2),
    refund_currency char(3),
    source_updated_at timestamptz NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamptz,
    CONSTRAINT claim_lines_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT claim_lines_tenant_case_id_key UNIQUE (tenant_id, claim_case_id, id),
    CONSTRAINT claim_lines_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT claim_lines_case_fk
        FOREIGN KEY (tenant_id, sales_order_id, claim_case_id)
        REFERENCES claim_cases (tenant_id, sales_order_id, id) ON DELETE RESTRICT,
    CONSTRAINT claim_lines_item_fk
        FOREIGN KEY (tenant_id, order_item_id)
        REFERENCES order_items (tenant_id, id) ON DELETE RESTRICT,
    CONSTRAINT claim_lines_external_id_ck CHECK (
        external_claim_line_id IS NULL
        OR (btrim(external_claim_line_id) <> '' AND char_length(external_claim_line_id) <= 500)
    ),
    CONSTRAINT claim_lines_key_ck CHECK (line_key ~ '^[0-9a-f]{64}$'),
    CONSTRAINT claim_lines_quantity_ck CHECK (
        requested_quantity > 0
        AND order_quantity_snapshot > 0
        AND requested_quantity <= order_quantity_snapshot
    ),
    CONSTRAINT claim_lines_status_ck CHECK (
        normalized_status IN (
            'REQUESTED', 'UNDER_REVIEW', 'APPROVAL_PENDING', 'APPROVED',
            'REJECTED', 'ON_HOLD', 'COLLECTION_PENDING', 'IN_TRANSIT',
            'RECEIVED', 'REFUND_PENDING', 'REFUNDED', 'REPLACEMENT_PENDING',
            'REPLACEMENT_SHIPPED', 'WITHDRAWN', 'COMPLETED'
        )
    ),
    CONSTRAINT claim_lines_market_status_ck CHECK (
        btrim(market_status_raw) <> '' AND char_length(market_status_raw) <= 300
    ),
    CONSTRAINT claim_lines_reason_pair_ck CHECK (
        (market_reason_encrypted IS NULL AND market_reason_masked IS NULL)
        OR (
            market_reason_encrypted IS NOT NULL
            AND btrim(market_reason_encrypted) <> ''
            AND market_reason_masked IS NOT NULL
            AND btrim(market_reason_masked) <> ''
        )
    ),
    CONSTRAINT claim_lines_reason_key_version_ck CHECK (reason_encryption_key_version > 0),
    CONSTRAINT claim_lines_resolution_type_ck CHECK (
        resolution_type IS NULL OR resolution_type IN ('REFUND', 'REPLACEMENT', 'REJECT', 'NO_ACTION')
    ),
    CONSTRAINT claim_lines_resolution_status_ck CHECK (
        resolution_status IN ('UNDECIDED', 'PENDING', 'PARTIAL', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'NOT_REQUIRED')
        AND (
            (resolution_type IS NULL AND resolution_status = 'UNDECIDED')
            OR (resolution_type IS NOT NULL AND resolution_status <> 'UNDECIDED')
        )
    ),
    CONSTRAINT claim_lines_terminal_resolution_ck CHECK (
        normalized_status NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED')
        OR resolution_status IN ('SUCCEEDED', 'NOT_REQUIRED')
    ),
    CONSTRAINT claim_lines_refund_ck CHECK (
        (refund_amount IS NULL AND refund_currency IS NULL)
        OR (
            refund_amount IS NOT NULL AND refund_amount >= 0
            AND refund_currency IS NOT NULL AND refund_currency ~ '^[A-Z]{3}$'
            AND resolution_type = 'REFUND'
        )
    ),
    CONSTRAINT claim_lines_version_ck CHECK (version > 0)
);

CREATE UNIQUE INDEX claim_lines_case_item_uidx
    ON claim_lines (tenant_id, claim_case_id, order_item_id)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX claim_lines_external_identity_uidx
    ON claim_lines (tenant_id, claim_case_id, external_claim_line_id)
    WHERE deleted_at IS NULL AND external_claim_line_id IS NOT NULL;

CREATE INDEX claim_lines_item_history_idx
    ON claim_lines (tenant_id, order_item_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE claim_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    market_account_id uuid NOT NULL,
    claim_case_id uuid NOT NULL,
    external_event_id text,
    event_key char(64) NOT NULL,
    event_type text NOT NULL,
    event_source text NOT NULL,
    from_status text,
    to_status text,
    market_status_raw text,
    market_reason_code text,
    payload_sha256 char(64) NOT NULL,
    snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    correlation_id uuid NOT NULL,
    source_occurred_at timestamptz,
    received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT claim_events_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT claim_events_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT,
    CONSTRAINT claim_events_case_fk
        FOREIGN KEY (tenant_id, market_account_id, claim_case_id)
        REFERENCES claim_cases (tenant_id, market_account_id, id) ON DELETE RESTRICT,
    CONSTRAINT claim_events_external_id_ck CHECK (
        external_event_id IS NULL
        OR (btrim(external_event_id) <> '' AND char_length(external_event_id) <= 500)
    ),
    CONSTRAINT claim_events_key_ck CHECK (event_key ~ '^[0-9a-f]{64}$'),
    CONSTRAINT claim_events_type_ck CHECK (
        event_type IN (
            'CLAIM_CREATED', 'SNAPSHOT_APPLIED', 'SNAPSHOT_IGNORED_STALE',
            'SNAPSHOT_CONFLICT',
            'TRANSITION_REJECTED', 'STATUS_CHANGED', 'LINE_CHANGED',
            'DEADLINE_CHANGED', 'RESOLUTION_CHANGED',
            'COMPENSATION_CHANGED', 'HOLD_RELEASED'
        )
    ),
    CONSTRAINT claim_events_source_ck CHECK (
        event_source IN ('MARKET', 'SELLER', 'INTERNAL', 'WORKER', 'SYSTEM')
    ),
    CONSTRAINT claim_events_status_pair_ck CHECK (
        (from_status IS NULL OR from_status IN (
            'REQUESTED', 'UNDER_REVIEW', 'APPROVAL_PENDING', 'APPROVED',
            'REJECTED', 'ON_HOLD', 'COLLECTION_PENDING', 'IN_TRANSIT',
            'RECEIVED', 'REFUND_PENDING', 'REFUNDED', 'REPLACEMENT_PENDING',
            'REPLACEMENT_SHIPPED', 'WITHDRAWN', 'COMPLETED'
        ))
        AND (to_status IS NULL OR to_status IN (
            'REQUESTED', 'UNDER_REVIEW', 'APPROVAL_PENDING', 'APPROVED',
            'REJECTED', 'ON_HOLD', 'COLLECTION_PENDING', 'IN_TRANSIT',
            'RECEIVED', 'REFUND_PENDING', 'REFUNDED', 'REPLACEMENT_PENDING',
            'REPLACEMENT_SHIPPED', 'WITHDRAWN', 'COMPLETED'
        ))
    ),
    CONSTRAINT claim_events_payload_hash_ck CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT claim_events_snapshot_ck CHECK (jsonb_typeof(snapshot) = 'object')
);

CREATE UNIQUE INDEX claim_events_event_key_uidx
    ON claim_events (tenant_id, claim_case_id, event_key);

CREATE UNIQUE INDEX claim_events_external_identity_uidx
    ON claim_events (tenant_id, claim_case_id, external_event_id)
    WHERE external_event_id IS NOT NULL;

CREATE INDEX claim_events_case_timeline_idx
    ON claim_events (tenant_id, claim_case_id, source_occurred_at DESC, created_at DESC, id DESC);

CREATE FUNCTION claim_status_allowed_for_type(target_type text, target_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT target_status IN (
        'REQUESTED', 'UNDER_REVIEW', 'APPROVAL_PENDING', 'APPROVED',
        'REJECTED', 'ON_HOLD', 'COLLECTION_PENDING', 'IN_TRANSIT',
        'RECEIVED', 'REFUND_PENDING', 'REFUNDED', 'REPLACEMENT_PENDING',
        'REPLACEMENT_SHIPPED', 'WITHDRAWN', 'COMPLETED'
    )
    AND (target_type <> 'CANCEL' OR target_status NOT IN (
        'COLLECTION_PENDING', 'IN_TRANSIT', 'RECEIVED',
        'REPLACEMENT_PENDING', 'REPLACEMENT_SHIPPED'
    ))
    AND (target_type <> 'RETURN' OR target_status NOT IN (
        'REPLACEMENT_PENDING', 'REPLACEMENT_SHIPPED'
    ))
$$;

CREATE FUNCTION claim_status_transition_allowed(
    target_type text,
    previous_status text,
    next_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT public.claim_status_allowed_for_type(target_type, next_status)
       AND (
           previous_status = next_status
           OR CASE previous_status
               WHEN 'REQUESTED' THEN next_status IN (
                   'UNDER_REVIEW', 'APPROVAL_PENDING', 'APPROVED', 'REJECTED',
                   'ON_HOLD', 'COLLECTION_PENDING', 'IN_TRANSIT', 'RECEIVED',
                   'REFUND_PENDING', 'REFUNDED', 'REPLACEMENT_PENDING',
                   'REPLACEMENT_SHIPPED', 'WITHDRAWN', 'COMPLETED'
               )
               WHEN 'UNDER_REVIEW' THEN next_status IN (
                   'APPROVAL_PENDING', 'APPROVED', 'REJECTED', 'ON_HOLD',
                   'COLLECTION_PENDING', 'IN_TRANSIT', 'RECEIVED',
                   'REFUND_PENDING', 'REFUNDED', 'REPLACEMENT_PENDING',
                   'REPLACEMENT_SHIPPED', 'WITHDRAWN', 'COMPLETED'
               )
               WHEN 'APPROVAL_PENDING' THEN next_status IN (
                   'APPROVED', 'REJECTED', 'ON_HOLD', 'COLLECTION_PENDING',
                   'IN_TRANSIT', 'RECEIVED', 'REFUND_PENDING', 'REFUNDED',
                   'REPLACEMENT_PENDING', 'REPLACEMENT_SHIPPED',
                   'WITHDRAWN', 'COMPLETED'
               )
               WHEN 'APPROVED' THEN next_status IN (
                   'COLLECTION_PENDING', 'IN_TRANSIT', 'RECEIVED',
                   'REFUND_PENDING', 'REFUNDED',
                   'REPLACEMENT_PENDING', 'REPLACEMENT_SHIPPED',
                   'ON_HOLD', 'WITHDRAWN', 'COMPLETED'
               )
               WHEN 'ON_HOLD' THEN next_status IN (
                   'UNDER_REVIEW', 'APPROVAL_PENDING', 'APPROVED', 'REJECTED',
                   'COLLECTION_PENDING', 'IN_TRANSIT', 'RECEIVED',
                   'REFUND_PENDING', 'REFUNDED', 'REPLACEMENT_PENDING',
                   'REPLACEMENT_SHIPPED', 'WITHDRAWN', 'COMPLETED'
               )
               WHEN 'COLLECTION_PENDING' THEN next_status IN (
                   'IN_TRANSIT', 'RECEIVED', 'REFUND_PENDING',
                   'REPLACEMENT_PENDING', 'ON_HOLD', 'WITHDRAWN', 'COMPLETED'
               )
               WHEN 'IN_TRANSIT' THEN next_status IN (
                   'RECEIVED', 'REFUND_PENDING', 'REPLACEMENT_PENDING',
                   'ON_HOLD', 'COMPLETED'
               )
               WHEN 'RECEIVED' THEN next_status IN (
                   'REFUND_PENDING', 'REFUNDED', 'REPLACEMENT_PENDING',
                   'REPLACEMENT_SHIPPED', 'ON_HOLD', 'COMPLETED'
               )
               WHEN 'REFUND_PENDING' THEN next_status IN ('REFUNDED', 'ON_HOLD', 'COMPLETED')
               WHEN 'REFUNDED' THEN next_status = 'COMPLETED'
               WHEN 'REPLACEMENT_PENDING' THEN next_status IN ('REPLACEMENT_SHIPPED', 'ON_HOLD', 'COMPLETED')
               WHEN 'REPLACEMENT_SHIPPED' THEN next_status = 'COMPLETED'
               ELSE false
           END
       )
$$;

CREATE FUNCTION guard_order_item_claim_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    active_claim_quantity bigint;
BEGIN
    IF NEW.quantity IS DISTINCT FROM OLD.quantity
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
        -- Claim-line writes use the same transaction-scoped key after locking
        -- this order-item row. Keeping that order serializes both directions.
        PERFORM pg_advisory_xact_lock(hashtextextended(
            OLD.tenant_id::text || ':' || OLD.id::text,
            0
        ));

        SELECT COALESCE(SUM(line.requested_quantity), 0)
          INTO active_claim_quantity
          FROM claim_lines line
         WHERE line.tenant_id = OLD.tenant_id
           AND line.order_item_id = OLD.id
           AND line.deleted_at IS NULL
           AND line.normalized_status NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED');

        IF OLD.deleted_at IS NULL
           AND NEW.deleted_at IS NOT NULL
           AND active_claim_quantity > 0 THEN
            RAISE EXCEPTION 'Order item cannot be soft-deleted while active claims exist'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.quantity < OLD.quantity
           AND active_claim_quantity > NEW.quantity THEN
            RAISE EXCEPTION 'Order item quantity cannot be reduced below active claim quantities'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION guard_claim_case_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- Marketplace payloads never own purchase-compensation state. Derive the
    -- initial fail-safe state from the immutable request-time sourcing snapshot.
    IF TG_OP = 'INSERT' THEN
        NEW.purchase_compensation_status := CASE
            WHEN NEW.sourcing_status_at_request IN (
                'PAID', 'INVOICE_RECEIVED', 'EXTERNAL_PURCHASE', 'MULTIPLE'
            ) THEN 'NEEDS_ATTENTION'
            WHEN NEW.sourcing_status_at_request IN (
                'UNMATCHED', 'MATCHED', 'PAYMENT_READY'
            ) THEN 'NOT_REQUIRED'
            ELSE 'UNKNOWN'
        END;
        NEW.purchase_compensation_reference := NULL;
        NEW.purchase_compensation_next_action_at := NULL;
        NEW.purchase_compensation_completed_at := NULL;
    END IF;

    IF TG_OP = 'INSERT' AND NEW.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Claim cases cannot be inserted as soft-deleted ledger entries'
            USING ERRCODE = '23514';
    END IF;

    IF NOT public.claim_status_allowed_for_type(NEW.claim_type, NEW.normalized_status) THEN
        RAISE EXCEPTION 'Claim status % is not valid for type %', NEW.normalized_status, NEW.claim_type
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
            RAISE EXCEPTION 'Claim case deleted_at is immutable'
                USING ERRCODE = '23514';
        END IF;
        IF ROW(
            NEW.purchase_compensation_status,
            NEW.purchase_compensation_reference,
            NEW.purchase_compensation_next_action_at,
            NEW.purchase_compensation_completed_at
        ) IS DISTINCT FROM ROW(
            OLD.purchase_compensation_status,
            OLD.purchase_compensation_reference,
            OLD.purchase_compensation_next_action_at,
            OLD.purchase_compensation_completed_at
        ) AND CURRENT_USER IS DISTINCT FROM (
            SELECT pg_catalog.pg_get_userbyid(owner_class.relowner)
              FROM pg_catalog.pg_class owner_class
             WHERE owner_class.oid = 'public.claim_cases'::pg_catalog.regclass
        ) THEN
            RAISE EXCEPTION 'Purchase compensation is reconciliation-owned'
                USING ERRCODE = '42501';
        END IF;
        IF ROW(
            NEW.tenant_id, NEW.market_account_id, NEW.sales_order_id,
            NEW.external_claim_id, NEW.dedupe_key, NEW.claim_type, NEW.source,
            NEW.requested_at,
            NEW.order_status_at_request, NEW.item_status_at_request,
            NEW.sourcing_status_at_request, NEW.fulfillment_status_at_request
        ) IS DISTINCT FROM ROW(
            OLD.tenant_id, OLD.market_account_id, OLD.sales_order_id,
            OLD.external_claim_id, OLD.dedupe_key, OLD.claim_type, OLD.source,
            OLD.requested_at,
            OLD.order_status_at_request, OLD.item_status_at_request,
            OLD.sourcing_status_at_request, OLD.fulfillment_status_at_request
        ) THEN
            RAISE EXCEPTION 'Claim identity and request-time snapshots are immutable'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.source_updated_at < OLD.source_updated_at THEN
            RAISE EXCEPTION 'Claim source_updated_at cannot move backwards'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.source_updated_at = OLD.source_updated_at
           AND ROW(
               NEW.requester_type, NEW.fault_type, NEW.normalized_status,
               NEW.market_status_raw, NEW.market_reason_code,
               NEW.market_reason_encrypted, NEW.market_reason_masked,
               NEW.provider_processing_id, NEW.provider_error_code,
               NEW.raw_snapshot_ref, NEW.deadline_at, NEW.deadline_type,
               NEW.resolution_type, NEW.resolution_status,
               NEW.reviewed_at, NEW.approved_at, NEW.rejected_at,
               NEW.collection_started_at, NEW.received_at,
               NEW.resolved_at, NEW.completed_at
           ) IS DISTINCT FROM ROW(
               OLD.requester_type, OLD.fault_type, OLD.normalized_status,
               OLD.market_status_raw, OLD.market_reason_code,
               OLD.market_reason_encrypted, OLD.market_reason_masked,
               OLD.provider_processing_id, OLD.provider_error_code,
               OLD.raw_snapshot_ref, OLD.deadline_at, OLD.deadline_type,
               OLD.resolution_type, OLD.resolution_status,
               OLD.reviewed_at, OLD.approved_at, OLD.rejected_at,
               OLD.collection_started_at, OLD.received_at,
               OLD.resolved_at, OLD.completed_at
           ) THEN
            RAISE EXCEPTION 'Conflicting claim snapshots share the same source_updated_at'
                USING ERRCODE = '23514';
        END IF;
        IF NOT public.claim_status_transition_allowed(
            NEW.claim_type,
            OLD.normalized_status,
            NEW.normalized_status
        ) THEN
            RAISE EXCEPTION 'Invalid claim transition from % to %', OLD.normalized_status, NEW.normalized_status
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION guard_claim_line_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    case_row claim_cases%ROWTYPE;
    item_order_id uuid;
    item_account_id uuid;
    item_quantity integer;
    item_internal_work_status text;
    item_sourcing_status text;
    item_fulfillment_status text;
    other_active_quantity bigint;
BEGIN
    IF TG_OP = 'INSERT' AND NEW.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Claim lines cannot be inserted as soft-deleted ledger entries'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
        RAISE EXCEPTION 'Claim line deleted_at is immutable'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO case_row
      FROM claim_cases
     WHERE tenant_id = NEW.tenant_id
       AND id = NEW.claim_case_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim case is unavailable' USING ERRCODE = '23503';
    END IF;

    SELECT sales_order_id, market_account_id, quantity,
           internal_work_status, sourcing_status, market_fulfillment_status
      INTO item_order_id, item_account_id, item_quantity,
           item_internal_work_status, item_sourcing_status,
           item_fulfillment_status
      FROM order_items
     WHERE tenant_id = NEW.tenant_id
       AND id = NEW.order_item_id
       AND deleted_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim order item is unavailable' USING ERRCODE = '23503';
    END IF;

    IF case_row.sales_order_id <> item_order_id
       OR case_row.market_account_id <> item_account_id
       OR NEW.sales_order_id <> item_order_id THEN
        RAISE EXCEPTION 'Claim line must reference an item from the claim order'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.order_quantity_snapshot <> item_quantity THEN
        RAISE EXCEPTION 'Claim quantity exceeds or misstates the ordered quantity'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND ROW(
        NEW.item_status_at_request,
        NEW.sourcing_status_at_request,
        NEW.fulfillment_status_at_request
    ) IS DISTINCT FROM ROW(
        item_internal_work_status,
        item_sourcing_status,
        item_fulfillment_status
    ) THEN
        RAISE EXCEPTION 'Claim request-time item snapshots must match the trusted order item'
            USING ERRCODE = '23514';
    END IF;
    IF NOT public.claim_status_allowed_for_type(case_row.claim_type, NEW.normalized_status) THEN
        RAISE EXCEPTION 'Claim line status is invalid for the claim type'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.resolution_type = 'REPLACEMENT' AND case_row.claim_type <> 'EXCHANGE' THEN
        RAISE EXCEPTION 'Replacement resolution is valid only for exchange claims'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF ROW(
            NEW.tenant_id, NEW.claim_case_id, NEW.sales_order_id,
            NEW.order_item_id, NEW.line_key, NEW.item_status_at_request,
            NEW.sourcing_status_at_request, NEW.fulfillment_status_at_request,
            NEW.order_quantity_snapshot
        ) IS DISTINCT FROM ROW(
            OLD.tenant_id, OLD.claim_case_id, OLD.sales_order_id,
            OLD.order_item_id, OLD.line_key, OLD.item_status_at_request,
            OLD.sourcing_status_at_request, OLD.fulfillment_status_at_request,
            OLD.order_quantity_snapshot
        ) THEN
            RAISE EXCEPTION 'Claim line identity and request-time snapshots are immutable'
                USING ERRCODE = '23514';
        END IF;
        IF OLD.external_claim_line_id IS NOT NULL
           AND NEW.external_claim_line_id IS DISTINCT FROM OLD.external_claim_line_id THEN
            RAISE EXCEPTION 'External claim line identity is immutable' USING ERRCODE = '23514';
        END IF;
        IF NEW.source_updated_at < OLD.source_updated_at THEN
            RAISE EXCEPTION 'Claim line source_updated_at cannot move backwards'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.source_updated_at = OLD.source_updated_at
           AND ROW(
               NEW.external_claim_line_id, NEW.requested_quantity,
               NEW.normalized_status, NEW.market_status_raw,
               NEW.market_reason_code, NEW.market_reason_encrypted,
               NEW.market_reason_masked, NEW.resolution_type,
               NEW.resolution_status, NEW.refund_amount, NEW.refund_currency
           ) IS DISTINCT FROM ROW(
               OLD.external_claim_line_id, OLD.requested_quantity,
               OLD.normalized_status, OLD.market_status_raw,
               OLD.market_reason_code, OLD.market_reason_encrypted,
               OLD.market_reason_masked, OLD.resolution_type,
               OLD.resolution_status, OLD.refund_amount, OLD.refund_currency
           ) THEN
            RAISE EXCEPTION 'Conflicting claim line snapshots share the same source_updated_at'
                USING ERRCODE = '23514';
        END IF;
        IF NOT public.claim_status_transition_allowed(
            case_row.claim_type,
            OLD.normalized_status,
            NEW.normalized_status
        ) THEN
            RAISE EXCEPTION 'Invalid claim line status transition'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.normalized_status NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED')
       AND (TG_OP = 'INSERT' OR NEW.requested_quantity IS DISTINCT FROM OLD.requested_quantity) THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(
            NEW.tenant_id::text || ':' || NEW.order_item_id::text,
            0
        ));
        SELECT COALESCE(SUM(line.requested_quantity), 0)
          INTO other_active_quantity
          FROM claim_lines line
          JOIN claim_cases other_case
            ON other_case.tenant_id = line.tenant_id
           AND other_case.id = line.claim_case_id
           AND other_case.deleted_at IS NULL
         WHERE line.tenant_id = NEW.tenant_id
           AND line.order_item_id = NEW.order_item_id
           -- INSERT ... ON CONFLICT fires this trigger once as INSERT before
           -- resolving to UPDATE. Exclude the current case/item identity so an
           -- existing line is never counted once from storage and once as NEW.
           AND line.claim_case_id <> NEW.claim_case_id
           AND line.deleted_at IS NULL
           AND line.normalized_status NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED');
        IF other_active_quantity + NEW.requested_quantity > item_quantity THEN
            RAISE EXCEPTION 'Active claim quantities exceed the ordered quantity'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- This function is created by the same migration role that owns claim_cases.
-- It is trigger-only: callers receive no EXECUTE grant, its namespace is fixed,
-- and it verifies that SECURITY DEFINER still resolves to the table owner.
CREATE FUNCTION public.reconcile_claim_purchase_compensation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    derived_status text;
    claim_case_owner name;
BEGIN
    SELECT pg_catalog.pg_get_userbyid(owner_class.relowner)
      INTO claim_case_owner
      FROM pg_catalog.pg_class owner_class
     WHERE owner_class.oid = 'public.claim_cases'::pg_catalog.regclass;

    IF CURRENT_USER IS DISTINCT FROM claim_case_owner THEN
        RAISE EXCEPTION 'Claim compensation reconciler must be owned by the claim_cases owner'
            USING ERRCODE = '42501';
    END IF;

    -- Serialize concurrent line inserts before reading the complete visible set.
    PERFORM 1
      FROM public.claim_cases claim_case
     WHERE claim_case.tenant_id = NEW.tenant_id
       AND claim_case.id = NEW.claim_case_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT CASE
               WHEN COUNT(*) FILTER (
                   WHERE line.sourcing_status_at_request IN (
                       'PAID', 'INVOICE_RECEIVED', 'EXTERNAL_PURCHASE', 'MULTIPLE'
                   )
               ) > 0 THEN 'NEEDS_ATTENTION'
               WHEN COUNT(*) FILTER (
                   WHERE line.sourcing_status_at_request NOT IN (
                       'UNMATCHED', 'MATCHED', 'PAYMENT_READY'
                   )
               ) > 0 THEN 'UNKNOWN'
               WHEN COUNT(*) = 0 THEN 'UNKNOWN'
               ELSE 'NOT_REQUIRED'
           END
      INTO derived_status
      FROM public.claim_lines line
     WHERE line.tenant_id = NEW.tenant_id
       AND line.claim_case_id = NEW.claim_case_id
       AND line.deleted_at IS NULL;

    UPDATE public.claim_cases claim_case
       SET purchase_compensation_status = derived_status
     WHERE claim_case.tenant_id = NEW.tenant_id
       AND claim_case.id = NEW.claim_case_id
       AND claim_case.purchase_compensation_status IN (
           'NOT_REQUIRED', 'UNKNOWN', 'NEEDS_ATTENTION'
       )
       AND claim_case.purchase_compensation_status IS DISTINCT FROM derived_status;

    RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.reconcile_claim_purchase_compensation() FROM PUBLIC;

CREATE FUNCTION enforce_claim_case_line_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    target_tenant_id uuid;
    target_case_id uuid;
    target_status text;
BEGIN
    IF TG_TABLE_NAME = 'claim_cases' THEN
        target_tenant_id := NEW.tenant_id;
        target_case_id := NEW.id;
    ELSE
        target_tenant_id := COALESCE(NEW.tenant_id, OLD.tenant_id);
        target_case_id := COALESCE(NEW.claim_case_id, OLD.claim_case_id);
    END IF;

    SELECT normalized_status INTO target_status
      FROM claim_cases
     WHERE tenant_id = target_tenant_id
       AND id = target_case_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM claim_lines
         WHERE tenant_id = target_tenant_id
           AND claim_case_id = target_case_id
           AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Claim case must contain at least one line'
            USING ERRCODE = '23514';
    END IF;

    IF target_status IN ('REJECTED', 'WITHDRAWN', 'COMPLETED')
       AND EXISTS (
           SELECT 1 FROM claim_lines
            WHERE tenant_id = target_tenant_id
              AND claim_case_id = target_case_id
              AND deleted_at IS NULL
              AND normalized_status NOT IN ('REJECTED', 'WITHDRAWN', 'COMPLETED')
       ) THEN
        RAISE EXCEPTION 'Terminal claim case contains an active claim line'
            USING ERRCODE = '23514';
    END IF;

    IF target_status IN ('REJECTED', 'WITHDRAWN', 'COMPLETED')
       AND EXISTS (
           SELECT 1 FROM claim_lines
            WHERE tenant_id = target_tenant_id
              AND claim_case_id = target_case_id
              AND deleted_at IS NULL
              AND normalized_status IS DISTINCT FROM target_status
       ) THEN
        RAISE EXCEPTION 'Terminal claim case status must match every claim line'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE FUNCTION reject_claim_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Claim events are append-only' USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER claim_cases_guard_write
    BEFORE INSERT OR UPDATE ON claim_cases
    FOR EACH ROW EXECUTE FUNCTION guard_claim_case_write();
CREATE TRIGGER claim_cases_touch_version
    BEFORE UPDATE ON claim_cases
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();

CREATE TRIGGER claim_lines_guard_write
    BEFORE INSERT OR UPDATE ON claim_lines
    FOR EACH ROW EXECUTE FUNCTION guard_claim_line_write();
CREATE TRIGGER claim_lines_touch_version
    BEFORE UPDATE ON claim_lines
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();

CREATE TRIGGER order_items_claim_capacity_guard
    BEFORE UPDATE OF quantity, deleted_at ON order_items
    FOR EACH ROW EXECUTE FUNCTION guard_order_item_claim_capacity();

CREATE TRIGGER claim_lines_reconcile_purchase_compensation
    AFTER INSERT ON claim_lines
    FOR EACH ROW EXECUTE FUNCTION public.reconcile_claim_purchase_compensation();

CREATE CONSTRAINT TRIGGER claim_cases_line_consistency
    AFTER INSERT OR UPDATE ON claim_cases
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION enforce_claim_case_line_consistency();
CREATE CONSTRAINT TRIGGER claim_lines_case_consistency
    AFTER INSERT OR UPDATE OR DELETE ON claim_lines
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION enforce_claim_case_line_consistency();

CREATE TRIGGER claim_events_reject_mutation
    BEFORE UPDATE OR DELETE ON claim_events
    FOR EACH ROW EXECUTE FUNCTION reject_claim_event_mutation();

ALTER TABLE claim_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY claim_cases_tenant_isolation ON claim_cases
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE claim_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY claim_lines_tenant_isolation ON claim_lines
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

ALTER TABLE claim_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY claim_events_tenant_isolation ON claim_events
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jumunpangpang_app') THEN
        REVOKE ALL PRIVILEGES ON claim_cases, claim_lines, claim_events FROM jumunpangpang_app;
        GRANT SELECT ON claim_cases, claim_lines, claim_events TO jumunpangpang_app;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jumunpangpang_worker') THEN
        REVOKE ALL PRIVILEGES ON claim_cases, claim_lines, claim_events FROM jumunpangpang_worker;
        GRANT SELECT, INSERT ON claim_cases TO jumunpangpang_worker;
        GRANT UPDATE (
            requester_type,
            fault_type,
            normalized_status,
            market_status_raw,
            market_reason_code,
            market_reason_encrypted,
            market_reason_masked,
            provider_processing_id,
            provider_error_code,
            raw_snapshot_ref,
            deadline_at,
            deadline_type,
            resolution_type,
            resolution_status,
            reviewed_at,
            approved_at,
            rejected_at,
            collection_started_at,
            received_at,
            resolved_at,
            completed_at,
            source_created_at,
            source_updated_at
        ) ON claim_cases TO jumunpangpang_worker;
        GRANT SELECT, INSERT, UPDATE ON claim_lines TO jumunpangpang_worker;
        GRANT SELECT, INSERT ON claim_events TO jumunpangpang_worker;
    END IF;
END;
$$;
