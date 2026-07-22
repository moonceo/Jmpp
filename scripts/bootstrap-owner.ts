import { config as loadEnvironment } from "dotenv";
import { hash } from "bcryptjs";
import { Pool } from "pg";

loadEnvironment({ path: [".env.local", ".env"], quiet: true });

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

async function main(): Promise<void> {
    if (!process.argv.includes("--confirm")) {
        throw new Error("Refusing to bootstrap an owner without the explicit --confirm flag.");
    }

    const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();
    if (!databaseUrl) {
        throw new Error("MIGRATION_DATABASE_URL is required for owner bootstrap.");
    }
    const slug = required("BOOTSTRAP_TENANT_SLUG").toLowerCase();
    const tenantName = required("BOOTSTRAP_TENANT_NAME");
    const email = required("BOOTSTRAP_OWNER_EMAIL").toLowerCase();
    const displayName = required("BOOTSTRAP_OWNER_DISPLAY_NAME");
    const password = required("BOOTSTRAP_OWNER_PASSWORD");
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.length > 63) {
        throw new Error("BOOTSTRAP_TENANT_SLUG has an invalid format.");
    }
    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
        throw new Error("BOOTSTRAP_OWNER_PASSWORD must contain at least 12 characters and at most 72 UTF-8 bytes.");
    }

    const passwordHash = await hash(password, 12);
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const tenantResult = await client.query<{ id: string }>(
            `INSERT INTO tenants (slug, name, status)
             VALUES ($1, $2, 'ACTIVE')
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [slug, tenantName],
        );
        const tenantId = tenantResult.rows[0]?.id ?? (await client.query<{ id: string }>(
            `SELECT id FROM tenants WHERE lower(slug) = lower($1) AND deleted_at IS NULL FOR UPDATE`,
            [slug],
        )).rows[0]?.id;
        if (!tenantId) throw new Error("Unable to create or resolve the bootstrap tenant.");

        const userResult = await client.query<{ id: string }>(
            `INSERT INTO users (auth_subject, email, display_name, status)
             VALUES ($1, $2, $3, 'ACTIVE')
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [`password:${email}`, email, displayName],
        );
        const userId = userResult.rows[0]?.id ?? (await client.query<{ id: string }>(
            `SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL FOR UPDATE`,
            [email],
        )).rows[0]?.id;
        if (!userId) throw new Error("Unable to create or resolve the bootstrap user.");

        await client.query(
            `INSERT INTO memberships (tenant_id, user_id, role, status, joined_at)
             VALUES ($1, $2, 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP)
             ON CONFLICT (tenant_id, user_id) WHERE deleted_at IS NULL
             DO UPDATE SET role = 'OWNER', status = 'ACTIVE', joined_at = COALESCE(memberships.joined_at, CURRENT_TIMESTAMP)`,
            [tenantId, userId],
        );
        await client.query(
            `INSERT INTO user_password_credentials (user_id, password_hash)
             VALUES ($1, $2)
             ON CONFLICT (user_id)
             DO UPDATE SET password_hash = EXCLUDED.password_hash,
                           password_changed_at = CURRENT_TIMESTAMP,
                           failed_attempt_count = 0,
                           locked_until = NULL`,
            [userId, passwordHash],
        );
        await client.query("COMMIT");
        console.log(`Bootstrap owner is ready for workspace '${slug}' and email '${email}'.`);
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Owner bootstrap failed.");
    process.exitCode = 1;
});
