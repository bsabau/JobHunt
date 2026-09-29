import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunctionInTransaction } from "@neondatabase/serverless";

// Connection, error helpers and the schema guard shared by every db module.

export function hasPgCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

export function pgConstraint(error: unknown): string | undefined {
  const value = typeof error === "object" && error !== null ? (error as { constraint?: unknown }).constraint : undefined;
  return typeof value === "string" ? value : undefined;
}

// A stage can be deleted between the "does it exist" check and the write that
// references it. The FK violation that follows is a caller-visible state
// change, not a server fault, so it maps to the same error as the check.
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

export function transaction(queries: (tx: TransactionSql) => TransactionQuery[]) {
  return getSql().transaction((tx) => queries(tx));
}

let schemaReadyPromise: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const checks = (await sql`
        SELECT
          EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'stages'
          ) AS has_stages,
          EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'applications'
          ) AS has_applications,
          EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'application_transitions'
          ) AS has_application_transitions,
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'stages' AND column_name = 'kind'
          ) AS has_stage_kind,
          EXISTS (
            SELECT 1
            FROM information_schema.views
            WHERE table_schema = 'public' AND table_name = 'application_entry_stage'
          ) AS has_entry_stage_view;
      `) as Record<string, unknown>[];

      const row = checks[0];
      if (
        !row.has_stages ||
        !row.has_applications ||
        !row.has_application_transitions ||
        !row.has_stage_kind ||
        !row.has_entry_stage_view
      ) {
        throw new Error("Database schema is missing or outdated. Run `npm run migrate:up`.");
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
