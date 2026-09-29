import { STALE_THRESHOLD_DAYS } from "@/lib/constants";
import { DEFAULT_TIME_ZONE, normalizeTimeZone } from "@/lib/timezone";
import { RESOLVED_KINDS, STALE_EXCLUDED_KINDS, TERMINAL_KINDS, StageKind } from "@/lib/stage-kinds";
import { buildFunnel } from "@/lib/funnel";
import { groupBySource } from "@/lib/sources";
import {
  MilestoneStatsRow,
  SourceApplicationRow,
  TimeToHearBackRow,
  milestoneStatsStatement,
  sourceApplicationsStatement,
  timeToHearBackStatement,
  WeekRow,
  weeklyStatement
} from "@/lib/stats-statements";
import { StatsPayload } from "@/lib/types";
import { ensureSchema, transaction } from "./client";
import { StageRow, mapStage } from "./rows";

// One row type per query, in query order. AVG yields numeric, which the Neon
// driver returns as a string.
type StatsRows = [
  (StageRow & { count: number })[],
  MilestoneStatsRow[],
  TimeToHearBackRow[],
  SourceApplicationRow[],
  { days: string }[],
  WeekRow[],
  { company: string; count: number }[],
  { application_id: number; stage_id: number }[],
  { company: string; role: string; interview_date: string; stage_name: string }[],
  { company: string; role: string; stage_name: string; days_since_update: number }[],
  { outcome_stage: string; kind: StageKind; from_stage: string | null; count: number }[]
];

// Label for applications that were created straight into an outcome lane.
const OUTCOME_DIRECT_ENTRY = "Added directly";

// One decimal, like the other day figures on the page.
function roundOrNull(days: number | null): number | null {
  return days === null ? null : Math.round(days * 10) / 10;
}

export async function getStatsData(timeZone: string = DEFAULT_TIME_ZONE): Promise<StatsPayload> {
  await ensureSchema();

  const zone = normalizeTimeZone(timeZone);

  // One request and one snapshot: the totals, lists and charts cannot disagree
  // because a write landed between two of these queries.
  const milestones = milestoneStatsStatement();
  const weekly = weeklyStatement(zone);
  const hearBack = timeToHearBackStatement();
  const sourceApplications = sourceApplicationsStatement();
  const [
    stageCountRows,
    milestoneRows,
    hearBackRows,
    sourceRows,
    avgCurrentStageRows,
    weekRows,
    topCompanyRows,
    visitRows,
    upcomingInterviewRows,
    staleApplicationRows,
    outcomeRows,
  ] = (await transaction((tx) => [
    tx`
      SELECT s.id, s.name, s.sort_order, s.kind, COUNT(a.id)::int AS count
      FROM stages s
      LEFT JOIN applications a ON a.stage_id = s.id
      GROUP BY s.id, s.name, s.sort_order, s.kind
      ORDER BY s.sort_order ASC, s.id ASC;
    `,
    tx.query(milestones.text, milestones.params),
    tx.query(hearBack.text, hearBack.params),
    tx.query(sourceApplications.text, sourceApplications.params),
    tx`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - e.entered_at)) / 86400.0), 0) AS days
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
      JOIN application_stage_entry e ON e.application_id = a.id
      WHERE s.kind <> ALL(${[...TERMINAL_KINDS]}::text[]);
    `,
    tx.query(weekly.text, weekly.params),
    tx`
      -- Grouped the way the duplicate warning compares names (trimmed, any
      -- case), shown with the most common spelling. On a tie MODE() takes the
      -- first spelling in the database's collation order.
      SELECT MODE() WITHIN GROUP (ORDER BY btrim(company)) AS company, COUNT(*)::int AS count
      FROM applications
      GROUP BY LOWER(btrim(company))
      ORDER BY count DESC, company ASC
      LIMIT 8;
    `,
    tx`
      -- The lanes each application visited: its entry lane (where the first
      -- edge starts, else the current lane) plus every lane moved into. By
      -- lane id, so a deleted lane's history never counts for a later lane
      -- with the same name. buildFunnel() counts them per lane and per card.
      SELECT DISTINCT application_id, stage_id
      FROM (
        SELECT application_id, stage_id
        FROM application_entry_stage
        UNION ALL
        SELECT application_id, to_stage_id
        FROM application_transitions
      ) visits
      WHERE stage_id IS NOT NULL;
    `,
    tx`
      SELECT a.company, a.role,
             to_char(a.interview_date, 'YYYY-MM-DD') AS interview_date,
             s.name AS stage_name
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
      WHERE a.interview_date >= (CURRENT_TIMESTAMP AT TIME ZONE ${zone})::date - 1
        AND s.kind <> ALL(${[...TERMINAL_KINDS]}::text[])
      ORDER BY a.interview_date ASC
      LIMIT 10;
    `,
    tx`
      SELECT a.company, a.role, s.name AS stage_name,
             FLOOR(EXTRACT(EPOCH FROM (NOW() - e.entered_at)) / 86400.0)::int AS days_since_update
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
      JOIN application_stage_entry e ON e.application_id = a.id
      WHERE s.kind <> ALL(${[...STALE_EXCLUDED_KINDS]}::text[])
        AND EXTRACT(EPOCH FROM (NOW() - e.entered_at)) / 86400.0 >= ${STALE_THRESHOLD_DAYS}
      ORDER BY e.entered_at ASC;
    `,
    tx`
      -- For every application sitting in an outcome lane, the stage it left to
      -- get there: its current name, "<name> (deleted)" for a deleted lane, and
      -- NULL when the application was created directly in the outcome lane.
      SELECT s.name AS outcome_stage, s.kind,
             CASE
               WHEN last_move.application_id IS NULL THEN NULL
               WHEN fs.id IS NULL THEN last_move.from_status || ' (deleted)'
               ELSE fs.name
             END AS from_stage,
             COUNT(*)::int AS count
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
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
      GROUP BY s.id, s.name, s.kind, s.sort_order, fs.id, 3
      ORDER BY s.sort_order ASC, count DESC;
    `,
  ], { readOnly: true, isolationLevel: "RepeatableRead" })) as StatsRows;

  // The lanes come from the same snapshot as the counts.
  const stages = stageCountRows.map(mapStage);

  const stageCounts = stageCountRows.map((row) => ({
    stage: row.name,
    count: row.count,
    sortOrder: row.sort_order,
    kind: row.kind
  }));

  const totalApps = stageCounts.reduce((sum, row) => sum + row.count, 0);
  const activeStages = stageCounts.filter((row) => row.count > 0).length;
  const avgDaysInCurrentStage = Math.round(Number(avgCurrentStageRows[0]?.days ?? 0) * 10) / 10;
  const milestone = milestoneRows[0];
  const interviewReachedCount = milestone?.interview_count ?? 0;
  const avgDaysToInterview =
    interviewReachedCount > 0
      ? Math.round(Number(milestone?.avg_days_to_interview ?? 0) * 10) / 10
      : null;

  // Weeks without applications are filled in by the page, which knows the
  // current week (fillWeeks() with its `now`).
  const weeks = weekRows.map((row) => ({
    weekStart: row.week_start,
    sent: row.sent,
    responded: row.responded,
    interviewed: row.interviewed,
    offered: row.offered
  }));

  const topCompanies = topCompanyRows.map((row) => ({ company: row.company, count: row.count }));

  const funnel = buildFunnel(
    stages,
    visitRows.map((row) => ({ applicationId: row.application_id, stageId: row.stage_id }))
  );

  const upcomingInterviews = upcomingInterviewRows.map((row) => ({
    company: row.company,
    role: row.role,
    interviewDate: row.interview_date,
    stageName: row.stage_name
  }));

  const staleApplications = staleApplicationRows.map((row) => ({
    company: row.company,
    role: row.role,
    stageName: row.stage_name,
    daysSinceUpdate: row.days_since_update
  }));

  const outcomes = outcomeRows.map((row) => ({
    fromStage: row.from_stage ?? OUTCOME_DIRECT_ENTRY,
    outcomeStage: row.outcome_stage,
    kind: row.kind,
    count: row.count
  }));
  const resolvedCount = outcomes.reduce((sum, row) => sum + row.count, 0);

  return {
    totals: {
      applications: totalApps,
      activeStages,
      avgDaysInCurrentStage,
      avgDaysToInterview,
      interviewReachedCount,
      staleCount: staleApplications.length
    },
    stageCounts,
    // Shares of the applications that were sent (application_milestones).
    rates: {
      applied: milestone?.applied ?? 0,
      responded: milestone?.responded ?? 0,
      interviewed: milestone?.interviewed ?? 0,
      offered: milestone?.offered ?? 0,
      ghosted: milestone?.ghosted ?? 0
    },
    timeToHearBack: {
      replyMedianDays: roundOrNull(hearBackRows[0]?.reply_median_days ?? null),
      replyCount: hearBackRows[0]?.reply_count ?? 0,
      rejectionMedianDays: roundOrNull(hearBackRows[0]?.rejection_median_days ?? null),
      rejectionCount: hearBackRows[0]?.rejection_count ?? 0
    },
    weeks,
    sources: groupBySource(
      sourceRows.map((row) => ({
        sourceUrl: row.source_url,
        responded: row.responded,
        interviewed: row.interviewed,
        offered: row.offered
      }))
    ),
    topCompanies,
    funnel,
    upcomingInterviews,
    staleApplications,
    outcomes,
    openCount: totalApps - resolvedCount
  };
}
