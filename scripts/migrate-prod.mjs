import readline from "node:readline/promises";
import { connect, databaseEndpoint, loadEnvValue, runMigrations } from "./migration-utils.mjs";

// Applies pending migrations to production. The operator has to name the
// production endpoint, either interactively or with --confirm=<endpoint>, so a
// migration never reaches production by habit.
const url = loadEnvValue("PRODUCTION_DATABASE_URL");

if (!url) {
  console.error("PRODUCTION_DATABASE_URL is not set (environment or .env.local).");
  process.exit(1);
}

const endpoint = databaseEndpoint(url);
console.log(`Target: PRODUCTION database ${endpoint}`);

const flag = process.argv.find((arg) => arg.startsWith("--confirm="));
let confirmation = flag?.slice("--confirm=".length);

if (confirmation === undefined && process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  confirmation = (await rl.question(`Type ${endpoint} to apply pending migrations: `)).trim();
  rl.close();
}

if (confirmation !== endpoint) {
  console.error(`Not confirmed. Re-run with --confirm=${endpoint} or type the endpoint when asked.`);
  process.exit(1);
}

const { sql, end } = await connect(url);

try {
  await runMigrations(sql);
  console.log("Production migrations complete.");
} finally {
  await end();
}
