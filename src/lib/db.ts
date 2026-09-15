import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunctionInTransaction } from "@neondatabase/serverless";
import { STALE_THRESHOLD_DAYS } from "@/lib/constants";
import { ConflictError, InvalidInputError } from "@/lib/api-errors";
import { Application, SankeyPayload, Stage, StatsPayload } from "@/lib/types";

function hasPgCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

type SqlClient = ReturnType<typeof neon>;
type TransactionSql = NeonQueryFunctionInTransaction<boolean, boolean>;
type TransactionQuery = ReturnType<TransactionSql>;

let sqlClient: SqlClient | null = null;

function getSql(): SqlClient {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  sqlClient ??= neon(databaseUrl);
  return sqlClient;
}

function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return getSql()(strings, ...values);
}

function transaction(queries: (tx: TransactionSql) => TransactionQuery[]) {
  return getSql().transaction((tx) => queries(tx));
}

let schemaReadyPromise: Promise<void> | null = null;

function toIsoString(value: unknown): string {
  if (typeof value === "string") {
    return new Date(value).toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}

function mapApplication(row: Record<string, unknown>): Application {
  return {
    id: Number(row.id),
    company: String(row.company),
    role: String(row.role),
    notes: row.notes ? String(row.notes) : null,
    interviewDate: row.interviewdate ? String(row.interviewdate) : null,
    sourceUrl: row.sourceurl ? String(row.sourceurl) : null,
    logoUrl: row.logourl ? String(row.logourl) : null,
    stageId: Number(row.stageid),
    stageName: String(row.stagename),
    createdAt: toIsoString(row.createdat),
    updatedAt: toIsoString(row.updatedat),
    stageEnteredAt: toIsoString(row.stageenteredat ?? row.createdat)
  };
}

async function ensureSchema(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const checks = (await sql`
        SELECT
          EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'stages'
          ) AS has_stages,
          EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'applications'
          ) AS has_applications,
          EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'application_transitions'
          ) AS has_application_transitions;
      `) as Record<string, unknown>[];

      const row = checks[0];
      if (!row.has_stages || !row.has_applications || !row.has_application_transitions) {
        throw new Error("Database schema is missing. Run `npm run migrate:up`.");
      }
    })();
  }

  try {
    await schemaReadyPromise;
  } catch (error) {
    // A transient first request failure must not poison this process forever.
    schemaReadyPromise = null;
    throw error;
  }
}

async function getFirstStage(): Promise<{ id: number; name: string }> {
  await ensureSchema();

  const rows = (await sql`
    SELECT id, name
    FROM stages
    ORDER BY sort_order ASC, id ASC
    LIMIT 1;
  `) as Record<string, unknown>[];

  if (rows.length === 0) {
    throw new Error("No stage available");
  }

  return { id: Number(rows[0].id), name: String(rows[0].name) };
}

async function getDefaultCreateStage(): Promise<{ id: number; name: string }> {
  await ensureSchema();

  const appliedRows = (await sql`
    SELECT id, name
    FROM stages
    WHERE LOWER(name) = LOWER(${ "Applied" })
    ORDER BY sort_order ASC, id ASC
    LIMIT 1;
  `) as Record<string, unknown>[];

  if (appliedRows.length > 0) {
    return { id: Number(appliedRows[0].id), name: String(appliedRows[0].name) };
  }

  return getFirstStage();
}

async function selectApplicationById(id: number): Promise<Application | null> {
  await ensureSchema();

  const rows = (await sql`
    SELECT
      a.id,
      a.company,
      a.role,
      a.notes,
      a.interview_date::text AS interviewDate,
      a.source_url AS sourceUrl,
      a.logo_url AS logoUrl,
      a.stage_id AS stageId,
      s.name AS stageName,
      a.created_at AS createdAt,
      a.updated_at AS updatedAt,
      COALESCE(
        (SELECT t.transitioned_at
         FROM application_transitions t
         WHERE t.application_id = a.id AND t.to_status = s.name
         ORDER BY t.transitioned_at DESC, t.id DESC
         LIMIT 1),
        a.created_at
      ) AS stageEnteredAt
    FROM applications a
    JOIN stages s ON s.id = a.stage_id
    WHERE a.id = ${id};
  `) as Record<string, unknown>[];

  if (rows.length === 0) {
    return null;
  }

  return mapApplication(rows[0]);
}

export async function listStages(): Promise<Stage[]> {
  await ensureSchema();

  const rows = (await sql`
    SELECT id, name, sort_order AS sortOrder
    FROM stages
    ORDER BY sort_order ASC, id ASC;
  `) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    sortOrder: Number(row.sortorder)
  }));
}

export async function addStage(name: string): Promise<Stage> {
  await ensureSchema();

  const trimmed = name.trim();
  if (!trimmed) {
    throw new InvalidInputError("Stage name is required");
  }

  let inserted: Record<string, unknown>[];

  try {
    inserted = (await sql`
      INSERT INTO stages (name, sort_order)
      SELECT ${trimmed}, COALESCE(MAX(sort_order), -1) + 1
      FROM stages
      RETURNING id, name, sort_order AS sortOrder;
    `) as Record<string, unknown>[];
  } catch (error) {
    if (hasPgCode(error, "23505")) {
      throw new ConflictError("Stage already exists");
    }
    throw error;
  }

  return {
    id: Number(inserted[0].id),
    name: String(inserted[0].name),
    sortOrder: Number(inserted[0].sortorder)
  };
}

export async function reorderStages(stageIds: number[]): Promise<Stage[]> {
  await ensureSchema();

  const existing = await listStages();

  if (stageIds.length !== existing.length) {
    throw new InvalidInputError("Reorder payload must include all stages");
  }

  const existingSet = new Set(existing.map((stage) => stage.id));
  const payloadSet = new Set(stageIds);

  if (payloadSet.size !== stageIds.length) {
    throw new InvalidInputError("Reorder payload must not contain duplicate stages");
  }

  for (const id of stageIds) {
    if (!existingSet.has(id)) {
      throw new InvalidInputError("Unknown stage in reorder payload");
    }
  }

  await transaction((tx) =>
    stageIds.map((id, index) => tx`
      UPDATE stages
      SET sort_order = ${index}
      WHERE id = ${id};
    `)
  );

  return listStages();
}

export async function deleteStage(id: number): Promise<{ deleted: boolean; reason?: string }> {
  await ensureSchema();

  let results: Record<string, unknown>[][];

  try {
    results = (await transaction((tx) => [
      tx`
        DELETE FROM stages
        WHERE id = ${id}
          AND NOT EXISTS (SELECT 1 FROM applications WHERE stage_id = ${id})
        RETURNING id;
      `,
      tx`
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order ASC, id ASC) - 1 AS new_sort
          FROM stages
        )
        UPDATE stages s
        SET sort_order = ordered.new_sort
        FROM ordered
        WHERE s.id = ordered.id;
      `
    ])) as Record<string, unknown>[][];
  } catch (error) {
    // A concurrent move may add an application to the stage between the
    // conditional delete and the FK check. Treat that as "not empty".
    if (hasPgCode(error, "23503")) {
      return { deleted: false, reason: "Stage is not empty" };
    }
    throw error;
  }

  const deletedRows = results[0] ?? [];

  if (deletedRows.length === 0) {
    const existsRows = (await sql`
      SELECT 1 FROM stages WHERE id = ${id} LIMIT 1;
    `) as Record<string, unknown>[];

    return existsRows.length === 0
      ? { deleted: false, reason: "Stage not found" }
      : { deleted: false, reason: "Stage is not empty" };
  }

  return { deleted: true };
}

export async function listApplications(): Promise<Application[]> {
  await ensureSchema();

  const rows = (await sql`
    SELECT
      a.id,
      a.company,
      a.role,
      a.notes,
      a.interview_date::text AS interviewDate,
      a.source_url AS sourceUrl,
      a.logo_url AS logoUrl,
      a.stage_id AS stageId,
      s.name AS stageName,
      a.created_at AS createdAt,
      a.updated_at AS updatedAt,
      COALESCE(
        (SELECT t.transitioned_at
         FROM application_transitions t
         WHERE t.application_id = a.id AND t.to_status = s.name
         ORDER BY t.transitioned_at DESC, t.id DESC
         LIMIT 1),
        a.created_at
      ) AS stageEnteredAt
    FROM applications a
    JOIN stages s ON s.id = a.stage_id
    ORDER BY a.updated_at DESC;
  `) as Record<string, unknown>[];

  return rows.map(mapApplication);
}

interface CreateApplicationInput {
  company: string;
  role: string;
  notes?: string;
  interviewDate?: string | null;
  sourceUrl?: string;
  logoUrl?: string | null;
  stageId?: number;
}

export async function createApplication(input: CreateApplicationInput): Promise<Application> {
  await ensureSchema();

  const selectedStageRows =
    input.stageId !== undefined
      ? ((await sql`
          SELECT id, name
          FROM stages
          WHERE id = ${input.stageId}
          LIMIT 1;
        `) as Record<string, unknown>[])
      : [];

  if (input.stageId !== undefined && selectedStageRows.length === 0) {
    throw new InvalidInputError("Invalid stage");
  }

  const stage =
    selectedStageRows.length > 0
      ? { id: Number(selectedStageRows[0].id), name: String(selectedStageRows[0].name) }
      : await getDefaultCreateStage();

  const insertRows = (await sql`
    INSERT INTO applications (
      company,
      role,
      notes,
      interview_date,
      source_url,
      logo_url,
      stage_id,
      created_at,
      updated_at
    ) VALUES (
      ${input.company.trim()},
      ${input.role.trim()},
      ${input.notes?.trim() || null},
      ${input.interviewDate ? input.interviewDate : null},
      ${input.sourceUrl?.trim() || null},
      ${input.logoUrl || null},
      ${stage.id},
      NOW(),
      NOW()
    )
    RETURNING id;
  `) as Record<string, unknown>[];

  const applicationId = Number(insertRows[0].id);

  const application = await selectApplicationById(applicationId);
  if (!application) {
    throw new Error("Failed to load created application");
  }

  return application;
}

type SqlFragment = ReturnType<typeof sql>;

// Atomically guards a stage change against the caller's expected stage and
// records the matching transition in one statement. Because the UPDATE and the
// transition INSERT/DELETE live in the same data-modifying CTE chain, Postgres
// uses a single snapshot and the transition is only derived from (and written
// with) a row that actually still sat in `expectedStageId`. `expectedStageId`
// null disables the guard for callers that cannot supply one.
function stageMoveQuery(
  updateSet: SqlFragment,
  applicationId: number,
  expectedStageId: number | null,
  toStageId: number
): SqlFragment {
  return sql`
    WITH target AS (
      SELECT id, name, sort_order
      FROM stages
      WHERE id = ${toStageId}
    ),
    current_app AS (
      SELECT a.stage_id AS stage_id, s.name AS stage_name, s.sort_order AS sort_order
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
      WHERE a.id = ${applicationId}
    ),
    moved AS (
      UPDATE applications a
      SET ${updateSet}
      WHERE a.id = ${applicationId}
        AND a.stage_id = COALESCE(${expectedStageId}, a.stage_id)
      RETURNING a.id
    ),
    candidate_from AS (
      -- The earliest removed edge's source is the last kept node before the
      -- rewound tail; including the edge into the target means a revisit
      -- reconnects from the node that preceded that first visit. It also
      -- preserves the creation stage when no earlier edge exists.
      SELECT t.from_status AS status
      FROM application_transitions t
      JOIN stages s ON s.name = t.to_status
      WHERE t.application_id = ${applicationId}
        AND s.sort_order >= (SELECT sort_order FROM target)
      ORDER BY t.transitioned_at ASC, t.id ASC
      LIMIT 1
    ),
    forward_insert AS (
      INSERT INTO application_transitions (application_id, from_status, to_status, transitioned_at)
      SELECT ${applicationId}, c.stage_name, tg.name, NOW()
      FROM moved m, current_app c, target tg
      WHERE tg.sort_order >= c.sort_order
        AND tg.name <> c.stage_name
      RETURNING id
    ),
    backward_delete AS (
      DELETE FROM application_transitions t
      WHERE t.application_id = ${applicationId}
        AND EXISTS (SELECT 1 FROM moved)
        AND EXISTS (SELECT 1 FROM current_app c, target tg WHERE tg.sort_order < c.sort_order)
        AND t.to_status IN (
          SELECT s.name FROM stages s WHERE s.sort_order >= (SELECT sort_order FROM target)
        )
      RETURNING id
    ),
    backward_insert AS (
      INSERT INTO application_transitions (application_id, from_status, to_status, transitioned_at)
      SELECT
        ${applicationId},
        COALESCE((SELECT status FROM candidate_from), c.stage_name),
        tg.name,
        NOW()
      FROM moved m, current_app c, target tg
      WHERE tg.sort_order < c.sort_order
        AND COALESCE((SELECT status FROM candidate_from), c.stage_name) <> tg.name
      RETURNING id
    )
    SELECT
      (SELECT COUNT(*)::int FROM current_app) AS found,
      (SELECT COUNT(*)::int FROM moved) AS updated;
  `;
}

type StageMoveOutcome = "ok" | "missing" | "conflict";

async function applyStageMove(
  updateSet: SqlFragment,
  applicationId: number,
  expectedStageId: number | null,
  toStageId: number
): Promise<StageMoveOutcome> {
  const rows = (await stageMoveQuery(updateSet, applicationId, expectedStageId, toStageId)) as Record<string, unknown>[];
  const found = Number(rows[0]?.found ?? 0);
  const updated = Number(rows[0]?.updated ?? 0);

  if (found === 0) {
    return "missing";
  }

  if (updated === 0) {
    return "conflict";
  }

  return "ok";
}

export async function updateApplicationStage(
  id: number,
  toStageId: number,
  expectedStageId?: number
): Promise<Application | null> {
  await ensureSchema();

  const targetRows = (await sql`
    SELECT 1
    FROM stages
    WHERE id = ${toStageId}
    LIMIT 1;
  `) as Record<string, unknown>[];

  if (targetRows.length === 0) {
    throw new InvalidInputError("Target stage not found");
  }

  const outcome = await applyStageMove(
    sql`stage_id = ${toStageId}, updated_at = NOW()`,
    id,
    expectedStageId ?? null,
    toStageId
  );

  if (outcome === "missing") {
    return null;
  }

  if (outcome === "conflict") {
    throw new ConflictError("This application was moved elsewhere. Reload and try again.");
  }

  return selectApplicationById(id);
}

export async function deleteApplication(id: number): Promise<boolean> {
  await ensureSchema();

  // application_transitions has ON DELETE CASCADE, so a single statement is enough.
  const deletedRows = (await sql`
    DELETE FROM applications
    WHERE id = ${id}
    RETURNING id;
  `) as Record<string, unknown>[];

  return deletedRows.length > 0;
}

interface UpdateApplicationInput {
  company: string;
  role: string;
  notes?: string;
  interviewDate?: string | null;
  sourceUrl?: string;
  stageId: number;
  expectedStageId?: number;
}

export async function updateApplication(id: number, input: UpdateApplicationInput): Promise<Application | null> {
  await ensureSchema();

  const targetRows = (await sql`
    SELECT 1
    FROM stages
    WHERE id = ${input.stageId}
    LIMIT 1;
  `) as Record<string, unknown>[];

  if (targetRows.length === 0) {
    throw new InvalidInputError("Target stage not found");
  }

  const outcome = await applyStageMove(
    sql`
      company = ${input.company.trim()},
      role = ${input.role.trim()},
      notes = ${input.notes?.trim() || null},
      interview_date = ${input.interviewDate ? input.interviewDate : null},
      source_url = ${input.sourceUrl?.trim() || null},
      stage_id = ${input.stageId},
      updated_at = NOW()
    `,
    id,
    input.expectedStageId ?? null,
    input.stageId
  );

  if (outcome === "missing") {
    return null;
  }

  if (outcome === "conflict") {
    throw new ConflictError("This application was moved elsewhere. Reload and try again.");
  }

  return selectApplicationById(id);
}

export async function getSankeyData(): Promise<SankeyPayload> {
  await ensureSchema();

  const [stages, transitionDetails, entryDetails, nodeCompanies] = await Promise.all([
    listStages(),
    sql`
      SELECT t.from_status AS fromStatus, t.to_status AS toStatus, a.company
      FROM application_transitions t
      JOIN applications a ON a.id = t.application_id
      WHERE LOWER(t.from_status) <> LOWER(${ "created" }) AND LOWER(t.to_status) <> LOWER(${ "created" });
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT
        COALESCE(
          (SELECT t.from_status FROM application_transitions t
           WHERE t.application_id = a.id
           ORDER BY t.transitioned_at ASC, t.id ASC LIMIT 1),
          s.name
        ) AS entryStage,
        a.company
      FROM applications a
      JOIN stages s ON s.id = a.stage_id;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT s.name AS stageName, a.company
      FROM applications a
      JOIN stages s ON s.id = a.stage_id;
    ` as Promise<Record<string, unknown>[]>,
  ]);

  const transitionMap = new Map<string, { from: string; to: string; count: number; companies: string[] }>();
  for (const row of transitionDetails) {
    const from = String(row.fromstatus);
    const to = String(row.tostatus);
    const key = `${from}|${to}`;
    const entry = transitionMap.get(key) ?? { from, to, count: 0, companies: [] };
    entry.count += 1;
    entry.companies.push(String(row.company));
    transitionMap.set(key, entry);
  }

  const currentStageNames = stages.map((stage) => stage.name);

  const entryMap = new Map<string, { count: number; companies: string[] }>();
  for (const row of entryDetails) {
    const stage = String(row.entrystage);
    const entry = entryMap.get(stage) ?? { count: 0, companies: [] };
    entry.count += 1;
    entry.companies.push(String(row.company));
    entryMap.set(stage, entry);
  }

  const nodeCompanyMap = new Map<string, string[]>();
  for (const row of nodeCompanies) {
    const stage = String(row.stagename);
    const list = nodeCompanyMap.get(stage) ?? [];
    list.push(String(row.company));
    nodeCompanyMap.set(stage, list);
  }

  const transitionStageNames = Array.from(transitionMap.values()).flatMap((t) => [t.from, t.to]);

  const entryNode = "New";

  const nodeNames = Array.from(new Set([
    entryNode,
    ...currentStageNames,
    ...transitionStageNames,
    ...Array.from(entryMap.keys())
  ]));

  const links: { source: number; target: number; value: number; companies: string[] }[] = [];

  // Add entry links: New → entry stage for all applications
  for (const [stage, data] of entryMap) {
    const source = nodeNames.indexOf(entryNode);
    const target = nodeNames.indexOf(stage);
    if (source >= 0 && target >= 0 && data.count > 0) {
      links.push({ source, target, value: data.count, companies: data.companies });
    }
  }

  // Add transition-based links between stages
  for (const data of transitionMap.values()) {
    const source = nodeNames.indexOf(data.from);
    const target = nodeNames.indexOf(data.to);
    if (source >= 0 && target >= 0 && data.count > 0) {
      links.push({ source, target, value: data.count, companies: data.companies });
    }
  }

  return {
    nodes: nodeNames.map((name) => ({
      name,
      companies: nodeCompanyMap.get(name) ?? []
    })),
    links
  };
}

export async function getStatsData(): Promise<StatsPayload> {
  await ensureSchema();

  const [
    stages,
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
  ] = await Promise.all([
    listStages(),
    sql`
      SELECT s.id, s.name, s.sort_order AS sortOrder, COUNT(a.id)::int AS count
      FROM stages s
      LEFT JOIN applications a ON a.stage_id = s.id
      GROUP BY s.id, s.name, s.sort_order
      ORDER BY s.sort_order ASC, s.id ASC;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT COUNT(*)::int AS count
      FROM application_transitions
      WHERE LOWER(from_status) <> LOWER(${ "created" })
        AND LOWER(to_status) <> LOWER(${ "created" });
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0), 0) AS days
      FROM applications;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - COALESCE(stage_entry.entered_at, a.created_at))) / 86400.0), 0) AS days
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
      LEFT JOIN LATERAL (
        SELECT t.transitioned_at AS entered_at
        FROM application_transitions t
        WHERE t.application_id = a.id AND t.to_status = s.name
        ORDER BY t.transitioned_at DESC, t.id DESC
        LIMIT 1
      ) stage_entry ON true
      WHERE LOWER(s.name) <> 'rejected';
    ` as Promise<Record<string, unknown>[]>,
    sql`
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
          AND LOWER(t.to_status) = 'interview'
      ) first_interview ON true;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM applications
      GROUP BY date_trunc('day', created_at)
      ORDER BY date_trunc('day', created_at) ASC;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT to_char(date_trunc('day', transitioned_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM application_transitions
      WHERE LOWER(from_status) <> LOWER(${ "created" })
        AND LOWER(to_status) <> LOWER(${ "created" })
      GROUP BY date_trunc('day', transitioned_at)
      ORDER BY date_trunc('day', transitioned_at) ASC;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT company, COUNT(*)::int AS count
      FROM applications
      GROUP BY company
      ORDER BY count DESC, company ASC
      LIMIT 8;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT stage, COUNT(DISTINCT application_id)::int AS count
      FROM (
        SELECT a.id AS application_id, COALESCE(
          (SELECT t.from_status FROM application_transitions t
           WHERE t.application_id = a.id
           ORDER BY t.transitioned_at ASC, t.id ASC LIMIT 1),
          s.name
        ) AS stage
        FROM applications a
        JOIN stages s ON s.id = a.stage_id
        UNION ALL
        SELECT application_id, to_status AS stage
        FROM application_transitions
        WHERE LOWER(to_status) <> LOWER(${ "created" })
      ) visits
      GROUP BY stage;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT from_status AS from_stage, to_status AS to_stage,
             COUNT(DISTINCT application_id)::int AS count
      FROM application_transitions
      WHERE LOWER(from_status) <> LOWER(${ "created" })
        AND LOWER(to_status) <> LOWER(${ "created" })
      GROUP BY from_status, to_status;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT a.company, a.role,
             to_char(a.interview_date, 'YYYY-MM-DD') AS interview_date,
             s.name AS stage_name
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
      WHERE a.interview_date >= CURRENT_DATE - 1
      ORDER BY a.interview_date ASC
      LIMIT 10;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT a.company, a.role, s.name AS stage_name,
             FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(stage_entry.entered_at, a.created_at))) / 86400.0)::int AS days_since_update
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
      LEFT JOIN LATERAL (
        SELECT t.transitioned_at AS entered_at
        FROM application_transitions t
        WHERE t.application_id = a.id AND t.to_status = s.name
        ORDER BY t.transitioned_at DESC, t.id DESC
        LIMIT 1
      ) stage_entry ON true
      WHERE LOWER(s.name) NOT IN ('wishlist', 'offer', 'rejected')
        AND EXTRACT(EPOCH FROM (NOW() - COALESCE(stage_entry.entered_at, a.created_at))) / 86400.0 >= ${STALE_THRESHOLD_DAYS}
      ORDER BY COALESCE(stage_entry.entered_at, a.created_at) ASC;
    ` as Promise<Record<string, unknown>[]>,
  ]);

  const stageCounts = stageCountRows.map((row) => ({
    stage: String(row.name),
    count: Number(row.count),
    sortOrder: Number(row.sortorder)
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

  const reachedMap = new Map<string, number>();
  for (const row of reachedRows) {
    reachedMap.set(String(row.stage), Number(row.count));
  }

  const funnel = stages.map((stage) => ({
    stage: stage.name,
    reached: reachedMap.get(stage.name) ?? 0,
    sortOrder: stage.sortOrder
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
    staleApplications
  };
}
