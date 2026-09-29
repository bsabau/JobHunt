export async function up(sql) {
  // Postgres does not index foreign keys. The "latest / first transition of an
  // application" subqueries probe application_transitions per application, in
  // both sort directions, which this three-column index serves.
  await sql`
    CREATE INDEX IF NOT EXISTS application_transitions_app_time_idx
    ON application_transitions (application_id, transitioned_at, id);
  `;

  // Lane counts and the "is this lane empty" check on delete.
  await sql`
    CREATE INDEX IF NOT EXISTS applications_stage_id_idx
    ON applications (stage_id);
  `;
}
