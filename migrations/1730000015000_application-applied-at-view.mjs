export async function up(sql) {
  // When an application was sent. A card that entered the pipeline in an
  // intake lane (a wishlist) was applied to when it first moved into a lane of
  // another kind; until then applied_at is NULL. Any other card counts as
  // applied when it was created. A deleted lane has no known kind: as an
  // entry lane the card counts from its creation, and a move into one counts
  // as sending it, since nearly every lane a card moves into is a pipeline
  // lane.
  await sql`
    CREATE OR REPLACE VIEW application_applied_at AS
    SELECT a.id AS application_id,
           CASE
             WHEN entry_lane.kind = 'intake' THEN (
               SELECT MIN(t.transitioned_at)
               FROM application_transitions t
               LEFT JOIN stages to_lane ON to_lane.id = t.to_stage_id
               WHERE t.application_id = a.id AND to_lane.kind IS DISTINCT FROM 'intake'
             )
             ELSE a.created_at
           END AS applied_at
    FROM applications a
    JOIN application_entry_stage e ON e.application_id = a.id
    LEFT JOIN stages entry_lane ON entry_lane.id = e.stage_id;
  `;
}
