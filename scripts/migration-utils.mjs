import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@neondatabase/serverless";

// Reads a setting from the environment, falling back to .env.local.
export function loadEnvValue(name) {
  if (process.env[name]) {
    return process.env[name];
  }

  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    return undefined;
  }

  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, "m"));
  return match ? match[1].trim().replace(/^['"]|['"]$/g, "") : undefined;
}

export function loadDatabaseUrl() {
  const url = loadEnvValue("DATABASE_URL");
  if (!url) {
    throw new Error("DATABASE_URL not found. Set env var or add it to .env.local");
  }
  return url;
}

// Neon serves one database through a direct and a pooled host (`ep-x…` and
// `ep-x…-pooler`), so comparing whole connection strings can miss a match.
// The endpoint id identifies the database however it is addressed.
export function databaseEndpoint(url) {
  const host = new URL(url).hostname;
  return host.split(".")[0].replace(/-pooler$/, "");
}

// true / false when PRODUCTION_DATABASE_URL is known, undefined when it is not,
// so destructive scripts can refuse when they cannot tell.
export function isProductionDatabase(url) {
  const production = loadEnvValue("PRODUCTION_DATABASE_URL");
  if (!production) {
    return undefined;
  }
  return databaseEndpoint(url) === databaseEndpoint(production);
}

export function getMigrationFiles() {
  const migrationsDir = path.join(process.cwd(), "migrations");
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".mjs"))
    .sort()
    .map((file) => ({
      file,
      absPath: path.join(migrationsDir, file)
    }));
}

// Migrations run over a WebSocket `Client`, not the HTTP `neon()` function:
// the HTTP driver executes every statement in its own auto-committed request,
// so BEGIN / COMMIT / ROLLBACK sent through it are no-ops and a failing
// migration would leave partial changes behind. A single session gives each
// migration a real transaction.
export async function connect(url) {
  const client = new Client({ connectionString: url });
  await client.connect();

  // Tagged-template adapter with the same shape migrations already use:
  // `await sql\`... ${value} ...\`` resolves to the result rows.
  async function sql(strings, ...values) {
    const text = strings.reduce((query, part, index) => `${query}$${index}${part}`);
    const result = await client.query(text, values);
    return result.rows;
  }

  return { sql, end: () => client.end() };
}

// Applies every migration file not yet recorded in schema_migrations, each in
// its own transaction. `sql` is a tagged-template function returning rows.
export async function runMigrations(sql, log = console.log) {
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

  for (const migration of getMigrationFiles()) {
    if (applied.has(migration.file)) {
      continue;
    }

    const mod = await import(pathToFileURL(path.resolve(migration.absPath)).href);

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
      log(`Applied: ${migration.file}`);
    } catch (error) {
      await sql`ROLLBACK`;
      throw error;
    }
  }
}
