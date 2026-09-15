import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";

function loadDatabaseUrl() {
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

const databaseUrl = loadDatabaseUrl();
const sql = neon(databaseUrl);
const defaults = [
  ["Wishlist", "intake"],
  ["Applied", "active"],
  ["Interview", "interview"],
  ["Offer", "offer"],
  ["Rejected", "rejected"]
];

await sql`
  CREATE TABLE IF NOT EXISTS stages (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'active'
  );
`;

await sql`
  CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY,
    company TEXT NOT NULL,
    role TEXT NOT NULL,
    notes TEXT,
    interview_date DATE,
    source_url TEXT,
    logo_url TEXT,
    stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

await sql`
  CREATE TABLE IF NOT EXISTS application_transitions (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

await sql`TRUNCATE TABLE application_transitions, applications, stages RESTART IDENTITY CASCADE;`;

for (const [idx, [name, kind]] of defaults.entries()) {
  await sql`INSERT INTO stages (name, sort_order, kind) VALUES (${name}, ${idx}, ${kind});`;
}

console.log("Database reset complete with default stages.");
