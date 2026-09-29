// Statements for the stats page, loadable straight from Node so the tests can
// run the exact text against an in-process Postgres
// (tests/stats-statements.test.mjs). src/lib/db/stats.ts runs them inside the
// page's one read-only snapshot with `tx.query()`.
//
// Statements that follow the page's date range take `start` (rangeStart() in
// stats-range.ts): only applications sent at or after it count, and NULL means
// all time. Under all time, the statements that always counted every card
// (visits, companies, outcomes) keep counting cards not sent yet; under a range
// such a card has no applied date and drops out.

import { type SqlFragment, type SqlStatement, compileSql, sqlFragment } from "./stage-statements.ts";
import { CLOSED_KIND, RESOLVED_KINDS, type StageKind } from "./stage-kinds.ts";

// `applied` is the alias of a column holding application_applied_at's value.
function sentSince(start: string | null, applied: SqlFragment): SqlFragment {
  return sqlFragment`(${start}::timestamptz IS NULL OR ${applied} >= ${start}::timestamptz)`;
}

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

// One row over the applications that were sent (in the range): how many got
// a reply, reached an interview, got an offer, and sit in a closed lane now
// (ghosted), plus the average days from sending to the first interview.
// Every count shares the same denominator, `applied`.
export function milestoneStatsStatement(start: string | null): SqlStatement {
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
    WHERE m.applied_at IS NOT NULL
      AND ${sentSince(start, sqlFragment`m.applied_at`)};
  `);
}

export interface WeekRow {
  week_start: string;
  sent: number;
  responded: number;
  interviewed: number;
  offered: number;
}

// Applications by the week they were sent: the Monday that starts the week in
// the viewer's zone (`zone` is validated by normalizeTimeZone()), as a
// YYYY-MM-DD string, with how many of that week's applications got a reply,
// reached an interview and got an offer. Weeks without applications are
// absent; fillWeeks() in weeks.ts adds them for the weekly chart.
export function weeklyStatement(zone: string, start: string | null): SqlStatement {
  return compileSql(sqlFragment`
    SELECT to_char(date_trunc('week', m.applied_at AT TIME ZONE ${zone})::date, 'YYYY-MM-DD') AS week_start,
           COUNT(*)::int AS sent,
           COUNT(*) FILTER (WHERE m.responded)::int AS responded,
           COUNT(*) FILTER (WHERE m.interviewed)::int AS interviewed,
           COUNT(*) FILTER (WHERE m.offered)::int AS offered
    FROM application_milestones m
    WHERE m.applied_at IS NOT NULL
      AND ${sentSince(start, sqlFragment`m.applied_at`)}
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
export function timeToHearBackStatement(start: string | null): SqlStatement {
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
    WHERE m.applied_at IS NOT NULL
      AND ${sentSince(start, sqlFragment`m.applied_at`)};
  `);
}

export interface SourceApplicationRow {
  source_url: string | null;
  responded: boolean;
  interviewed: boolean;
  offered: boolean;
}

// Every sent application's job link with its three flags. groupBySource() in
// sources.ts turns them into per-host counts on the server, so the page only
// receives the totals.
export function sourceApplicationsStatement(start: string | null): SqlStatement {
  return compileSql(sqlFragment`
    SELECT a.source_url, m.responded, m.interviewed, m.offered
    FROM application_milestones m
    JOIN applications a ON a.id = m.application_id
    WHERE m.applied_at IS NOT NULL
      AND ${sentSince(start, sqlFragment`m.applied_at`)};
  `);
}

// The lanes each application visited: its entry lane (where the first edge
// starts, else the current lane) plus every lane moved into. By lane id, so a
// deleted lane's history never counts for a later lane with the same name.
// buildFunnel() counts them per lane and per card.
export function visitsStatement(start: string | null): SqlStatement {
  return compileSql(sqlFragment`
    SELECT DISTINCT v.application_id, v.stage_id
    FROM (
      SELECT application_id, stage_id
      FROM application_entry_stage
      UNION ALL
      SELECT application_id, to_stage_id
      FROM application_transitions
    ) v
    JOIN application_applied_at p ON p.application_id = v.application_id
    WHERE v.stage_id IS NOT NULL
      AND ${sentSince(start, sqlFragment`p.applied_at`)};
  `);
}

// Companies with the most applications, grouped the way the duplicate warning
// compares names (trimmed, any case) and shown with the most common spelling.
// On a tie MODE() takes the first spelling in the database's collation order.
export function topCompaniesStatement(start: string | null): SqlStatement {
  return compileSql(sqlFragment`
    SELECT MODE() WITHIN GROUP (ORDER BY btrim(a.company)) AS company, COUNT(*)::int AS count
    FROM applications a
    JOIN application_applied_at p ON p.application_id = a.id
    WHERE ${sentSince(start, sqlFragment`p.applied_at`)}
    GROUP BY LOWER(btrim(a.company))
    ORDER BY count DESC, company ASC
    LIMIT 8;
  `);
}

export interface OutcomeRow {
  outcome_stage: string;
  kind: StageKind;
  from_stage: string | null;
  count: number;
}

// For every application sitting in an outcome lane, the stage it left to get
// there: its current name, "<name> (deleted)" for a deleted lane, and NULL
// when the application was created directly in the outcome lane.
export function outcomesStatement(start: string | null): SqlStatement {
  return compileSql(sqlFragment`
    SELECT s.name AS outcome_stage, s.kind,
           CASE
             WHEN last_move.application_id IS NULL THEN NULL
             WHEN fs.id IS NULL THEN last_move.from_status || ' (deleted)'
             ELSE fs.name
           END AS from_stage,
           COUNT(*)::int AS count
    FROM applications a
    JOIN stages s ON s.id = a.stage_id
    JOIN application_applied_at p ON p.application_id = a.id
    LEFT JOIN LATERAL (
      SELECT t.application_id, t.from_stage_id, t.from_status
      FROM application_transitions t
      WHERE t.application_id = a.id
        AND t.to_stage_id = s.id
      ORDER BY t.transitioned_at DESC, t.id DESC
      LIMIT 1
    ) last_move ON true
    LEFT JOIN stages fs ON fs.id = last_move.from_stage_id
    WHERE s.kind = ANY(${[...RESOLVED_KINDS]}::text[])
      AND ${sentSince(start, sqlFragment`p.applied_at`)}
    GROUP BY s.id, s.name, s.kind, s.sort_order, fs.id, 3
    ORDER BY s.sort_order ASC, count DESC;
  `);
}
