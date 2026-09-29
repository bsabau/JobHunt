import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunctionInTransaction } from "@neondatabase/serverless";
import { STALE_THRESHOLD_DAYS } from "@/lib/constants";
import { ConflictError, InvalidInputError, NotFoundError } from "@/lib/api-errors";
import { DEFAULT_TIME_ZONE, normalizeTimeZone } from "@/lib/timezone";
import { buildSankeyPayload } from "@/lib/sankey";
import { SqlFragment, sqlFragment, stageMoveStatement, stageUpdateStatement } from "@/lib/stage-statements";
import { STALE_EXCLUDED_KINDS, TERMINAL_KINDS, StageKind, withPipelineRank } from "@/lib/stage-kinds";
import { Application, SankeyPayload, Stage, StatsPayload } from "@/lib/types";

function hasPgCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

function pgConstraint(error: unknown): string | undefined {
  const value = typeof error === "object" && error !== null ? (error as { constraint?: unknown }).constraint : undefined;
  return typeof value === "string" ? value : undefined;
}

// A stage can be deleted between the "does it exist" check and the write that
// references it. The FK violation that follows is a caller-visible state
// change, not a server fault, so it maps to the same error as the check.
function isStageForeignKeyViolation(error: unknown): boolean {
  return hasPgCode(error, "23503") && (pgConstraint(error)?.includes("stage_id") ?? true);
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

// "New" labels the Sankey entry node, and "created" marked creation in early
// history rows (removed by migration 1730000010000); neither may name a real
// stage, since the analytics would merge it with those.
const RESERVED_STAGE_NAMES = new Set(["created", "new"]);

// Label for applications that were created straight into an outcome lane.
const OUTCOME_DIRECT_ENTRY = "Added directly";

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
    stageKind: String(row.stagekind ?? "active") as Application["stageKind"],
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
          ) AS has_application_transitions,
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'stages' AND column_name = 'kind'
          ) AS has_stage_kind;
      `) as Record<string, unknown>[];

      const row = checks[0];
      if (
        !row.has_stages ||
        !row.has_applications ||
        !row.has_application_transitions ||
        !row.has_stage_kind
      ) {
        throw new Error("Database schema is missing or outdated. Run `npm run migrate:up`.");
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
    WHERE kind = 'active'
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
      s.kind AS stageKind,
      a.created_at AS createdAt,
      a.updated_at AS updatedAt,
      COALESCE(
        (SELECT t.transitioned_at
         FROM application_transitions t
         WHERE t.application_id = a.id AND t.to_stage_id = s.id
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
    SELECT id, name, sort_order AS sortOrder, kind
    FROM stages
    ORDER BY sort_order ASC, id ASC;
  `) as Record<string, unknown>[];

  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    sortOrder: Number(row.sortorder),
    kind: String(row.kind ?? "active") as Stage["kind"]
  }));
}

export async function addStage(name: string, kind: StageKind = "active"): Promise<Stage> {
  await ensureSchema();

  const trimmed = name.trim();
  if (!trimmed) {
    throw new InvalidInputError("Stage name is required");
  }

  // Reserved names: see RESERVED_STAGE_NAMES.
  if (RESERVED_STAGE_NAMES.has(trimmed.toLowerCase())) {
    throw new InvalidInputError(`"${trimmed}" is a reserved stage name`);
  }

  let inserted: Record<string, unknown>[];

  try {
    inserted = (await sql`
      INSERT INTO stages (name, sort_order, kind)
      SELECT ${trimmed}, COALESCE(MAX(sort_order), -1) + 1, ${kind}
      FROM stages
      RETURNING id, name, sort_order AS sortOrder, kind;
    `) as Record<string, unknown>[];
  } catch (error) {
    if (hasPgCode(error, "23505")) {
      // Two unique constraints can fire here: the name, or the deferred
      // sort_order key when another stage was inserted at the same moment.
      throw pgConstraint(error) === "stages_sort_order_key"
        ? new ConflictError("Another stage was added at the same time. Try again.")
        : new ConflictError("Stage already exists");
    }
    throw error;
  }

  return {
    id: Number(inserted[0].id),
    name: String(inserted[0].name),
    sortOrder: Number(inserted[0].sortorder),
    kind: (inserted[0].kind ?? "active") as Stage["kind"]
  };
}

// Renames a lane and/or changes its kind. The rename also rewrites the names
// stored in its history, in the same statement (stageUpdateStatement).
export async function updateStage(id: number, changes: { name?: string; kind?: StageKind }): Promise<Stage> {
  await ensureSchema();

  const name = changes.name?.trim();
  if (changes.name !== undefined) {
    if (!name) {
      throw new InvalidInputError("Stage name is required");
    }
    if (RESERVED_STAGE_NAMES.has(name.toLowerCase())) {
      throw new InvalidInputError(`"${name}" is a reserved stage name`);
    }
  }

  const statement = stageUpdateStatement(id, { name, kind: changes.kind });
  let rows: Record<string, unknown>[];

  try {
    rows = (await getSql().query(statement.text, statement.params)) as Record<string, unknown>[];
  } catch (error) {
    // Both the exact and the case-insensitive unique index map here.
    if (hasPgCode(error, "23505")) {
      throw new ConflictError("Stage already exists");
    }
    // Renaming onto the name of a deleted lane that sits next to this one in
    // some card's history would turn that edge into "X -> X".
    if (hasPgCode(error, "23514") && pgConstraint(error) === "application_transitions_no_self_loop") {
      throw new ConflictError("A deleted lane with that name is next to this lane in a card's history. Pick another name.");
    }
    throw error;
  }

  if (rows.length === 0) {
    throw new NotFoundError("Stage not found");
  }

  return {
    id: Number(rows[0].id),
    name: String(rows[0].name),
    sortOrder: Number(rows[0].sortorder),
    kind: String(rows[0].kind) as Stage["kind"]
  };
}

export async function reorderStages(stageIds: number[]): Promise<Stage[]> {
  await ensureSchema();

  if (stageIds.length > 0) {
    // Validation and renumbering share one statement so a concurrent stage
    // insert/delete cannot slip between the two. `guard` only lets the UPDATE
    // run when the payload is exactly the current set of stages (count matches,
    // no duplicates, no unknown ids); otherwise zero rows change and we report
    // the conflict below.
    const updated = (await sql`
      WITH payload AS (
        SELECT id, ord
        FROM unnest(${stageIds}::int[]) WITH ORDINALITY AS t(id, ord)
      ),
      guard AS (
        SELECT
          (SELECT COUNT(*) FROM stages) = (SELECT COUNT(*) FROM payload)
          AND (SELECT COUNT(*) FROM payload) = (SELECT COUNT(DISTINCT id) FROM payload)
          AND NOT EXISTS (
            SELECT 1 FROM payload p
            WHERE NOT EXISTS (SELECT 1 FROM stages s WHERE s.id = p.id)
          ) AS ok
      )
      UPDATE stages s
      SET sort_order = (payload.ord - 1)::int
      FROM payload, guard
      WHERE guard.ok AND s.id = payload.id
      RETURNING s.id;
    `) as Record<string, unknown>[];

    if (updated.length !== stageIds.length) {
      throw new InvalidInputError("Reorder payload must include every stage exactly once");
    }
  }

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
      s.kind AS stageKind,
      a.created_at AS createdAt,
      a.updated_at AS updatedAt,
      COALESCE(
        (SELECT t.transitioned_at
         FROM application_transitions t
         WHERE t.application_id = a.id AND t.to_stage_id = s.id
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

  let insertRows: Record<string, unknown>[];

  try {
    insertRows = (await sql`
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
  } catch (error) {
    if (isStageForeignKeyViolation(error)) {
      throw new InvalidInputError("Invalid stage");
    }
    throw error;
  }

  const applicationId = Number(insertRows[0].id);

  const application = await selectApplicationById(applicationId);
  if (!application) {
    throw new Error("Failed to load created application");
  }

  return application;
}

type StageMoveOutcome = "ok" | "missing" | "conflict";

async function applyStageMove(
  updateSet: SqlFragment,
  applicationId: number,
  expectedStageId: number | null,
  toStageId: number
): Promise<StageMoveOutcome> {
  let rows: Record<string, unknown>[];

  try {
    const statement = stageMoveStatement(updateSet, applicationId, expectedStageId, toStageId, TERMINAL_KINDS);
    rows = (await getSql().query(statement.text, statement.params)) as Record<string, unknown>[];
  } catch (error) {
    if (isStageForeignKeyViolation(error)) {
      throw new InvalidInputError("Target stage not found");
    }
    throw error;
  }

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
    sqlFragment`stage_id = ${toStageId}, updated_at = NOW()`,
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
    sqlFragment`
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
      -- A fixed order keeps the Sankey layout stable; without one, any UPDATE
      -- (such as a lane rename) can reorder the links and move the flows.
      ORDER BY t.transitioned_at, t.id;
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

  return buildSankeyPayload({
    stages: withPipelineRank(stages).map((stage) => ({ name: stage.name, sortOrder: stage.sortOrder, kind: stage.kind })),
    transitions: transitionDetails.map((row) => ({
      fromStatus: String(row.fromstatus),
      toStatus: String(row.tostatus),
      company: String(row.company)
    })),
    entries: entryDetails.map((row) => ({
      entryStage: String(row.entrystage),
      company: String(row.company)
    })),
    current: nodeCompanies.map((row) => ({
      stageName: String(row.stagename),
      company: String(row.company)
    }))
  });
}

export async function getStatsData(timeZone: string = DEFAULT_TIME_ZONE): Promise<StatsPayload> {
  await ensureSchema();

  const zone = normalizeTimeZone(timeZone);

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
    outcomeRows,
  ] = await Promise.all([
    listStages(),
    sql`
      SELECT s.id, s.name, s.sort_order AS sortOrder, s.kind, COUNT(a.id)::int AS count
      FROM stages s
      LEFT JOIN applications a ON a.stage_id = s.id
      GROUP BY s.id, s.name, s.sort_order, s.kind
      ORDER BY s.sort_order ASC, s.id ASC;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT COUNT(*)::int AS count
      FROM application_transitions;
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
        WHERE t.application_id = a.id AND t.to_stage_id = s.id
        ORDER BY t.transitioned_at DESC, t.id DESC
        LIMIT 1
      ) stage_entry ON true
      WHERE s.kind <> ALL(${[...TERMINAL_KINDS]}::text[]);
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
          AND EXISTS (
            SELECT 1 FROM stages interview_stage
            WHERE interview_stage.id = t.to_stage_id AND interview_stage.kind = 'interview'
          )
      ) first_interview ON true;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM (SELECT (created_at AT TIME ZONE ${zone})::date AS day FROM applications) buckets
      GROUP BY day
      ORDER BY day ASC;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM (
        SELECT (transitioned_at AT TIME ZONE ${zone})::date AS day
        FROM application_transitions
      ) buckets
      GROUP BY day
      ORDER BY day ASC;
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
      ) visits
      GROUP BY stage;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT from_status AS from_stage, to_status AS to_stage,
             COUNT(DISTINCT application_id)::int AS count
      FROM application_transitions
      GROUP BY from_status, to_status;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      SELECT a.company, a.role,
             to_char(a.interview_date, 'YYYY-MM-DD') AS interview_date,
             s.name AS stage_name
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
      WHERE a.interview_date >= (CURRENT_TIMESTAMP AT TIME ZONE ${zone})::date - 1
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
        WHERE t.application_id = a.id AND t.to_stage_id = s.id
        ORDER BY t.transitioned_at DESC, t.id DESC
        LIMIT 1
      ) stage_entry ON true
      WHERE s.kind <> ALL(${[...STALE_EXCLUDED_KINDS]}::text[])
        AND EXTRACT(EPOCH FROM (NOW() - COALESCE(stage_entry.entered_at, a.created_at))) / 86400.0 >= ${STALE_THRESHOLD_DAYS}
      ORDER BY COALESCE(stage_entry.entered_at, a.created_at) ASC;
    ` as Promise<Record<string, unknown>[]>,
    sql`
      -- For every application sitting in an outcome lane, the stage it left to
      -- get there (NULL when it was created directly in that lane).
      SELECT s.name AS outcome_stage, s.kind, last_move.from_status AS from_stage, COUNT(*)::int AS count
      FROM applications a
      JOIN stages s ON s.id = a.stage_id
      LEFT JOIN LATERAL (
        SELECT t.from_status
        FROM application_transitions t
        WHERE t.application_id = a.id
          AND t.to_stage_id = s.id
        ORDER BY t.transitioned_at DESC, t.id DESC
        LIMIT 1
      ) last_move ON true
      WHERE s.kind IN ('offer', 'rejected', 'closed')
      GROUP BY s.name, s.kind, s.sort_order, last_move.from_status
      ORDER BY s.sort_order ASC, count DESC;
    ` as Promise<Record<string, unknown>[]>,
  ]);

  const stageCounts = stageCountRows.map((row) => ({
    stage: String(row.name),
    count: Number(row.count),
    sortOrder: Number(row.sortorder),
    kind: String(row.kind ?? "active") as StageKind
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
