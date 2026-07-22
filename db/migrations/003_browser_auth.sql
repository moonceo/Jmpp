-- First-party browser authentication for deployments that do not place the
-- application behind an identity-aware proxy. Password hashes are never
-- exposed through ordinary table grants; login lookup/update is restricted to
-- narrowly scoped SECURITY DEFINER functions.

CREATE TABLE user_password_credentials (
    user_id uuid PRIMARY KEY,
    password_hash text NOT NULL,
    failed_attempt_count integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    password_changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_password_credentials_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT user_password_credentials_hash_ck CHECK (
        password_hash ~ '^\$2[aby]\$[0-9]{2}\$'
    ),
    CONSTRAINT user_password_credentials_failed_attempts_ck CHECK (
        failed_attempt_count BETWEEN 0 AND 1000000
    ),
    CONSTRAINT user_password_credentials_version_positive_ck CHECK (version > 0)
);

CREATE TRIGGER user_password_credentials_touch_version
    BEFORE UPDATE ON user_password_credentials
    FOR EACH ROW EXECUTE FUNCTION touch_versioned_row();

CREATE TABLE browser_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    csrf_token_hash char(64) NOT NULL,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at timestamptz,
    revocation_reason text,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT browser_sessions_tenant_id_id_key UNIQUE (tenant_id, id),
    CONSTRAINT browser_sessions_tenant_fk
        FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE,
    CONSTRAINT browser_sessions_user_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT browser_sessions_csrf_hash_ck CHECK (
        csrf_token_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT browser_sessions_expiry_ck CHECK (expires_at > created_at),
    CONSTRAINT browser_sessions_revocation_reason_ck CHECK (
        revocation_reason IS NULL OR btrim(revocation_reason) <> ''
    )
);

CREATE INDEX browser_sessions_active_lookup_idx
    ON browser_sessions (tenant_id, user_id, expires_at DESC)
    WHERE revoked_at IS NULL;

CREATE INDEX browser_sessions_expiry_cleanup_idx
    ON browser_sessions (expires_at, id)
    WHERE revoked_at IS NULL;

ALTER TABLE browser_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY browser_sessions_tenant_isolation ON browser_sessions
    USING (tenant_id = current_app_tenant_id())
    WITH CHECK (tenant_id = current_app_tenant_id());

CREATE FUNCTION resolve_password_login(
    workspace_slug text,
    login_email text
)
RETURNS TABLE (
    tenant_id uuid,
    user_id uuid,
    password_hash text,
    locked_until timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
    SELECT t.id, u.id, c.password_hash, c.locked_until
      FROM public.tenants t
      JOIN public.memberships m
        ON m.tenant_id = t.id
       AND m.status = 'ACTIVE'
       AND m.deleted_at IS NULL
      JOIN public.users u
        ON u.id = m.user_id
       AND u.status = 'ACTIVE'
       AND u.deleted_at IS NULL
      JOIN public.user_password_credentials c
        ON c.user_id = u.id
     WHERE lower(t.slug) = lower(btrim(workspace_slug))
       AND lower(u.email) = lower(btrim(login_email))
       AND t.status = 'ACTIVE'
       AND t.deleted_at IS NULL
     LIMIT 1
$$;

CREATE FUNCTION record_password_login_failure(target_user_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
    UPDATE public.user_password_credentials
       SET failed_attempt_count = failed_attempt_count + 1,
           locked_until = CASE
               WHEN failed_attempt_count + 1 >= 5
                   THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
               ELSE locked_until
           END
     WHERE user_id = target_user_id
$$;

CREATE FUNCTION record_password_login_success(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
BEGIN
    UPDATE public.user_password_credentials
       SET failed_attempt_count = 0,
           locked_until = NULL
     WHERE user_id = target_user_id;

    UPDATE public.users
       SET last_login_at = CURRENT_TIMESTAMP
     WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON TABLE user_password_credentials FROM PUBLIC;
REVOKE ALL ON TABLE browser_sessions FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_password_login(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_password_login_failure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_password_login_success(uuid) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jumunpangpang_app') THEN
        GRANT SELECT, INSERT, UPDATE ON TABLE browser_sessions TO jumunpangpang_app;
        GRANT EXECUTE ON FUNCTION resolve_password_login(text, text) TO jumunpangpang_app;
        GRANT EXECUTE ON FUNCTION record_password_login_failure(uuid) TO jumunpangpang_app;
        GRANT EXECUTE ON FUNCTION record_password_login_success(uuid) TO jumunpangpang_app;
    END IF;
END;
$$;
