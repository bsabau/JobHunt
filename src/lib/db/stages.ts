import { ConflictError, InvalidInputError, NotFoundError } from "@/lib/api-errors";
import { stageUpdateStatement } from "@/lib/stage-statements";
import { DEFAULT_CREATE_KIND, StageKind } from "@/lib/stage-kinds";
import { Stage } from "@/lib/types";
import { ensureSchema, getSql, hasPgCode, pgConstraint, sql, transaction } from "./client";
import { mapStage } from "./rows";

// "New" labels the Sankey entry node, and "created" marked creation in early
// history rows (removed by migration 1730000010000); neither may name a real
// stage, since the analytics would merge it with those.
const RESERVED_STAGE_NAMES = new Set(["created", "new"]);

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

export async function getDefaultCreateStage(): Promise<{ id: number; name: string }> {
  await ensureSchema();

  const appliedRows = (await sql`
    SELECT id, name
    FROM stages
    WHERE kind = ${DEFAULT_CREATE_KIND}
    ORDER BY sort_order ASC, id ASC
    LIMIT 1;
  `) as Record<string, unknown>[];

  if (appliedRows.length > 0) {
    return { id: Number(appliedRows[0].id), name: String(appliedRows[0].name) };
  }

  return getFirstStage();
}

export async function listStages(): Promise<Stage[]> {
  await ensureSchema();

  const rows = (await sql`
    SELECT id, name, sort_order AS sortOrder, kind
    FROM stages
    ORDER BY sort_order ASC, id ASC;
  `) as Record<string, unknown>[];

  return rows.map(mapStage);
}

export async function addStage(name: string, kind: StageKind = DEFAULT_CREATE_KIND): Promise<Stage> {
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

  return mapStage(inserted[0]);
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
    throw error;
  }

  if (rows.length === 0) {
    throw new NotFoundError("Stage not found");
  }

  return mapStage(rows[0]);
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
