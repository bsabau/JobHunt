export async function up(sql) {
  // Replaces the view from 1730000015000: leaving intake straight for a
  // rejected or closed lane (dropped from the wishlist) is not sending the
  // application, so only a move into a pipeline lane counts. Same columns,
  // so CREATE OR REPLACE is enough.
  await sql`
    CREATE OR REPLACE VIEW application_applied_at AS
    SELECT a.id AS application_id,
           CASE
             WHEN entry_lane.kind = 'intake' THEN (
               SELECT MIN(t.transitioned_at)
               FROM application_transitions t
               LEFT JOIN stages to_lane ON to_lane.id = t.to_stage_id
               WHERE t.application_id = a.id
                 AND (to_lane.kind IS NULL OR to_lane.kind NOT IN ('intake', 'rejected', 'closed'))
             )
             ELSE a.created_at
           END AS applied_at
    FROM applications a
    JOIN application_entry_stage e ON e.application_id = a.id
    LEFT JOIN stages entry_lane ON entry_lane.id = e.stage_id;
  `;
}
