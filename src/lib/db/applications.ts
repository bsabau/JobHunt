import { ConflictError, InvalidInputError, NotFoundError } from "@/lib/api-errors";
import { SqlFragment, sqlFragment, stageMoveStatement } from "@/lib/stage-statements";
import { TERMINAL_KINDS } from "@/lib/stage-kinds";
import { InterviewEventRow, StaleAction, interviewEventStatement, staleActionStatement } from "@/lib/application-statements";
import type { Role } from "@/lib/auth";
import type { WorkMode } from "@/lib/limits";
import { Application } from "@/lib/types";
import { ensureSchema, getSql, isStageForeignKeyViolation, sql } from "./client";
import { ApplicationRow, mapApplication } from "./rows";
import { getDefaultCreateStage } from "./stages";

async function selectApplicationById(id: number): Promise<Application | null> {
  await ensureSchema();

  const rows = (await sql`
    SELECT
      a.id,
      a.company,
      a.role,
      a.notes,
      a.interview_date::text AS interview_date,
      to_char(a.interview_time, 'HH24:MI') AS interview_time,
      a.interview_time_zone,
      a.source_url,
      a.logo_url,
      a.referral,
      a.work_mode,
      a.location,
      a.salary,
      a.stage_id,
      s.name AS stage_name,
      s.kind AS stage_kind,
      a.created_at,
      a.updated_at,
      e.entered_at AS stage_entered_at,
      p.applied_at,
      c.clock_started_at AS stale_clock_at,
      c.followed_up_at,
      c.snoozed_until
    FROM applications a
    JOIN stages s ON s.id = a.stage_id
    JOIN application_stage_entry e ON e.application_id = a.id
    JOIN application_applied_at p ON p.application_id = a.id
    JOIN application_stale_clock c ON c.application_id = a.id
    WHERE a.id = ${id};
  `) as ApplicationRow[];

  if (rows.length === 0) {
    return null;
  }

  // Only the owner-only write routes (create, edit, move) read a single
  // application, so the viewer is always the owner.
  return mapApplication(rows[0], "user");
}

// `viewer` decides what the caller may see: a guest gets no notes.
export async function listApplications(viewer: Role): Promise<Application[]> {
  await ensureSchema();

  const rows = (await sql`
    SELECT
      a.id,
      a.company,
      a.role,
      a.notes,
      a.interview_date::text AS interview_date,
      to_char(a.interview_time, 'HH24:MI') AS interview_time,
      a.interview_time_zone,
      a.source_url,
      a.logo_url,
      a.referral,
      a.work_mode,
      a.location,
      a.salary,
      a.stage_id,
      s.name AS stage_name,
      s.kind AS stage_kind,
      a.created_at,
      a.updated_at,
      e.entered_at AS stage_entered_at,
      p.applied_at,
      c.clock_started_at AS stale_clock_at,
      c.followed_up_at,
      c.snoozed_until
    FROM applications a
    JOIN stages s ON s.id = a.stage_id
    JOIN application_stage_entry e ON e.application_id = a.id
    JOIN application_applied_at p ON p.application_id = a.id
    JOIN application_stale_clock c ON c.application_id = a.id
    ORDER BY a.updated_at DESC, a.id DESC;
  `) as ApplicationRow[];

  return rows.map((row) => mapApplication(row, viewer));
}

// Records what the owner did about a stale application (see
// staleActionStatement()); throws NotFoundError for an unknown one.
export async function recordStaleAction(id: number, action: StaleAction): Promise<Application> {
  await ensureSchema();

  const statement = staleActionStatement(id, action, new Date().toISOString());
  const rows = (await getSql().query(statement.text, statement.params)) as { id: number }[];

  const updated = rows.length === 0 ? null : await selectApplicationById(id);
  if (!updated) {
    throw new NotFoundError("Application not found");
  }
  return updated;
}

// Stores a looked-up logo. The lookup runs after the response, so it only
// writes while the application still has the company it was looked up for,
// and it leaves updated_at alone: a logo is not an edit and must not reorder
// the board.
export async function setApplicationLogo(id: number, company: string, logoUrl: string | null): Promise<void> {
  await ensureSchema();

  await sql`
    UPDATE applications
    SET logo_url = ${logoUrl}
    WHERE id = ${id} AND company = ${company} AND logo_url IS DISTINCT FROM ${logoUrl};
  `;
}

// The optional fields shared by create and update. A full update replaces
// them all, so a body without them clears them.
interface OptionalFields {
  // Set together or not at all (validated by the route; the database checks it).
  interviewTime?: string;
  interviewTimeZone?: string;
  referral: boolean;
  workMode?: WorkMode;
  location?: string;
  salary?: string;
}

interface CreateApplicationInput extends OptionalFields {
  company: string;
  role: string;
  notes?: string;
  interviewDate?: string | null;
  sourceUrl?: string;
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
        `) as { id: number; name: string }[])
      : [];

  if (input.stageId !== undefined && selectedStageRows.length === 0) {
    throw new InvalidInputError("Invalid stage");
  }

  const stage =
    selectedStageRows.length > 0
      ? selectedStageRows[0]
      : await getDefaultCreateStage();

  let insertRows: { id: number }[];

  try {
    insertRows = (await sql`
      INSERT INTO applications (
        company,
        role,
        notes,
        interview_date,
        interview_time,
        interview_time_zone,
        source_url,
        referral,
        work_mode,
        location,
        salary,
        stage_id,
        created_at,
        updated_at
      ) VALUES (
        ${input.company.trim()},
        ${input.role.trim()},
        ${input.notes?.trim() || null},
        ${input.interviewDate ? input.interviewDate : null},
        ${input.interviewTime ?? null},
        ${input.interviewTimeZone ?? null},
        ${input.sourceUrl?.trim() || null},
        ${input.referral},
        ${input.workMode ?? null},
        ${input.location?.trim() || null},
        ${input.salary?.trim() || null},
        ${stage.id},
        NOW(),
        NOW()
      )
      RETURNING id;
    `) as { id: number }[];
  } catch (error) {
    if (isStageForeignKeyViolation(error)) {
      throw new InvalidInputError("Invalid stage");
    }
    throw error;
  }

  const applicationId = insertRows[0].id;

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
  expectedStageId: number,
  toStageId: number
): Promise<StageMoveOutcome> {
  let rows: { found: number; updated: number }[];

  try {
    const statement = stageMoveStatement(updateSet, applicationId, expectedStageId, toStageId, TERMINAL_KINDS);
    rows = (await getSql().query(statement.text, statement.params)) as { found: number; updated: number }[];
  } catch (error) {
    if (isStageForeignKeyViolation(error)) {
      throw new InvalidInputError("Target stage not found");
    }
    throw error;
  }

  const found = rows[0]?.found ?? 0;
  const updated = rows[0]?.updated ?? 0;

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
  expectedStageId: number
): Promise<Application | null> {
  await ensureSchema();

  // An unknown target lane fails the stage_id foreign key inside the move
  // statement, which applyStageMove maps to "Target stage not found".
  const outcome = await applyStageMove(
    sqlFragment`stage_id = ${toStageId}, updated_at = NOW()`,
    id,
    expectedStageId,
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
  `) as { id: number }[];

  return deletedRows.length > 0;
}

interface UpdateApplicationInput extends OptionalFields {
  company: string;
  role: string;
  notes?: string;
  interviewDate?: string | null;
  sourceUrl?: string;
  stageId: number;
  // The concurrency guard: the lane the caller last saw the card in.
  expectedStageId: number;
}

export async function updateApplication(id: number, input: UpdateApplicationInput): Promise<Application | null> {
  await ensureSchema();

  // An unknown target lane fails the stage_id foreign key inside the move
  // statement, which applyStageMove maps to "Target stage not found".
  const outcome = await applyStageMove(
    // SET expressions read the row as it was, so this compares the old
    // company with the new one. A different company (not just different case
    // or spacing) must not keep the old company's logo; the edit route then
    // schedules a lookup for any card left without one.
    sqlFragment`
      logo_url = CASE
        WHEN LOWER(btrim(company)) = LOWER(${input.company.trim()}) THEN logo_url
        ELSE NULL
      END,
      company = ${input.company.trim()},
      role = ${input.role.trim()},
      notes = ${input.notes?.trim() || null},
      interview_date = ${input.interviewDate ? input.interviewDate : null},
      source_url = ${input.sourceUrl?.trim() || null},
      interview_time = ${input.interviewTime ?? null},
      interview_time_zone = ${input.interviewTimeZone ?? null},
      referral = ${input.referral},
      work_mode = ${input.workMode ?? null},
      location = ${input.location?.trim() || null},
      salary = ${input.salary?.trim() || null},
      stage_id = ${input.stageId},
      updated_at = NOW()
    `,
    id,
    input.expectedStageId,
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

// Whether Postgres knows a time zone name: the calendar file converts with
// AT TIME ZONE, so a zone that passes Intl but not Postgres is refused on save.
export async function isKnownTimeZone(zone: string): Promise<boolean> {
  await ensureSchema();
  const rows = (await sql`SELECT 1 FROM pg_timezone_names WHERE name = ${zone} LIMIT 1;`) as unknown[];
  return rows.length > 0;
}

// The calendar event for one application (interviewEventStatement()), or null
// for an unknown one. Owner-only: the route checks the session.
export async function getInterviewEvent(id: number): Promise<InterviewEventRow | null> {
  await ensureSchema();
  const statement = interviewEventStatement(id);
  const rows = (await getSql().query(statement.text, statement.params)) as InterviewEventRow[];
  return rows[0] ?? null;
}
