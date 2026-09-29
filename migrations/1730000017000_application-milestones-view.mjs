export async function up(sql) {
  // Whether and when each application got a reply, an interview, an offer or a
  // rejection, defined once for the stats. Derived from the current path, like
  // the other views: a stored copy would need updating by every move, rewind,
  // lane delete and kind change.
  //
  // - The reply is the first edge after the application was sent whose target
  //   is not a wishlist (intake) and not closed: closing is the owner giving
  //   up, not an answer. A rejection is an answer. For a card that entered in
  //   an intake lane, "after it was sent" means after its first edge into a
  //   pipeline lane (the edge application_applied_at dates it by), compared by
  //   (transitioned_at, id) because a rewind's reconnect edge reuses a
  //   boundary's time. An edge into a deleted lane counts, as in
  //   application_applied_at.
  // - A card that entered straight in an interview, offer or rejected lane had
  //   its answer at an unknown time: the booleans are true, the times NULL. An
  //   interview or an offer also implies a reply, even when the only edge
  //   before it was the one that sent the application.
  await sql`
    CREATE OR REPLACE VIEW application_milestones AS
    SELECT a.id AS application_id,
           p.applied_at,
           (reply.transitioned_at IS NOT NULL
             OR firsts.first_interview_at IS NOT NULL
             OR firsts.offered_at IS NOT NULL
             OR entry_lane.kind IN ('interview', 'offer', 'rejected')) AS responded,
           reply.transitioned_at AS responded_at,
           (firsts.first_interview_at IS NOT NULL OR entry_lane.kind = 'interview') AS interviewed,
           firsts.first_interview_at,
           (firsts.offered_at IS NOT NULL OR entry_lane.kind = 'offer') AS offered,
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
