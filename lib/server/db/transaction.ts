import type { Pool, PoolClient } from "pg";

import { getDbPool } from "@/lib/server/db/pool";

export type TransactionIsolationLevel =
  | "READ COMMITTED"
  | "REPEATABLE READ"
  | "SERIALIZABLE";

export interface TransactionOptions {
  isolationLevel?: TransactionIsolationLevel;
  readOnly?: boolean;
  deferrable?: boolean;
}

export type TransactionClient = PoolClient;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function beginStatement(options: TransactionOptions): string {
  const isolationLevel = options.isolationLevel ?? "READ COMMITTED";
  const readMode = options.readOnly ? "READ ONLY" : "READ WRITE";

  if (
    options.deferrable &&
    (!options.readOnly || isolationLevel !== "SERIALIZABLE")
  ) {
    throw new Error(
      "A deferrable transaction must be SERIALIZABLE and READ ONLY.",
    );
  }

  return [
    "BEGIN",
    `ISOLATION LEVEL ${isolationLevel}`,
    readMode,
    options.deferrable ? "DEFERRABLE" : "NOT DEFERRABLE",
  ].join(" ");
}

export async function withTransaction<Result>(
  operation: (client: TransactionClient) => Promise<Result>,
  options: TransactionOptions = {},
  pool: Pool = getDbPool(),
): Promise<Result> {
  const client = await pool.connect();

  try {
    await client.query(beginStatement(options));

    try {
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "The transaction failed and PostgreSQL also rejected the rollback.",
        );
      }

      throw error;
    }
  } finally {
    client.release();
  }
}

export async function withTenantTransaction<Result>(
  tenantId: string,
  operation: (client: TransactionClient) => Promise<Result>,
  options: TransactionOptions = {},
  pool: Pool = getDbPool(),
): Promise<Result> {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error("tenantId must be a valid UUID.");
  }

  return withTransaction(
    async (client) => {
      await client.query(
        "SELECT set_config('app.current_tenant_id', $1, true)",
        [tenantId],
      );

      return operation(client);
    },
    options,
    pool,
  );
}
