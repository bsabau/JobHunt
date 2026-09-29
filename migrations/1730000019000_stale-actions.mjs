export async function up(sql) {
  // A follow-up and a snooze are new facts that nothing else records, so they
  // are columns. Both are instants set by the server, never typed dates.
  await sql`
    ALTER TABLE applications
      ADD COLUMN IF NOT EXISTS followed_up_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;
  `;

  // When each application's stale clock started: when it entered its current
  // lane, or its latest follow-up if that came later. A follow-up made in an
  // earlier lane is thereby ignored once the card enters a new one, and no move
  // has to clear it. GREATEST() skips NULL, so a card never followed up keeps
  // its lane entry time. Time in the current lane still comes from
  // application_stage_entry.
  await sql`
    CREATE OR REPLACE VIEW application_stale_clock AS
    SELECT a.id AS application_id,
           GREATEST(e.entered_at, a.followed_up_at) AS clock_started_at,
           a.followed_up_at,
           a.snoozed_until
    FROM applications a
    JOIN application_stage_entry e ON e.application_id = a.id;
  `;
}
