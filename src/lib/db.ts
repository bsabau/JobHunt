import { neon } from "@neondatabase/serverless";
import { DEFAULT_STAGE_NAMES } from "@/lib/constants";
import { Application, SankeyPayload, Stage } from "@/lib/types";

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
      await sql`
        CREATE TABLE IF NOT EXISTS stages (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          sort_order INTEGER NOT NULL
        );
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS applications (
          id SERIAL PRIMARY KEY,
          company TEXT NOT NULL,
          role TEXT NOT NULL,
          notes TEXT,
          source_url TEXT,
          logo_url TEXT,
          stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE RESTRICT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS application_transitions (
          id SERIAL PRIMARY KEY,
          application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
          from_status TEXT NOT NULL,
          to_status TEXT NOT NULL,
          transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `;

      for (const [index, name] of DEFAULT_STAGE_NAMES.entries()) {
        await sql`
          INSERT INTO stages (name, sort_order)
          VALUES (${name}, ${index})
          ON CONFLICT (name) DO NOTHING;
        `;
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
      source_url,
      logo_url,
      stage_id,
      created_at,
      updated_at
    ) VALUES (
      ${input.company.trim()},
      ${input.role.trim()},
      ${input.notes?.trim() || null},
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

export async function updateApplicationStage(id: number, toStageId: number): Promise<Application | null> {
  await ensureSchema();

  const currentRows = (await sql`
    SELECT a.id, a.stage_id AS stageId, s.name AS stageName
    FROM applications a
    JOIN stages s ON s.id = a.stage_id
    WHERE a.id = ${id}
    LIMIT 1;
  `) as Record<string, unknown>[];

  if (currentRows.length === 0) {
    return null;
  }

  const targetRows = (await sql`
    SELECT id, name
    FROM stages
    WHERE id = ${toStageId}
    LIMIT 1;
  `) as Record<string, unknown>[];

  if (targetRows.length === 0) {
    throw new Error("Target stage not found");
  }

  const currentStageId = Number(currentRows[0].stageid);
  const currentStageName = String(currentRows[0].stagename);
  const targetStageId = Number(targetRows[0].id);
  const targetStageName = String(targetRows[0].name);

  if (currentStageId !== targetStageId) {
    await sql`
      UPDATE applications
      SET stage_id = ${targetStageId}, updated_at = NOW()
      WHERE id = ${id};
    `;

    await sql`
      INSERT INTO application_transitions (application_id, from_status, to_status, transitioned_at)
      VALUES (${id}, ${currentStageName}, ${targetStageName}, NOW());
    `;
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

export async function getSankeyData(): Promise<SankeyPayload> {
  await ensureSchema();

  const transitions = (await sql`
    SELECT from_status AS fromStatus, to_status AS toStatus, COUNT(*)::int AS value
    FROM application_transitions
    WHERE LOWER(from_status) <> LOWER(${ "created" }) AND LOWER(to_status) <> LOWER(${ "created" })
    GROUP BY from_status, to_status;
  `) as Record<string, unknown>[];

  const stages = await listStages();
  const currentStageNames = stages.map((stage) => stage.name);
  const transitionStageNames = transitions.flatMap((row) => [String(row.fromstatus), String(row.tostatus)]);
  const nodeNames = Array.from(new Set([...currentStageNames, ...transitionStageNames]));

  return {
    nodes: nodeNames.map((name) => ({ name })),
    links: transitions.map((row) => ({
      source: nodeNames.indexOf(String(row.fromstatus)),
      target: nodeNames.indexOf(String(row.tostatus)),
      value: Number(row.value)
    }))
  };
}
