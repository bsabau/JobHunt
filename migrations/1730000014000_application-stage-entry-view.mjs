export async function up(sql) {
  // When an application entered the lane it is in now: its latest move into
  // that lane, or its creation when it never moved into it (it was created
  // there, or rewound to its entry lane). Defined once here instead of in the
  // applications query, the stale list and the average time in lane.
  await sql`
    CREATE OR REPLACE VIEW application_stage_entry AS
    SELECT a.id AS application_id,
           COALESCE(last_entry.transitioned_at, a.created_at) AS entered_at
    FROM applications a
    LEFT JOIN LATERAL (
      SELECT t.transitioned_at
      FROM application_transitions t
      WHERE t.application_id = a.id AND t.to_stage_id = a.stage_id
      ORDER BY t.transitioned_at DESC, t.id DESC
      LIMIT 1
    ) last_entry ON true;
  `;
}
