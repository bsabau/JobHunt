// Read statements about single applications, kept free of runtime imports so
// the tests can run the exact text against an in-process Postgres
// (tests/timeline.test.mjs). src/lib/db executes it through `sql.query()`.

import type { SqlStatement } from "@/lib/stage-statements";

// The application's current path: the lane it entered in (from the view
// application_entry_stage, entered at its creation) and every lane it moved
// into since, in path order. One row, the steps as JSON, so the path is read in
// one round trip. Lanes are joined by id; a deleted lane keeps its stored name
// with " (deleted)", as the charts show it, and has no id or kind. No row when
// the application does not exist.
export function applicationTimelineStatement(applicationId: number): SqlStatement {
  return {
    text: `
      SELECT a.created_at,
             e.stage_id AS entry_stage_id,
             CASE WHEN es.id IS NULL THEN e.stage_name || ' (deleted)' ELSE es.name END AS entry_stage_name,
             es.kind AS entry_stage_kind,
             COALESCE((
               SELECT json_agg(
                        json_build_object(
                          'stage_id', ts.id,
                          'stage_name', CASE WHEN ts.id IS NULL THEN t.to_status || ' (deleted)' ELSE ts.name END,
                          'stage_kind', ts.kind,
                          'transitioned_at', t.transitioned_at
                        )
                        ORDER BY t.transitioned_at, t.id
                      )
               FROM application_transitions t
               LEFT JOIN stages ts ON ts.id = t.to_stage_id
               WHERE t.application_id = a.id
             ), '[]'::json) AS steps
      FROM applications a
      JOIN application_entry_stage e ON e.application_id = a.id
      LEFT JOIN stages es ON es.id = e.stage_id
      WHERE a.id = $1;
    `,
    params: [applicationId]
  };
}
