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

const sql = neon(loadDatabaseUrl());

const beforeRows = await sql`
  SELECT COUNT(*)::int AS count
  FROM application_transitions
  WHERE LOWER(from_status) = LOWER(${"created"})
     OR LOWER(to_status) = LOWER(${"created"});
`;

const deletedRows = await sql`
  DELETE FROM application_transitions
  WHERE LOWER(from_status) = LOWER(${"created"})
     OR LOWER(to_status) = LOWER(${"created"})
  RETURNING id;
`;

const afterRows = await sql`
  SELECT COUNT(*)::int AS count
  FROM application_transitions
  WHERE LOWER(from_status) = LOWER(${"created"})
     OR LOWER(to_status) = LOWER(${"created"});
`;

console.log(
  JSON.stringify({
    before: Number(beforeRows[0].count),
    deleted: deletedRows.length,
    after: Number(afterRows[0].count)
  })
);
