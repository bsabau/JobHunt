// The stats page's funnel: how many applications reached each lane, and of
// those, the share that went further. Loadable straight from Node for
// tests/funnel.test.mjs.

import { compareStageRank, isTerminalKind, type StageKind } from "./stage-kinds.ts";

export interface FunnelLane {
  id: number;
  name: string;
  sortOrder: number;
  kind: StageKind;
}

// One lane an application visited: its entry lane or a lane it moved into.
export interface FunnelVisit {
  applicationId: number;
  stageId: number;
}

export interface FunnelStep {
  stage: string;
  reached: number;
  sortOrder: number;
  kind: StageKind;
  // Percent (one decimal) of the applications that reached this lane and also
  // reached a pipeline lane ranked after it. Counted per application, so a card
  // added straight into a later lane, or one that skipped this lane, does not
  // inflate it. null for outcome lanes, the last pipeline lane and a lane
  // nobody reached.
  advanced: number | null;
}

// Lanes in pipeline rank (outcome lanes after every pipeline lane, wherever
// they sit on the board), with the number of applications that reached each
// and the share of those that went further.
export function buildFunnel(lanes: readonly FunnelLane[], visits: readonly FunnelVisit[]): FunnelStep[] {
  const ranked = [...lanes].sort(compareStageRank);
  const pipelineRank = new Map<number, number>();
  ranked.filter((lane) => !isTerminalKind(lane.kind)).forEach((lane, index) => pipelineRank.set(lane.id, index));
  const lastPipelineRank = pipelineRank.size - 1;

  const reachedBy = new Map<number, Set<number>>();
  // The furthest pipeline lane each application reached, by rank.
  const furthest = new Map<number, number>();
  for (const visit of visits) {
    const applications = reachedBy.get(visit.stageId) ?? new Set<number>();
    applications.add(visit.applicationId);
    reachedBy.set(visit.stageId, applications);
    const rank = pipelineRank.get(visit.stageId);
    if (rank !== undefined && rank > (furthest.get(visit.applicationId) ?? -1)) {
      furthest.set(visit.applicationId, rank);
    }
  }

  return ranked.map((lane) => {
    const applications = reachedBy.get(lane.id) ?? new Set<number>();
    const rank = pipelineRank.get(lane.id);
    let advanced: number | null = null;
    if (rank !== undefined && rank < lastPipelineRank && applications.size > 0) {
      let wentFurther = 0;
      for (const applicationId of applications) {
        if ((furthest.get(applicationId) ?? -1) > rank) wentFurther++;
      }
      advanced = Math.round((wentFurther / applications.size) * 1000) / 10;
    }
    return { stage: lane.name, reached: applications.size, sortOrder: lane.sortOrder, kind: lane.kind, advanced };
  });
}
