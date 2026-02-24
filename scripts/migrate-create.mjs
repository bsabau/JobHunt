import fs from "node:fs";
import path from "node:path";

const name = process.argv.slice(2).join("-").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
if (!name) {
  console.error("Usage: npm run migrate:create -- <migration-name>");
  process.exit(1);
}

const migrationsDir = path.join(process.cwd(), "migrations");
fs.mkdirSync(migrationsDir, { recursive: true });

const timestamp = Date.now();
const file = `${timestamp}_${name}.mjs`;
const filePath = path.join(migrationsDir, file);

const template = `export async function up(sql) {
  // await sql\`...\`;
}
`;

fs.writeFileSync(filePath, template, "utf8");
console.log(`Created migration: migrations/${file}`);
