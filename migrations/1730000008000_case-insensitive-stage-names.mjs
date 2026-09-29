export async function up(sql) {
  // stages_name_key is case-sensitive, so "Applied" and "applied" could both
  // exist while the reserved-name check, chart colours and backfills all
  // compare lowercase. addStage maps a violation to the same 409 as a duplicate.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS stages_name_lower_key
    ON stages (LOWER(name));
  `;
}
