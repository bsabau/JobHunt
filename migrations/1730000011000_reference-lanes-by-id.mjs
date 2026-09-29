export async function up(sql) {
  // History pointed at lanes only by name, so a lane could not be renamed and a
  // lane deleted and re-created under the same name silently inherited the old
  // history. The ids are now the reference; from_status / to_status stay as the
  // lane's name, kept in step on rename and still readable once the lane is
  // deleted (ON DELETE SET NULL leaves the id empty and the name intact).
  await sql`
    ALTER TABLE application_transitions
      ADD COLUMN IF NOT EXISTS from_stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS to_stage_id   INTEGER REFERENCES stages(id) ON DELETE SET NULL;
  `;

  // Lane names are unique, so a name identifies at most one current lane.
  // Names with no lane any more stay NULL, which the queries treat as history
  // of a deleted lane. Only unset ids are touched, so an immediate re-run
  // changes nothing; but once a lane has been deleted and another created
  // under its name, re-running this would attach the old history to the new
  // lane. schema_migrations makes sure it runs once.
  await sql`
    UPDATE application_transitions t
    SET from_stage_id = s.id
    FROM stages s
    WHERE t.from_stage_id IS NULL AND s.name = t.from_status;
  `;
  await sql`
    UPDATE application_transitions t
    SET to_stage_id = s.id
    FROM stages s
    WHERE t.to_stage_id IS NULL AND s.name = t.to_status;
  `;

  // Analytics join on to_stage_id; a rename rewrites names by both ids.
  await sql`CREATE INDEX IF NOT EXISTS application_transitions_to_stage_idx ON application_transitions (to_stage_id);`;
  await sql`CREATE INDEX IF NOT EXISTS application_transitions_from_stage_idx ON application_transitions (from_stage_id);`;
}
