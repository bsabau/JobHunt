import { STALE_THRESHOLD_DAYS } from "@/lib/constants";
import { DEFAULT_TIME_ZONE, normalizeTimeZone } from "@/lib/timezone";
import { INTERVIEW_KIND, RESOLVED_KINDS, STALE_EXCLUDED_KINDS, TERMINAL_KINDS, StageKind } from "@/lib/stage-kinds";
import { StatsPayload } from "@/lib/types";
import { ensureSchema, transaction } from "./client";
import { mapStage } from "./rows";

// Label for applications that were created straight into an outcome lane.
const OUTCOME_DIRECT_ENTRY = "Added directly";

export async function getStatsData(timeZone: string = DEFAULT_TIME_ZONE): Promise<StatsPayload> {
  await ensureSchema();

  const zone = normalizeTimeZone(timeZone);

  // One request and one snapshot: the totals, lists and charts cannot disagree
  // because a write landed between two of these queries.
  const [
    stageCountRows,
    transitionCountRows,
    avgDaysRows,
    avgCurrentStageRows,
    avgInterviewRows,
    createdByDayRows,
    transitionsByDayRows,
    topCompanyRows,
    reachedRows,
    stagePairRows,
    upcomingInterviewRows,
    staleApplicationRows,
    outcomeRows,
  ] = (await transaction((tx) => [
    tx`
      SELECT s.id, s.name, s.sort_order AS sortOrder, s.kind, COUNT(a.id)::int AS count
      FROM stages s
      LEFT JOIN applications a ON a.stage_id = s.id
      GROUP BY s.id, s.name, s.sort_order, s.kind
      ORDER BY s.sort_order ASC, s.id ASC;
    `,
    tx`
      SELECT COUNT(*)::int AS count
      FROM application_transitions;
    `,
    tx`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0), 0) AS days
      FROM applications;
    `,
    tx`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - e.entered_at)) / 86400.0), 0) AS days
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
      JOIN application_stage_entry e ON e.application_id = a.id
      WHERE s.kind <> ALL(${[...TERMINAL_KINDS]}::text[]);
    `,
    tx`
      SELECT
        AVG(
          EXTRACT(EPOCH FROM (first_interview.transitioned_at - a.created_at)) / 86400.0
        ) AS days,
        COUNT(first_interview.transitioned_at)::int AS count
      FROM applications a
      JOIN LATERAL (
        SELECT MIN(t.transitioned_at) AS transitioned_at
        FROM application_transitions t
        WHERE t.application_id = a.id
          AND EXISTS (
            SELECT 1 FROM stages interview_stage
            WHERE interview_stage.id = t.to_stage_id AND interview_stage.kind = ${INTERVIEW_KIND}
          )
      ) first_interview ON true;
    `,
    tx`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM (SELECT (created_at AT TIME ZONE ${zone})::date AS day FROM applications) buckets
      GROUP BY day
      ORDER BY day ASC;
    `,
    tx`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM (
        SELECT (transitioned_at AT TIME ZONE ${zone})::date AS day
        FROM application_transitions
      ) buckets
      GROUP BY day
      ORDER BY day ASC;
    `,
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
      -- Applications that visited each lane: the entry lane (where the first
      -- edge starts, else the current lane) plus every lane moved into.
      -- Counted by lane id, so a deleted lane's history never counts for a
      -- later lane with the same name.
      SELECT stage_id, COUNT(DISTINCT application_id)::int AS count
      FROM (
        SELECT application_id, stage_id
        FROM application_entry_stage
        UNION ALL
        SELECT application_id, to_stage_id
        FROM application_transitions
      ) visits
      WHERE stage_id IS NOT NULL
      GROUP BY stage_id;
    `,
    tx`
      -- Moves between current lanes, labelled with their current names.
      SELECT fs.name AS from_stage, ts.name AS to_stage,
             COUNT(DISTINCT t.application_id)::int AS count
      FROM application_transitions t
      JOIN stages fs ON fs.id = t.from_stage_id
      JOIN stages ts ON ts.id = t.to_stage_id
      GROUP BY fs.id, fs.name, ts.id, ts.name;
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
  ], { readOnly: true, isolationLevel: "RepeatableRead" })) as Record<string, unknown>[][];

  // The lanes come from the same snapshot as the counts.
  const stages = stageCountRows.map(mapStage);

  const stageCounts = stageCountRows.map((row) => ({
    stage: String(row.name),
    count: Number(row.count),
    sortOrder: Number(row.sortorder),
    kind: String(row.kind) as StageKind
  }));

  const totalApps = stageCounts.reduce((sum, row) => sum + row.count, 0);
  const activeStages = stageCounts.filter((row) => row.count > 0).length;
  const totalTransitions = Number(transitionCountRows[0]?.count ?? 0);
  const avgDaysSinceCreated = Math.round(Number(avgDaysRows[0]?.days ?? 0) * 10) / 10;
  const avgDaysInCurrentStage = Math.round(Number(avgCurrentStageRows[0]?.days ?? 0) * 10) / 10;
  const interviewReachedCount = Number(avgInterviewRows[0]?.count ?? 0);
  const avgDaysToInterview =
    interviewReachedCount > 0
      ? Math.round(Number(avgInterviewRows[0]?.days ?? 0) * 10) / 10
      : null;

  let cumulative = 0;
  const applicationsOverTime = createdByDayRows.map((row) => {
    const created = Number(row.count);
    cumulative += created;
    return {
      date: String(row.day),
      created,
      cumulative
    };
  });

  const transitionsByDay = transitionsByDayRows.map((row) => ({
    date: String(row.day),
    count: Number(row.count)
  }));

  const topCompanies = topCompanyRows.map((row) => ({
    company: String(row.company),
    count: Number(row.count)
  }));

  const reachedMap = new Map<number, number>();
  for (const row of reachedRows) {
    reachedMap.set(Number(row.stage_id), Number(row.count));
  }

  const funnel = stages.map((stage) => ({
    stage: stage.name,
    reached: reachedMap.get(stage.id) ?? 0,
    sortOrder: stage.sortOrder,
    kind: stage.kind
  }));

  const stagePairs = stagePairRows.map((row) => ({
    from: String(row.from_stage),
    to: String(row.to_stage),
    count: Number(row.count)
  }));

  const upcomingInterviews = upcomingInterviewRows.map((row) => ({
    company: String(row.company),
    role: String(row.role),
    interviewDate: String(row.interview_date),
    stageName: String(row.stage_name)
  }));

  const staleApplications = staleApplicationRows.map((row) => ({
    company: String(row.company),
    role: String(row.role),
    stageName: String(row.stage_name),
    daysSinceUpdate: Number(row.days_since_update)
  }));

  const outcomes = outcomeRows.map((row) => ({
    fromStage: row.from_stage == null ? OUTCOME_DIRECT_ENTRY : String(row.from_stage),
    outcomeStage: String(row.outcome_stage),
    kind: String(row.kind) as StageKind,
    count: Number(row.count)
  }));
  const resolvedCount = outcomes.reduce((sum, row) => sum + row.count, 0);

  return {
    totals: {
      applications: totalApps,
      activeStages,
      transitions: totalTransitions,
      avgDaysSinceCreated,
      avgDaysInCurrentStage,
      avgDaysToInterview,
      interviewReachedCount,
      staleCount: staleApplications.length
    },
    stageCounts,
    applicationsOverTime,
    transitionsByDay,
    topCompanies,
    funnel,
    stagePairs,
    upcomingInterviews,
    staleApplications,
    outcomes,
    openCount: totalApps - resolvedCount
  };
}
