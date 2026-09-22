import { neon } from "@neondatabase/serverless";
import { loadDatabaseUrl } from "./migration-utils.mjs";

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
