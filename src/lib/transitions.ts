export interface TransitionRecord {
  id: number;
  fromStatus: string;
  toStatus: string;
  transitionedAt: string;
}

// `sortOrder` is the pipeline rank (withPipelineRank in stage-kinds.ts), not
// the board position: outcome lanes rank after every pipeline lane, so moving a
// card into one is always forward and never truncates its history.
export interface StageOrder {
  name: string;
  sortOrder: number;
}

// Reference implementation of the stage-rewind rule. `stageMoveQuery` in
// db.ts performs the same truncation atomically in a single SQL statement; keep
// the two in step and exercise this one with `npm run verify:transitions`.
//
// The history is treated as an ordered path `[entry, to₁, to₂, …]`:
//   - every edge before the first one that reaches or passes the target is kept;
//   - if that boundary edge lands exactly on the target, it is kept with its
//     original timestamp (this is what preserves the earliest interview date);
//   - otherwise a reconnect edge `last_kept → target` is added, where
//     `last_kept` falls back to the entry stage;
//   - when the target sorts before the entry stage, the history is cleared.
export function rewindTransitionPath(
  transitions: TransitionRecord[],
  target: StageOrder,
  currentStageName: string,
  stages: StageOrder[]
): TransitionRecord[] {
  const sortOf = new Map(stages.map((stage) => [stage.name, stage.sortOrder]));
  const sorted = [...transitions].sort((a, b) => {
    if (a.transitionedAt !== b.transitionedAt) {
      return a.transitionedAt < b.transitionedAt ? -1 : 1;
    }
    return a.id - b.id;
  });

  const entryName = sorted.length > 0 ? sorted[0].fromStatus : currentStageName;
  const entrySort = sortOf.get(entryName);

  // Moving before the stage the application entered in clears the path.
  if (entrySort !== undefined && target.sortOrder < entrySort) {
    return [];
  }

  const boundaryIndex = sorted.findIndex((transition) => {
    const sort = sortOf.get(transition.toStatus);
    return sort !== undefined && sort >= target.sortOrder;
  });

  if (boundaryIndex === -1) {
    return sorted;
  }

  const boundary = sorted[boundaryIndex];
  const prefix = sorted.slice(0, boundaryIndex);
  const result = [...prefix];

  if (boundary.toStatus === target.name) {
    // Revisiting a stage keeps the edge that first led there, timestamp intact.
    result.push(boundary);
  } else {
    const from = prefix.length > 0 ? prefix[prefix.length - 1].toStatus : entryName;
    if (from !== target.name) {
      result.push({
        id: boundary.id,
        fromStatus: from,
        toStatus: target.name,
        transitionedAt: boundary.transitionedAt
      });
    }
  }

  return result;
}
