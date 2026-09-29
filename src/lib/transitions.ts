// A history edge. The ids are the reference to the lanes; the names are the
// lanes' names, kept in step on rename and all that is left once a lane is
// deleted (id null). Records without ids (undefined) are matched by name.
export interface TransitionRecord {
  id: number;
  fromStatus: string;
  toStatus: string;
  fromStageId?: number | null;
  toStageId?: number | null;
  transitionedAt: string;
}

// `sortOrder` is the pipeline rank (withPipelineRank in stage-kinds.ts), not
// the board position: outcome lanes rank after every pipeline lane, so moving a
// card into one is always forward and never truncates its history.
export interface StageOrder {
  id?: number;
  name: string;
  sortOrder: number;
}

// The current lane an edge endpoint refers to: by id when the record has one
// (null means the lane was deleted), by name otherwise.
function laneOf(stages: StageOrder[], id: number | null | undefined, name: string): StageOrder | undefined {
  if (id !== undefined) {
    return id === null ? undefined : stages.find((stage) => stage.id === id);
  }
  return stages.find((stage) => stage.name === name);
}

function isLane(id: number | null | undefined, name: string, lane: StageOrder): boolean {
  return id !== undefined && lane.id !== undefined ? id === lane.id : name === lane.name;
}

// Reference implementation of the stage-rewind rule. `stageMoveStatement` in
// stage-statements.ts performs the same truncation atomically in a single SQL
// statement; tests/stage-statements.test.mjs runs both on the same scenarios.
//
// The history is treated as an ordered path `[entry, to₁, to₂, …]`:
//   - every edge before the first one that reaches or passes the target is kept;
//   - if that boundary edge lands exactly on the target, it is kept with its
//     original timestamp (this is what preserves the earliest interview date);
//   - otherwise a reconnect edge `last_kept → target` is added, where
//     `last_kept` falls back to the entry stage;
//   - when the target sorts before the entry stage, the history is cleared.
// Edges into a deleted lane are skipped when looking for the boundary.
export function rewindTransitionPath(
  transitions: TransitionRecord[],
  target: StageOrder,
  currentStageName: string,
  stages: StageOrder[]
): TransitionRecord[] {
  const sorted = [...transitions].sort((a, b) => {
    if (a.transitionedAt !== b.transitionedAt) {
      return a.transitionedAt < b.transitionedAt ? -1 : 1;
    }
    return a.id - b.id;
  });

  const current = stages.find((stage) => stage.name === currentStageName);
  const entry =
    sorted.length > 0
      ? { name: sorted[0].fromStatus, id: sorted[0].fromStageId }
      : { name: currentStageName, id: current?.id };
  const entryLane = laneOf(stages, entry.id, entry.name);

  // Moving before the stage the application entered in clears the path.
  if (entryLane !== undefined && target.sortOrder < entryLane.sortOrder) {
    return [];
  }

  const boundaryIndex = sorted.findIndex((transition) => {
    const lane = laneOf(stages, transition.toStageId, transition.toStatus);
    return lane !== undefined && lane.sortOrder >= target.sortOrder;
  });

  if (boundaryIndex === -1) {
    return sorted;
  }

  const boundary = sorted[boundaryIndex];
  const prefix = sorted.slice(0, boundaryIndex);
  const result = [...prefix];

  if (isLane(boundary.toStageId, boundary.toStatus, target)) {
    // Revisiting a stage keeps the edge that first led there, timestamp intact.
    result.push(boundary);
  } else {
    const last = prefix[prefix.length - 1];
    const from = last ? { name: last.toStatus, id: last.toStageId } : entry;
    // A deleted lane that shared the target's name counts as the target too,
    // as in the SQL, whose no-self-loop check compares names.
    if (!isLane(from.id, from.name, target) && from.name !== target.name) {
      result.push({
        id: boundary.id,
        fromStatus: from.name,
        toStatus: target.name,
        ...(from.id !== undefined ? { fromStageId: from.id } : {}),
        ...(target.id !== undefined ? { toStageId: target.id } : {}),
        transitionedAt: boundary.transitionedAt
      });
    }
  }

  return result;
}
