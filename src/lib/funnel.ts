// The stats page's funnel: how many applications reached each lane, and the
// share that went on from each pipeline lane to the next. Loadable straight
// from Node for tests/funnel.test.mjs.

import { compareStageRank, isTerminalKind, type StageKind } from "./stage-kinds.ts";

export interface FunnelRow {
  stage: string;
  reached: number;
  sortOrder: number;
  kind: StageKind;
}

export interface FunnelStep extends FunnelRow {
  // Percent (one decimal) of this lane's applications that also reached the
  // next pipeline lane. null for outcome lanes, the last pipeline lane, a lane
  // nobody reached, and when the next lane was reached by more applications
  // than this one (cards added straight into it), where a share means nothing.
  advanced: number | null;
}

// Lanes in pipeline rank (outcome lanes after every pipeline lane, wherever
// they sit on the board), each with its advance rate.
export function buildFunnel(rows: readonly FunnelRow[]): FunnelStep[] {
  const ranked = [...rows].sort(compareStageRank);
  const pipeline = ranked.filter((row) => !isTerminalKind(row.kind));
  const advanced = new Map<FunnelRow, number>();

  for (let index = 0; index < pipeline.length - 1; index++) {
    const from = pipeline[index];
    const to = pipeline[index + 1];
    if (from.reached > 0 && to.reached <= from.reached) {
      advanced.set(from, Math.round((to.reached / from.reached) * 1000) / 10);
    }
  }

  return ranked.map((row) => ({ ...row, advanced: advanced.get(row) ?? null }));
}
