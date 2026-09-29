export async function up(sql) {
  // The lane an application entered the pipeline in: where its first edge
  // starts, or its current lane when it has no history. Defined once here
  // instead of in the move statement, the Sankey and the funnel. When the
  // entry lane has been deleted, stage_id is NULL and stage_name keeps its
  // last name. (Chosen over an entry_stage_id column, which would lose that
  // name on delete and need keeping in step with every move and rename.)
  await sql`
    CREATE OR REPLACE VIEW application_entry_stage AS
    SELECT a.id AS application_id,
           CASE WHEN first_edge.application_id IS NULL THEN a.stage_id ELSE first_edge.from_stage_id END AS stage_id,
           CASE WHEN first_edge.application_id IS NULL THEN s.name ELSE first_edge.from_status END AS stage_name
    FROM applications a
    JOIN stages s ON s.id = a.stage_id
    LEFT JOIN LATERAL (
      SELECT t.application_id, t.from_stage_id, t.from_status
      FROM application_transitions t
      WHERE t.application_id = a.id
      ORDER BY t.transitioned_at ASC, t.id ASC
      LIMIT 1
    ) first_edge ON true;
  `;
}
