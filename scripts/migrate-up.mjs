import path from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { getMigrationFiles, loadDatabaseUrl } from "./migration-utils.mjs";

const sql = neon(loadDatabaseUrl());

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
