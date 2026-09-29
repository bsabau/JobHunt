import { buildSankeyPayload } from "@/lib/sankey";
import { withPipelineRank } from "@/lib/stage-kinds";
import { SankeyPayload } from "@/lib/types";
import { ensureSchema, transaction } from "./client";
import { mapStage } from "./rows";

export async function getSankeyData(): Promise<SankeyPayload> {
  await ensureSchema();

  // One request and one snapshot, so the lanes, links and nodes agree.
  const [stageRows, transitionDetails, entryDetails, nodeCompanies] = (await transaction((tx) => [
    tx`
      SELECT id, name, sort_order AS sortOrder, kind
      FROM stages
      ORDER BY sort_order ASC, id ASC;
    `,
    tx`
      SELECT t.from_status AS fromStatus, t.from_stage_id AS fromStageId,
             t.to_status AS toStatus, t.to_stage_id AS toStageId, a.company
      FROM application_transitions t
      JOIN applications a ON a.id = t.application_id
      -- A fixed order keeps the Sankey layout stable; without one, any UPDATE
      -- (such as a lane rename) can reorder the links and move the flows.
      ORDER BY t.transitioned_at, t.id;
    `,
    tx`
      SELECT e.stage_id AS entryStageId, e.stage_name AS entryStage, a.company
      FROM application_entry_stage e
      JOIN applications a ON a.id = e.application_id;
    `,
    tx`
      SELECT s.id AS stageId, s.name AS stageName, a.company
      FROM applications a
      JOIN stages s ON s.id = a.stage_id;
    `,
  ], { readOnly: true, isolationLevel: "RepeatableRead" })) as Record<string, unknown>[][];

  const stages = stageRows.map(mapStage);

  const optionalId = (value: unknown) => (value == null ? null : Number(value));

  return buildSankeyPayload({
    stages: withPipelineRank(stages).map((stage) => ({ id: stage.id, name: stage.name, sortOrder: stage.sortOrder, kind: stage.kind })),
    transitions: transitionDetails.map((row) => ({
      fromStatus: String(row.fromstatus),
      fromStageId: optionalId(row.fromstageid),
      toStatus: String(row.tostatus),
      toStageId: optionalId(row.tostageid),
      company: String(row.company)
    })),
    entries: entryDetails.map((row) => ({
      entryStage: String(row.entrystage),
      entryStageId: optionalId(row.entrystageid),
      company: String(row.company)
    })),
    current: nodeCompanies.map((row) => ({
      stageId: Number(row.stageid),
      stageName: String(row.stagename),
      company: String(row.company)
    }))
  });
}
