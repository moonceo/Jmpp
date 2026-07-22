import {
  Pool,
  type PoolConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";

const globalForDatabase = globalThis as typeof globalThis & {
  jumunpangpangDatabasePool?: Pool;
};

let productionPool: Pool | undefined;

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be set before connecting to PostgreSQL.`);
  }

  return value;
}

function positiveIntegerEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = environment[name]?.trim();

  if (!value) {
    return fallback;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }

  return parsed;
}

function databaseSslConfiguration(
  environment: NodeJS.ProcessEnv,
): PoolConfig["ssl"] {
  const mode = environment.DATABASE_SSL?.trim().toLowerCase();

  if (!mode) {
    return undefined;
  }

  if (mode === "disable" || mode === "false") {
    return false;
  }

  if (mode === "require") {
    return { rejectUnauthorized: false };
  }

  if (mode === "verify-full" || mode === "true") {
    return { rejectUnauthorized: true };
  }

  throw new Error(
    "DATABASE_SSL must be one of disable, require, or verify-full.",
  );
}

export function createDatabasePoolConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  const ssl = databaseSslConfiguration(environment);
  const config: PoolConfig = {
    application_name: "jumunpangpang",
    connectionString: requiredEnvironmentValue(environment, "DATABASE_URL"),
    connectionTimeoutMillis: positiveIntegerEnvironmentValue(
      environment,
      "DATABASE_CONNECTION_TIMEOUT_MS",
      5_000,
    ),
    idleTimeoutMillis: positiveIntegerEnvironmentValue(
      environment,
      "DATABASE_IDLE_TIMEOUT_MS",
      30_000,
    ),
    max: positiveIntegerEnvironmentValue(
      environment,
      "DATABASE_POOL_MAX",
      10,
    ),
    statement_timeout: positiveIntegerEnvironmentValue(
      environment,
      "DATABASE_STATEMENT_TIMEOUT_MS",
      30_000,
    ),
  };

  if (ssl !== undefined) {
    config.ssl = ssl;
  }

  return config;
}

function createPool(): Pool {
  const pool = new Pool(createDatabasePoolConfig());

  pool.on("error", (error) => {
    console.error("Unexpected error from an idle PostgreSQL client.", error);
  });

  return pool;
}

export function getDbPool(): Pool {
  if (process.env.NODE_ENV === "production") {
    productionPool ??= createPool();
    return productionPool;
  }

  globalForDatabase.jumunpangpangDatabasePool ??= createPool();
  return globalForDatabase.jumunpangpangDatabasePool;
}

export async function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<Row>> {
  return getDbPool().query<Row>(text, [...values]);
}

export async function closeDbPool(): Promise<void> {
  const pool =
    process.env.NODE_ENV === "production"
      ? productionPool
      : globalForDatabase.jumunpangpangDatabasePool;

  if (!pool) {
    return;
  }

  if (process.env.NODE_ENV === "production") {
    productionPool = undefined;
  } else {
    globalForDatabase.jumunpangpangDatabasePool = undefined;
  }

  await pool.end();
}
