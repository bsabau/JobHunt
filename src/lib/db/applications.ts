import { ConflictError, InvalidInputError } from "@/lib/api-errors";
import { SqlFragment, sqlFragment, stageMoveStatement } from "@/lib/stage-statements";
import { TERMINAL_KINDS } from "@/lib/stage-kinds";
import { Application } from "@/lib/types";
import { ensureSchema, getSql, isStageForeignKeyViolation, sql } from "./client";
import { mapApplication } from "./rows";
import { getDefaultCreateStage } from "./stages";

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
