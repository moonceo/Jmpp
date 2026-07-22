import { config as loadEnvironment } from "dotenv";
import { closeDbPool, withTransaction } from "@/lib/server/db";

loadEnvironment({ path: [".env.local", ".env"], quiet: true });

const TENANT_ID = process.env.DEV_TENANT_ID ?? "00000000-0000-4000-8000-000000000001";
const USER_ID = process.env.DEV_USER_ID ?? "00000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000001";

async function main(): Promise<void> {
    if (process.env.NODE_ENV === "production") {
        throw new Error("The development seed cannot run in production.");
    }

    const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();
    if (migrationDatabaseUrl) {
        process.env.DATABASE_URL = migrationDatabaseUrl;
    }

    await withTransaction(async (client) => {
        await client.query(
            `INSERT INTO tenants (id, slug, name, status, timezone)
             VALUES ($1, 'local-demo', '로컬 데모 워크스페이스', 'ACTIVE', 'Asia/Seoul')
             ON CONFLICT (id) DO UPDATE
                 SET name = EXCLUDED.name,
                     status = 'ACTIVE'`,
            [TENANT_ID],
        );
        await client.query(
            `INSERT INTO users (id, auth_subject, email, display_name, status)
             VALUES ($1, 'local-demo-user', 'local@example.invalid', '로컬 운영자', 'ACTIVE')
             ON CONFLICT (id) DO UPDATE
                 SET display_name = EXCLUDED.display_name,
                     status = 'ACTIVE'`,
            [USER_ID],
        );
        await client.query(
            `INSERT INTO memberships (
                 id, tenant_id, user_id, role, status, joined_at
             ) VALUES ($1, $2, $3, 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP)
             ON CONFLICT (id) DO UPDATE
                 SET role = 'OWNER',
                     status = 'ACTIVE',
                     deleted_at = NULL`,
            [MEMBERSHIP_ID, TENANT_ID, USER_ID],
        );
    });

    console.log(`Seeded development tenant ${TENANT_ID} and user ${USER_ID}.`);
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDbPool();
    });
