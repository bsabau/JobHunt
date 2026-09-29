import { DEFAULT_STAGES } from "../src/lib/stage-kinds.ts";
import { connect, databaseEndpoint, isProductionDatabase, loadDatabaseUrl, runMigrations } from "./migration-utils.mjs";

// Destructive: empties every table in DATABASE_URL and seeds the default
// lanes. It refuses to run without --yes, against production, or when it
// cannot tell whether the target is production.
const url = loadDatabaseUrl();
const endpoint = databaseEndpoint(url);
console.log(`Target: ${endpoint}`);

const production = isProductionDatabase(url);

if (production === undefined) {
  console.error(
    "Refusing: PRODUCTION_DATABASE_URL is not set, so this script cannot tell whether the target is production."
  );
  process.exit(1);
}

if (production) {
  console.error("Refusing: DATABASE_URL points at the production database.");
  process.exit(1);
}

if (!process.argv.includes("--yes")) {
  console.error(`This deletes every application, transition and lane in ${endpoint}. Re-run with --yes to proceed.`);
  process.exit(1);
}

const { sql, end } = await connect(url);

try {
  // The migrations are the only definition of the schema; running them first
  // also builds it on an empty database.
  await runMigrations(sql);
  await sql`TRUNCATE TABLE application_transitions, applications, stages RESTART IDENTITY CASCADE;`;

  for (const [index, stage] of DEFAULT_STAGES.entries()) {
    await sql`INSERT INTO stages (name, sort_order, kind) VALUES (${stage.name}, ${index}, ${stage.kind});`;
  }

  console.log(`Database ${endpoint} reset with ${DEFAULT_STAGES.length} default lanes.`);
} finally {
  await end();
}
