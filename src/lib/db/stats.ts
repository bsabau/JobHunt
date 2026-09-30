import { MEDIAN_MIN_SAMPLE, STALE_THRESHOLD_DAYS } from "@/lib/constants";
import { normalizeTimeZone } from "@/lib/timezone";
import { CLOSED_KIND, TERMINAL_KINDS, compareStageRank } from "@/lib/stage-kinds";
import { buildFunnel } from "@/lib/funnel";
import { groupBySource } from "@/lib/sources";
import { StatsRange, rangeStart } from "@/lib/stats-range";
import type { Role } from "@/lib/auth";
import {
  FieldResultRow,
  GhostCandidateRow,
  MilestoneStatsRow,
  OutcomeRow,
  SourceApplicationRow,
  StaleApplicationRow,
  TimeToHearBackRow,
  WeekRow,
  fieldResultsStatement,
  ghostCandidatesStatement,
  milestoneStatsStatement,
  outcomesStatement,
  sourceApplicationsStatement,
  staleApplicationsStatement,
  timeToHearBackStatement,
  topCompaniesStatement,
  visitsStatement,
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
  TimeToHearBackRow[],
  SourceApplicationRow[],
  { days: string }[],
  WeekRow[],
  { company: string; count: number }[],
  { application_id: number; stage_id: number }[],
  {
    id: number;
    company: string;
    role: string;
    interview_date: string;
    interview_time: string | null;
    interview_time_zone: string | null;
    stage_name: string;
  }[],
  StaleApplicationRow[],
  GhostCandidateRow[],
  FieldResultRow[],
  OutcomeRow[]
];

// Label for applications that were created straight into an outcome lane.
const OUTCOME_DIRECT_ENTRY = "Added directly";

// One decimal, like the other day figures on the page.
function roundOrNull(days: number | null): number | null {
  return days === null ? null : Math.round(days * 10) / 10;
}

// `now` is the page's clock (requestNow()); `range` the date range from the
// URL; `viewer` the session's role (the guest gets no bulk-close candidates,
// having nothing to do with them). The figures that follow the range count applications sent since its
// start; lane counts, upcoming interviews, stale applications and time in the
// current lane always describe the present.
export async function getStatsData(
  timeZone: string,
  options: { now: number; range: StatsRange; viewer: Role }
): Promise<StatsPayload> {
  await ensureSchema();

  const zone = normalizeTimeZone(timeZone);
  const start = rangeStart(options.range, options.now);

  // One request and one snapshot: the totals, lists and charts cannot disagree
  // because a write landed between two of these queries.
  const milestones = milestoneStatsStatement(start);
  const hearBack = timeToHearBackStatement(start);
  // How long a week stays open uses all time: a short range rarely holds
  // enough replies for a median.
  const hearBackAllTime = timeToHearBackStatement(null);
  const sourceApplications = sourceApplicationsStatement(start);
  const weekly = weeklyStatement(zone, start);
  const topCompaniesQuery = topCompaniesStatement(start);
  const visits = visitsStatement(start);
  const outcomesQuery = outcomesStatement(start);
  const staleQuery = staleApplicationsStatement(new Date(options.now).toISOString(), STALE_THRESHOLD_DAYS);
  // Every candidate from STALE_THRESHOLD_DAYS on; the dialog narrows by its N.
  const ghostQuery = ghostCandidatesStatement(new Date(options.now).toISOString(), STALE_THRESHOLD_DAYS);
  const fieldQuery = fieldResultsStatement(start);
  const [
    stageCountRows,
    milestoneRows,
    hearBackRows,
    hearBackAllTimeRows,
    sourceRows,
    avgCurrentStageRows,
    weekRows,
    topCompanyRows,
    visitRows,
    upcomingInterviewRows,
    staleApplicationRows,
    ghostCandidateRows,
    fieldResultRows,
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
    tx.query(hearBackAllTime.text, hearBackAllTime.params),
    tx.query(sourceApplications.text, sourceApplications.params),
    tx`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - e.entered_at)) / 86400.0), 0) AS days
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
      JOIN application_stage_entry e ON e.application_id = a.id
      WHERE s.kind <> ALL(${[...TERMINAL_KINDS]}::text[]);
    `,
    tx.query(weekly.text, weekly.params),
    tx.query(topCompaniesQuery.text, topCompaniesQuery.params),
    tx.query(visits.text, visits.params),
    tx`
      SELECT a.id, a.company, a.role,
             to_char(a.interview_date, 'YYYY-MM-DD') AS interview_date,
             to_char(a.interview_time, 'HH24:MI') AS interview_time,
             a.interview_time_zone,
             s.name AS stage_name
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
      WHERE a.interview_date >= (CURRENT_TIMESTAMP AT TIME ZONE ${zone})::date - 1
        AND s.kind <> ALL(${[...TERMINAL_KINDS]}::text[])
      -- By day, then by the actual instant, so 09:00 in one zone and 14:00 in
      -- another come in the order they happen; date-only interviews last.
      ORDER BY a.interview_date ASC,
               (a.interview_date + a.interview_time) AT TIME ZONE a.interview_time_zone ASC NULLS LAST
      LIMIT 10;
    `,
    tx.query(staleQuery.text, staleQuery.params),
    tx.query(ghostQuery.text, ghostQuery.params),
    tx.query(fieldQuery.text, fieldQuery.params),
    tx.query(outcomesQuery.text, outcomesQuery.params),
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
    id: row.id,
    interviewTime: row.interview_time,
    interviewTimeZone: row.interview_time_zone,
    company: row.company,
    role: row.role,
    interviewDate: row.interview_date,
    stageName: row.stage_name
  }));

  const staleApplications = staleApplicationRows.map((row) => ({
    id: row.id,
    stageId: row.stage_id,
    company: row.company,
    role: row.role,
    stageName: row.stage_name,
    daysSinceUpdate: row.days_stale,
    followedUpAt: row.followed_up_at === null ? null : new Date(row.followed_up_at).toISOString()
  }));

  // Where "Close" on a stale application moves it: the first closed lane by
  // board order, or none when the board has no closed lane.
  const closeLane = stages.filter((stage) => stage.kind === CLOSED_KIND).sort(compareStageRank)[0];
  const closeStage = closeLane ? { id: closeLane.id, name: closeLane.name } : null;

  const outcomes = outcomeRows.map((row) => ({
    fromStage: row.from_stage ?? OUTCOME_DIRECT_ENTRY,
    outcomeStage: row.outcome_stage,
    kind: row.kind,
    count: row.count
  }));
  const resolvedCount = outcomes.reduce((sum, row) => sum + row.count, 0);
  // The applications the ranged figures cover: every card under all time,
  // the ones sent in the range otherwise.
  const scopeTotal = options.range === null ? totalApps : (milestone?.applied ?? 0);

  // A week stays open for the all-time median days to a first reply, rounded
  // up, or STALE_THRESHOLD_DAYS while that median rests on too few replies.
  const allTimeReply = hearBackAllTimeRows[0];
  const openWeeksFromMedian =
    allTimeReply?.reply_median_days != null && allTimeReply.reply_count >= MEDIAN_MIN_SAMPLE;

  return {
    range: options.range,
    scopeTotal,
    openWeeks: {
      days: openWeeksFromMedian ? Math.ceil(allTimeReply.reply_median_days as number) : STALE_THRESHOLD_DAYS,
      fromMedian: openWeeksFromMedian,
      medianReplyDays: openWeeksFromMedian ? roundOrNull(allTimeReply.reply_median_days) : null
    },
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
    closeStage,
    fieldResults: fieldResultRows.map((row) => ({
      dimension: row.dimension,
      group: row.group_key,
      sent: row.sent,
      responded: row.responded,
      interviewed: row.interviewed,
      offered: row.offered
    })),
    ghostCandidates:
      options.viewer === "guest"
        ? []
        : ghostCandidateRows.map((row) => ({
            id: row.id,
            stageId: row.stage_id,
            company: row.company,
            role: row.role,
            stageName: row.stage_name,
            daysSinceApplied: row.days_since_applied,
            followedUpAt: row.followed_up_at === null ? null : new Date(row.followed_up_at).toISOString()
          })),
    outcomes,
    openCount: scopeTotal - resolvedCount
  };
}
