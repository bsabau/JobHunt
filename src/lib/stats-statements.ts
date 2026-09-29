// Statements for the stats page, loadable straight from Node so the tests can
// run the exact text against an in-process Postgres
// (tests/milestones.test.mjs). src/lib/db/stats.ts runs them inside the
// page's one read-only snapshot with `tx.query()`.

import { type SqlStatement, compileSql, sqlFragment } from "./stage-statements.ts";
import { CLOSED_KIND } from "./stage-kinds.ts";

// The driver returns numeric aggregates (AVG) as strings.
export interface MilestoneStatsRow {
  applied: number;
  responded: number;
  interviewed: number;
  offered: number;
  ghosted: number;
  avg_days_to_interview: string | null;
  interview_count: number;
}

// One row over the applications that were sent (applied_at is set): how many
// got a reply, reached an interview, got an offer, and sit in a closed lane
// now (ghosted), plus the average days from sending to the first interview.
// Every count shares the same denominator, `applied`.
export function milestoneStatsStatement(): SqlStatement {
  return compileSql(sqlFragment`
    SELECT COUNT(*)::int AS applied,
           COUNT(*) FILTER (WHERE m.responded)::int AS responded,
           COUNT(*) FILTER (WHERE m.interviewed)::int AS interviewed,
           COUNT(*) FILTER (WHERE m.offered)::int AS offered,
           COUNT(*) FILTER (WHERE s.kind = ${CLOSED_KIND})::int AS ghosted,
           AVG(EXTRACT(EPOCH FROM (m.first_interview_at - m.applied_at)) / 86400.0) AS avg_days_to_interview,
           COUNT(m.first_interview_at)::int AS interview_count
    FROM application_milestones m
    JOIN applications a ON a.id = m.application_id
    JOIN stages s ON s.id = a.stage_id
    WHERE m.applied_at IS NOT NULL;
  `);
}

// Applications sent per week, by applied date: the Monday that starts the week
// in the viewer's zone (`zone` is validated by normalizeTimeZone()), as a
// YYYY-MM-DD string. Weeks without applications are absent; fillWeeks() in
// weeks.ts adds them.
export function weeklySentStatement(zone: string): SqlStatement {
  return compileSql(sqlFragment`
    SELECT to_char(date_trunc('week', p.applied_at AT TIME ZONE ${zone})::date, 'YYYY-MM-DD') AS week_start,
           COUNT(*)::int AS sent
    FROM application_applied_at p
    WHERE p.applied_at IS NOT NULL
    GROUP BY 1
    ORDER BY 1;
  `);
}

export interface TimeToHearBackRow {
  reply_median_days: number | null;
  reply_count: number;
  rejection_median_days: number | null;
  rejection_count: number;
}

// Median days from sending an application to its first reply, and to its
// rejection, over the sent applications where both times are known. A card
// that entered straight in an interview, offer or rejected lane replied at an
// unknown time and is left out, as is a rejection dated before the sending
// (possible when a lane the card passed is later made a rejected lane). The
// medians are cast to double precision, which the driver returns as a number
// (numeric would arrive as a string).
export function timeToHearBackStatement(): SqlStatement {
  return compileSql(sqlFragment`
    SELECT (percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (m.responded_at - m.applied_at))::double precision / 86400
            ) FILTER (WHERE m.responded_at IS NOT NULL))::double precision AS reply_median_days,
           COUNT(*) FILTER (WHERE m.responded_at IS NOT NULL)::int AS reply_count,
           (percentile_cont(0.5) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (m.rejected_at - m.applied_at))::double precision / 86400
            ) FILTER (WHERE m.rejected_at >= m.applied_at))::double precision AS rejection_median_days,
           COUNT(*) FILTER (WHERE m.rejected_at >= m.applied_at)::int AS rejection_count
    FROM application_milestones m
    WHERE m.applied_at IS NOT NULL;
  `);
}
