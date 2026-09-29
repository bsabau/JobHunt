import { connect, databaseEndpoint, isProductionDatabase, loadDatabaseUrl, runMigrations } from "./migration-utils.mjs";

// Targets DATABASE_URL (the development database). Production goes through
// `npm run migrate:prod`, which names its target and asks for confirmation.
const url = loadDatabaseUrl();

if (isProductionDatabase(url)) {
  console.error(
    `DATABASE_URL points at the production database (${databaseEndpoint(url)}). ` +
      "Use `npm run migrate:prod` to migrate production."
  );
  process.exit(1);
}

const { sql, end } = await connect(url);

try {
  await runMigrations(sql);
  console.log("Migrations complete.");
} finally {
  await end();
}
