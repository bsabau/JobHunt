// Read statements about single applications, loadable straight from Node so
// the tests can run the exact text against an in-process Postgres
// (tests/timeline.test.mjs). The only runtime import is another such module,
// by relative path with its extension, which Node's type stripping resolves.
// src/lib/db executes the compiled text through `sql.query()`.

import { type SqlStatement, compileSql, sqlFragment } from "./stage-statements.ts";

// The application's current path: the lane it entered in (from the view
// application_entry_stage, entered at its creation) and every lane it moved
// into since, in path order. One row, the steps as JSON, so the path is read in
// one round trip. Lanes are joined by id; a deleted lane keeps its stored name
// with " (deleted)", as the charts show it, and has no id or kind. No row when
// the application does not exist.
export function applicationTimelineStatement(applicationId: number): SqlStatement {
  return compileSql(sqlFragment`
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
      WHERE a.id = ${applicationId};
    `);
}

export type StaleAction = "followed_up" | "snooze" | "unsnooze" | "unfollow";

// How long a snooze hides a stale application.
export const SNOOZE_DAYS = 7;

// Records what the owner did about a stale application, at `now`: a follow-up
// restarts the stale clock (and ends a snooze), a snooze hides the card for
// SNOOZE_DAYS. The two undos touch one field each: "unsnooze" ends a snooze
// and keeps any follow-up, "unfollow" removes the follow-up (offered only
// where there was none before, since it cannot bring an older one back).
// updated_at stays: it orders the board, and a follow-up must not move the
// card to the top. Returns the id, or no row for an unknown application.
export function staleActionStatement(applicationId: number, action: StaleAction, now: string): SqlStatement {
  return compileSql(sqlFragment`
    UPDATE applications
    SET followed_up_at = CASE ${action}::text
          WHEN 'followed_up' THEN ${now}::timestamptz
          WHEN 'unfollow' THEN NULL
          ELSE followed_up_at
        END,
        snoozed_until = CASE ${action}::text
          WHEN 'snooze' THEN ${now}::timestamptz + make_interval(days => ${SNOOZE_DAYS})
          WHEN 'followed_up' THEN NULL
          WHEN 'unsnooze' THEN NULL
          ELSE snoozed_until
        END
    WHERE id = ${applicationId}
    RETURNING id;
  `);
}

export interface InterviewEventRow {
  company: string;
  role: string;
  source_url: string | null;
  interview_date: string | null;
  // The interview's instant, computed by Postgres from the date, the time and
  // its zone (so a clock change is handled by the database), or null when no
  // time is set.
  starts_at: string | Date | null;
}

// What the calendar file needs about one application. Never notes or salary:
// a calendar is often shared or synced elsewhere. No row for an unknown one.
export function interviewEventStatement(applicationId: number): SqlStatement {
  return compileSql(sqlFragment`
    SELECT a.company, a.role, a.source_url,
           to_char(a.interview_date, 'YYYY-MM-DD') AS interview_date,
           CASE WHEN a.interview_time IS NULL THEN NULL
                ELSE (a.interview_date + a.interview_time) AT TIME ZONE a.interview_time_zone
           END AS starts_at
    FROM applications a
    WHERE a.id = ${applicationId};
  `);
}
