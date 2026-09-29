import { buildSankeyPayload } from "@/lib/sankey";
import { withPipelineRank } from "@/lib/stage-kinds";
import { SankeyPayload } from "@/lib/types";
import { ensureSchema, transaction } from "./client";
import { StageRow, mapStage } from "./rows";

export async function getSankeyData(): Promise<SankeyPayload> {
  await ensureSchema();

  // One request and one snapshot, so the lanes, links and nodes agree.
  const [stageRows, transitionRows, entryRows, currentRows] = (await transaction((tx) => [
    tx`
      SELECT id, name, sort_order, kind
      FROM stages
      ORDER BY sort_order ASC, id ASC;
    `,
    tx`
      SELECT t.from_status, t.from_stage_id, t.to_status, t.to_stage_id, a.company
      FROM application_transitions t
      JOIN applications a ON a.id = t.application_id
      -- A fixed order keeps the Sankey layout stable; without one, any UPDATE
      -- (such as a lane rename) can reorder the links and move the flows.
      ORDER BY t.transitioned_at, t.id;
    `,
    tx`
      SELECT e.stage_id, e.stage_name, a.company
      FROM application_entry_stage e
      JOIN applications a ON a.id = e.application_id;
    `,
    tx`
      SELECT s.id AS stage_id, s.name AS stage_name, a.company
      FROM applications a
      JOIN stages s ON s.id = a.stage_id;
    `,
  ], { readOnly: true, isolationLevel: "RepeatableRead" })) as [
    StageRow[],
    { from_status: string; from_stage_id: number | null; to_status: string; to_stage_id: number | null; company: string }[],
    { stage_id: number | null; stage_name: string; company: string }[],
    { stage_id: number; stage_name: string; company: string }[]
  ];

  const stages = stageRows.map(mapStage);

  return buildSankeyPayload({
    stages: withPipelineRank(stages).map((stage) => ({ id: stage.id, name: stage.name, sortOrder: stage.sortOrder, kind: stage.kind })),
    transitions: transitionRows.map((row) => ({
      fromStatus: row.from_status,
      fromStageId: row.from_stage_id,
      toStatus: row.to_status,
      toStageId: row.to_stage_id,
      company: row.company
    })),
    entries: entryRows.map((row) => ({
      entryStage: row.stage_name,
      entryStageId: row.stage_id,
      company: row.company
    })),
    current: currentRows.map((row) => ({
      stageId: row.stage_id,
      stageName: row.stage_name,
      company: row.company
    }))
  });
}
