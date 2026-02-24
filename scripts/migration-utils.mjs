import fs from "node:fs";
import path from "node:path";

export function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error("DATABASE_URL not found. Set env var or add it to .env.local");
  }

  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(/^DATABASE_URL\s*=\s*(.+)$/m);
  if (!match) {
    throw new Error("DATABASE_URL not found in .env.local");
  }

  return match[1].trim().replace(/^['\"]|['\"]$/g, "");
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
