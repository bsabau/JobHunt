export async function up(sql) {
  // The no-self-loop check compared names. With history referring to lanes by
  // id, "Screening (deleted) -> Screening" is a real move between two lanes
  // that share a name, and must be storable. Compare ids instead; an edge with
  // a deleted end (NULL id) cannot be a self-loop between live lanes.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'application_transitions'::regclass AND conname = 'application_transitions_distinct_lanes'
      ) THEN
        ALTER TABLE application_transitions
        ADD CONSTRAINT application_transitions_distinct_lanes
        CHECK (from_stage_id IS NULL OR to_stage_id IS NULL OR from_stage_id <> to_stage_id);
      END IF;
    END $$;
  `;
  await sql`ALTER TABLE application_transitions DROP CONSTRAINT IF EXISTS application_transitions_no_self_loop;`;
}
