import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunctionInTransaction } from "@neondatabase/serverless";
import { LATEST_MIGRATION } from "./schema-version";

// Connection, error helpers and the schema guard shared by every db module.

export function hasPgCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

export function pgConstraint(error: unknown): string | undefined {
  const value = typeof error === "object" && error !== null ? (error as { constraint?: unknown }).constraint : undefined;
  return typeof value === "string" ? value : undefined;
}

// A write that names a lane that does not exist (never did, or was just
// deleted) fails the stage_id foreign key. That is a caller error, not a
// server fault: moves and edits rely on it instead of checking the lane first,
// and createApplication uses it for a lane deleted after its own check.
export function isStageForeignKeyViolation(error: unknown): boolean {
  return hasPgCode(error, "23503") && (pgConstraint(error)?.includes("stage_id") ?? true);
}

type SqlClient = ReturnType<typeof neon>;
type TransactionSql = NeonQueryFunctionInTransaction<boolean, boolean>;
type TransactionQuery = ReturnType<TransactionSql>;

let sqlClient: SqlClient | null = null;

export function getSql(): SqlClient {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  sqlClient ??= neon(databaseUrl);
  return sqlClient;
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return getSql()(strings, ...values);
}

type TransactionOptions = Parameters<SqlClient["transaction"]>[1];

// Sends the queries as one request in one transaction. Pass
// { readOnly: true, isolationLevel: "RepeatableRead" } for reads that must
// agree with each other (one snapshot).
export function transaction(queries: (tx: TransactionSql) => TransactionQuery[], options?: TransactionOptions) {
  return getSql().transaction((tx) => queries(tx), options);
}

let schemaReadyPromise: Promise<void> | null = null;

// Checks once per process that the database has every migration this code
// needs (LATEST_MIGRATION), so a missed `migrate:prod` fails with a clear
// message instead of a missing column deep in some query. A database that is
// ahead of the code passes: the deploy runbook migrates before merging.
export async function ensureSchema(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      let newest: string | null = null;
      try {
        const rows = (await sql`SELECT MAX(filename) AS newest FROM schema_migrations;`) as Record<string, unknown>[];
        newest = rows[0]?.newest == null ? null : String(rows[0].newest);
      } catch (error) {
        // 42P01: schema_migrations does not exist, so nothing was ever migrated.
        if (!hasPgCode(error, "42P01")) {
          throw error;
        }
      }

      if (newest === null || newest < LATEST_MIGRATION) {
        throw new Error(
          `Database schema is behind the code (has ${newest ?? "no migrations"}, needs ${LATEST_MIGRATION}). ` +
            "Run `npm run migrate:up` (or `npm run migrate:prod` for production)."
        );
      }
    })();
  }

  try {
    await schemaReadyPromise;
  } catch (error) {
    // A transient first request failure must not poison this process forever.
    schemaReadyPromise = null;
    throw error;
  }
}
