import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnvironment } from "dotenv";

import type { Pool, PoolClient } from "pg";

import { closeDbPool, getDbPool } from "../lib/server/db/pool";

loadEnvironment({ path: [".env.local", ".env"], quiet: true });

const MIGRATION_FILE_PATTERN = /^(\d{3,})_([a-z0-9][a-z0-9_-]*)\.sql$/;
const MIGRATION_LOCK_ID = "507556852249393745";
const DEFAULT_MIGRATIONS_DIRECTORY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../db/migrations",
);

export interface Migration {
  version: number;
  name: string;
  filename: string;
  checksum: string;
  sql: string;
}

export interface MigrationResult {
  version: number;
  name: string;
  status: "applied" | "already-applied";
}

interface AppliedMigrationRow {
  version: number;
  name: string;
  checksum: string;
}

export async function loadMigrations(
  migrationsDirectory: string = DEFAULT_MIGRATIONS_DIRECTORY,
): Promise<Migration[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrationFilenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));

  const migrations = await Promise.all(
    migrationFilenames.map(async (filename): Promise<Migration> => {
      const match = MIGRATION_FILE_PATTERN.exec(filename);

      if (!match) {
        throw new Error(
          `Invalid migration filename ${filename}. Expected NNN_name.sql.`,
        );
      }

      const version = Number(match[1]);

      if (!Number.isSafeInteger(version) || version <= 0) {
        throw new Error(`Migration ${filename} has an invalid version.`);
      }

      const contents = await readFile(path.join(migrationsDirectory, filename));
      const sql = contents.toString("utf8");

      if (!sql.trim()) {
        throw new Error(`Migration ${filename} is empty.`);
      }

      return {
        version,
        name: match[2],
        filename,
        checksum: createHash("sha256").update(contents).digest("hex"),
        sql,
      };
    }),
  );

  const versions = new Set<number>();

  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Migration version ${migration.version} is duplicated.`);
    }

    versions.add(migration.version);
  }

  return migrations.sort((left, right) => left.version - right.version);
}

async function acquireMigrationLock(client: PoolClient): Promise<void> {
  const result = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
    [MIGRATION_LOCK_ID],
  );

  if (!result.rows[0]?.acquired) {
    throw new Error(
      "Another migration process holds the database migration lock.",
    );
  }
}

async function releaseMigrationLock(client: PoolClient): Promise<void> {
  const result = await client.query<{ released: boolean }>(
    "SELECT pg_advisory_unlock($1::bigint) AS released",
    [MIGRATION_LOCK_ID],
  );

  if (!result.rows[0]?.released) {
    throw new Error("The database migration lock could not be released.");
  }
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      applied_by text NOT NULL DEFAULT CURRENT_USER,
      CONSTRAINT schema_migrations_version_positive_ck CHECK (version > 0),
      CONSTRAINT schema_migrations_name_not_blank_ck CHECK (btrim(name) <> ''),
      CONSTRAINT schema_migrations_checksum_ck CHECK (checksum ~ '^[0-9a-f]{64}$')
    )
  `);
}

async function readAppliedMigrations(
  client: PoolClient,
): Promise<Map<number, AppliedMigrationRow>> {
  const result = await client.query<AppliedMigrationRow>(`
    SELECT version, name, checksum
    FROM schema_migrations
    ORDER BY version
  `);

  return new Map(result.rows.map((row) => [row.version, row]));
}

async function applyMigration(
  client: PoolClient,
  migration: Migration,
): Promise<void> {
  await client.query("BEGIN");

  try {
    await client.query(migration.sql);
    await client.query(
      `
        INSERT INTO schema_migrations (version, name, checksum)
        VALUES ($1, $2, $3)
      `,
      [migration.version, migration.name, migration.checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        `Migration ${migration.filename} failed and rollback also failed.`,
      );
    }

    throw new Error(`Migration ${migration.filename} failed.`, {
      cause: error,
    });
  }
}

export async function runMigrations(
  pool: Pool = getDbPool(),
  migrations?: readonly Migration[],
): Promise<MigrationResult[]> {
  const pendingMigrations = migrations ?? (await loadMigrations());
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await acquireMigrationLock(client);
    lockAcquired = true;
    await ensureMigrationTable(client);

    const appliedMigrations = await readAppliedMigrations(client);
    const localVersions = new Set(
      pendingMigrations.map((migration) => migration.version),
    );

    for (const applied of appliedMigrations.values()) {
      if (!localVersions.has(applied.version)) {
        throw new Error(
          `Database migration ${applied.version}_${applied.name} is missing locally.`,
        );
      }
    }

    const results: MigrationResult[] = [];

    for (const migration of pendingMigrations) {
      const applied = appliedMigrations.get(migration.version);

      if (applied) {
        if (
          applied.name !== migration.name ||
          applied.checksum !== migration.checksum
        ) {
          throw new Error(
            `Applied migration ${migration.version} differs from ${migration.filename}; applied migrations are immutable.`,
          );
        }

        results.push({
          version: migration.version,
          name: migration.name,
          status: "already-applied",
        });
        continue;
      }

      await applyMigration(client, migration);
      results.push({
        version: migration.version,
        name: migration.name,
        status: "applied",
      });
    }

    return results;
  } finally {
    try {
      if (lockAcquired) {
        await releaseMigrationLock(client);
      }
    } finally {
      client.release();
    }
  }
}

function printUsage(): void {
  console.log("Usage: npx tsx scripts/migrate.ts [--dry-run]");
}

async function runCli(): Promise<void> {
  const argumentsSet = new Set(process.argv.slice(2));

  if (argumentsSet.has("--help")) {
    printUsage();
    return;
  }

  const unsupportedArguments = [...argumentsSet].filter(
    (argument) => argument !== "--dry-run",
  );

  if (unsupportedArguments.length > 0) {
    throw new Error(
      `Unsupported migration arguments: ${unsupportedArguments.join(", ")}`,
    );
  }

  const migrations = await loadMigrations();

  if (argumentsSet.has("--dry-run")) {
    for (const migration of migrations) {
      console.log(
        `[pending-check] ${migration.filename} sha256:${migration.checksum}`,
      );
    }
    return;
  }

  const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();
  if (migrationDatabaseUrl) {
    process.env.DATABASE_URL = migrationDatabaseUrl;
  }

  try {
    const results = await runMigrations(getDbPool(), migrations);

    for (const result of results) {
      console.log(`[${result.status}] ${result.version}_${result.name}`);
    }
  } finally {
    await closeDbPool();
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).toLowerCase() ===
    fileURLToPath(import.meta.url).toLowerCase();

if (isDirectExecution) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
