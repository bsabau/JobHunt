export async function up(sql) {
  // Replaces the view from 1730000017000 with the same columns. A card whose
  // entry lane was deleted has no entry kind, so "entry_lane.kind = ..." was
  // NULL and the flags could be NULL instead of false; a later
  // "WHERE NOT responded" would then skip those cards. The flags are now
  // always true or false.
  await sql`
    CREATE OR REPLACE VIEW application_milestones AS
    SELECT a.id AS application_id,
           p.applied_at,
           (reply.transitioned_at IS NOT NULL
             OR firsts.first_interview_at IS NOT NULL
             OR firsts.offered_at IS NOT NULL
             OR COALESCE(entry_lane.kind IN ('interview', 'offer', 'rejected'), false)) AS responded,
           reply.transitioned_at AS responded_at,
           (firsts.first_interview_at IS NOT NULL OR COALESCE(entry_lane.kind = 'interview', false)) AS interviewed,
           firsts.first_interview_at,
           (firsts.offered_at IS NOT NULL OR COALESCE(entry_lane.kind = 'offer', false)) AS offered,
           firsts.offered_at,
           firsts.rejected_at
    FROM applications a
    JOIN application_applied_at p ON p.application_id = a.id
    JOIN application_entry_stage e ON e.application_id = a.id
    LEFT JOIN stages entry_lane ON entry_lane.id = e.stage_id
    LEFT JOIN LATERAL (
      SELECT t.transitioned_at, t.id
      FROM application_transitions t
      LEFT JOIN stages to_lane ON to_lane.id = t.to_stage_id
      WHERE entry_lane.kind = 'intake'
        AND t.application_id = a.id
        AND (to_lane.kind IS NULL OR to_lane.kind NOT IN ('intake', 'rejected', 'closed'))
      ORDER BY t.transitioned_at, t.id
      LIMIT 1
    ) sent_edge ON true
    LEFT JOIN LATERAL (
      SELECT t.transitioned_at
      FROM application_transitions t
      LEFT JOIN stages to_lane ON to_lane.id = t.to_stage_id
      WHERE t.application_id = a.id
        AND (to_lane.kind IS NULL OR to_lane.kind NOT IN ('intake', 'closed'))
        AND (
          entry_lane.kind IS DISTINCT FROM 'intake'
          OR (sent_edge.id IS NOT NULL AND (t.transitioned_at, t.id) > (sent_edge.transitioned_at, sent_edge.id))
        )
      ORDER BY t.transitioned_at, t.id
      LIMIT 1
    ) reply ON true
    LEFT JOIN LATERAL (
      SELECT MIN(t.transitioned_at) FILTER (WHERE to_lane.kind = 'interview') AS first_interview_at,
             MIN(t.transitioned_at) FILTER (WHERE to_lane.kind = 'offer') AS offered_at,
             MIN(t.transitioned_at) FILTER (WHERE to_lane.kind = 'rejected') AS rejected_at
      FROM application_transitions t
      JOIN stages to_lane ON to_lane.id = t.to_stage_id
      WHERE t.application_id = a.id
    ) firsts ON true;
  `;
}
