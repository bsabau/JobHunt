import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@neondatabase/serverless";
import { getMigrationFiles, loadDatabaseUrl } from "./migration-utils.mjs";

// Migrations run over a WebSocket `Client`, not the HTTP `neon()` function:
// the HTTP driver executes every statement in its own auto-committed request,
// so BEGIN / COMMIT / ROLLBACK sent through it are no-ops and a failing
// migration would leave partial changes behind. A single session gives each
// migration a real transaction.
const client = new Client({ connectionString: loadDatabaseUrl() });
await client.connect();

// Tagged-template adapter with the same shape migrations already use:
// `await sql\`... ${value} ...\`` resolves to the result rows.
async function sql(strings, ...values) {
  const text = strings.reduce((query, part, index) => `${query}$${index}${part}`);
  const result = await client.query(text, values);
  return result.rows;
}

try {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  const appliedRows = await sql`
    SELECT filename
    FROM schema_migrations;
  `;

  const applied = new Set(appliedRows.map((row) => String(row.filename)));
  const files = getMigrationFiles();

  for (const migration of files) {
    if (applied.has(migration.file)) {
      continue;
    }

    const moduleUrl = pathToFileURL(path.resolve(migration.absPath)).href;
    const mod = await import(moduleUrl);

    if (typeof mod.up !== "function") {
      throw new Error(`Migration ${migration.file} does not export an 'up' function`);
    }

    await sql`BEGIN`;
    try {
      await mod.up(sql);
      await sql`
        INSERT INTO schema_migrations (filename)
        VALUES (${migration.file});
      `;
      await sql`COMMIT`;
      console.log(`Applied: ${migration.file}`);
    } catch (error) {
      await sql`ROLLBACK`;
      throw error;
    }
  }

  console.log("Migrations complete.");
} finally {
  await client.end();
}
