import { neon } from "@neondatabase/serverless";
import { Application, SankeyPayload, Stage, StatsPayload } from "@/lib/types";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const sql = neon(databaseUrl);

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
    updatedAt: toIsoString(row.updatedat)
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

  await schemaReadyPromise;
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
      a.updated_at AS updatedAt
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
    throw new Error("Stage name is required");
  }

  const maxRows = (await sql`
    SELECT COALESCE(MAX(sort_order), -1) AS value
    FROM stages;
  `) as Record<string, unknown>[];

  const maxOrder = Number(maxRows[0].value);

  const inserted = (await sql`
    INSERT INTO stages (name, sort_order)
    VALUES (${trimmed}, ${maxOrder + 1})
    RETURNING id, name, sort_order AS sortOrder;
  `) as Record<string, unknown>[];

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
    throw new Error("Reorder payload must include all stages");
  }

  const existingSet = new Set(existing.map((stage) => stage.id));
  for (const id of stageIds) {
    if (!existingSet.has(id)) {
      throw new Error("Unknown stage in reorder payload");
    }
  }

  for (const [index, id] of stageIds.entries()) {
    await sql`
      UPDATE stages
      SET sort_order = ${index}
      WHERE id = ${id};
    `;
  }

  return listStages();
}

export async function deleteStage(id: number): Promise<{ deleted: boolean; reason?: string }> {
  await ensureSchema();

  const appCountRows = (await sql`
    SELECT COUNT(*)::int AS value
    FROM applications
    WHERE stage_id = ${id};
  `) as Record<string, unknown>[];

  if (Number(appCountRows[0].value) > 0) {
    return { deleted: false, reason: "Stage is not empty" };
  }

  const deletedRows = (await sql`
    DELETE FROM stages
    WHERE id = ${id}
    RETURNING id;
  `) as Record<string, unknown>[];

  if (deletedRows.length === 0) {
    return { deleted: false, reason: "Stage not found" };
  }

  await sql`
    WITH ordered AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order ASC, id ASC) - 1 AS new_sort
      FROM stages
    )
    UPDATE stages s
    SET sort_order = ordered.new_sort
    FROM ordered
    WHERE s.id = ordered.id;
  `;

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
      a.updated_at AS updatedAt
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
    throw new Error("Invalid stage");
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

async function recordTransition(
  applicationId: number,
  currentStageName: string,
  targetStageName: string,
  targetSortOrder: number,
  currentSortOrder: number
): Promise<void> {
  const isBackward = targetSortOrder < currentSortOrder;

  if (isBackward) {
    // Delete transitions where to_status points to a stage at or after the target
    await sql`
      DELETE FROM application_transitions
      WHERE application_id = ${applicationId}
        AND id IN (
          SELECT t.id FROM application_transitions t
          JOIN stages s ON s.name = t.to_status
          WHERE t.application_id = ${applicationId}
            AND s.sort_order >= ${targetSortOrder}
        );
    `;

    // Get the last remaining transition's to_status to use as from_status
    const lastRows = (await sql`
      SELECT to_status FROM application_transitions
      WHERE application_id = ${applicationId}
      ORDER BY transitioned_at DESC
      LIMIT 1;
    `) as Record<string, unknown>[];

    const fromStatus = lastRows.length > 0 ? String(lastRows[0].to_status) : null;

    // Only add transition if there's a prior stage to transition from
    // and it's different from the target
    if (fromStatus && fromStatus !== targetStageName) {
      await sql`
        INSERT INTO application_transitions (application_id, from_status, to_status, transitioned_at)
        VALUES (${applicationId}, ${fromStatus}, ${targetStageName}, NOW());
      `;
    }
  } else {
    // Forward move: simple append
    await sql`
      INSERT INTO application_transitions (application_id, from_status, to_status, transitioned_at)
      VALUES (${applicationId}, ${currentStageName}, ${targetStageName}, NOW());
    `;
  }
}

export async function updateApplicationStage(id: number, toStageId: number): Promise<Application | null> {
  await ensureSchema();

  const currentRows = (await sql`
    SELECT a.id, a.stage_id AS stageId, s.name AS stageName, s.sort_order AS sortOrder
    FROM applications a
    JOIN stages s ON s.id = a.stage_id
    WHERE a.id = ${id}
    LIMIT 1;
  `) as Record<string, unknown>[];

  if (currentRows.length === 0) {
    return null;
  }

  const targetRows = (await sql`
    SELECT id, name, sort_order AS sortOrder
    FROM stages
    WHERE id = ${toStageId}
    LIMIT 1;
  `) as Record<string, unknown>[];

  if (targetRows.length === 0) {
    throw new Error("Target stage not found");
  }

  const currentStageId = Number(currentRows[0].stageid);
  const currentStageName = String(currentRows[0].stagename);
  const currentSortOrder = Number(currentRows[0].sortorder);
  const targetStageId = Number(targetRows[0].id);
  const targetStageName = String(targetRows[0].name);
  const targetSortOrder = Number(targetRows[0].sortorder);

  if (currentStageId !== targetStageId) {
    await sql`
      UPDATE applications
      SET stage_id = ${targetStageId}, updated_at = NOW()
      WHERE id = ${id};
    `;

    await recordTransition(id, currentStageName, targetStageName, targetSortOrder, currentSortOrder);
  }

  return selectApplicationById(id);
}

export async function deleteApplication(id: number): Promise<boolean> {
  await ensureSchema();

  await sql`
    DELETE FROM application_transitions
    WHERE application_id = ${id};
  `;

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
}

export async function updateApplication(id: number, input: UpdateApplicationInput): Promise<Application | null> {
  await ensureSchema();

  const currentRows = (await sql`
    SELECT a.id, a.stage_id AS stageId, s.name AS stageName, s.sort_order AS sortOrder
    FROM applications a
    JOIN stages s ON s.id = a.stage_id
    WHERE a.id = ${id}
    LIMIT 1;
  `) as Record<string, unknown>[];

  if (currentRows.length === 0) {
    return null;
  }

  const targetRows = (await sql`
    SELECT id, name, sort_order AS sortOrder
    FROM stages
    WHERE id = ${input.stageId}
    LIMIT 1;
  `) as Record<string, unknown>[];

  if (targetRows.length === 0) {
    throw new Error("Target stage not found");
  }

  const currentStageId = Number(currentRows[0].stageid);
  const currentStageName = String(currentRows[0].stagename);
  const currentSortOrder = Number(currentRows[0].sortorder);
  const targetStageId = Number(targetRows[0].id);
  const targetStageName = String(targetRows[0].name);
  const targetSortOrder = Number(targetRows[0].sortorder);

  await sql`
    UPDATE applications
    SET
      company = ${input.company.trim()},
      role = ${input.role.trim()},
      notes = ${input.notes?.trim() || null},
      interview_date = ${input.interviewDate ? input.interviewDate : null},
      source_url = ${input.sourceUrl?.trim() || null},
      stage_id = ${targetStageId},
      updated_at = NOW()
    WHERE id = ${id};
  `;

  if (currentStageId !== targetStageId) {
    await recordTransition(id, currentStageName, targetStageName, targetSortOrder, currentSortOrder);
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
           ORDER BY t.transitioned_at ASC LIMIT 1),
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
    createdByDayRows,
    transitionsByDayRows,
    topCompanyRows,
    reachedRows,
    stagePairRows,
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
           ORDER BY t.transitioned_at ASC LIMIT 1),
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
  ]);

  const stageCounts = stageCountRows.map((row) => ({
    stage: String(row.name),
    count: Number(row.count),
    sortOrder: Number(row.sortorder)
  }));

  const totalApps = stageCounts.reduce((sum, row) => sum + row.count, 0);
  const activeStages = stageCounts.filter((row) => row.count > 0).length;
  const totalTransitions = Number(transitionCountRows[0]?.count ?? 0);
  const avgDaysInPipeline = Math.round(Number(avgDaysRows[0]?.days ?? 0) * 10) / 10;

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

  return {
    totals: {
      applications: totalApps,
      activeStages,
      transitions: totalTransitions,
      avgDaysInPipeline
    },
    stageCounts,
    applicationsOverTime,
    transitionsByDay,
    topCompanies,
    funnel,
    stagePairs
  };
}
