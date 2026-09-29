export async function up(sql) {
  // Early versions recorded creation as a transition from a synthetic
  // "created" lane. None remain in production; deleting them here makes that
  // a guarantee for every copy, so queries no longer need to filter them out.
  await sql`
    DELETE FROM application_transitions
    WHERE LOWER(from_status) = 'created' OR LOWER(to_status) = 'created';
  `;

  // A move from a lane to itself carries no information and the move
  // statement never writes one. Remove any that older code left behind, then
  // forbid them. This comes after the cleanup above, which also removes the
  // legacy "created -> created" rows.
  await sql`DELETE FROM application_transitions WHERE from_status = to_status;`;
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'application_transitions'::regclass AND conname = 'application_transitions_no_self_loop'
      ) THEN
        ALTER TABLE application_transitions
        ADD CONSTRAINT application_transitions_no_self_loop CHECK (from_status <> to_status);
      END IF;
    END $$;
  `;
}
