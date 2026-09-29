import { Application, StageKind } from "@/lib/types";
import { STALE_EXCLUDED_KINDS } from "@/lib/stage-kinds";
import { daysSince } from "@/lib/timezone";

export const STALE_THRESHOLD_DAYS = 14;

// Staleness is a pipeline concept: pre-application (Wishlist) and resolved
// stages (Offer/Rejected/Closed) are not "going stale", whatever they are named.
export function isStaleEligibleStage(kind: StageKind): boolean {
  return !STALE_EXCLUDED_KINDS.includes(kind);
}

export function stageEnteredAt(app: Application): string {
  return app.stageEnteredAt ?? app.updatedAt;
}

export function isApplicationStale(app: Application, now: number): boolean {
  if (!isStaleEligibleStage(app.stageKind)) {
    return false;
  }
  return daysSince(stageEnteredAt(app), now) >= STALE_THRESHOLD_DAYS;
}

export const STAGE_TONES = [
  { column: "bg-slate-500/20 border-slate-400/30", logoBg: "bg-slate-500/20" },
  { column: "bg-sky-500/20 border-sky-400/30", logoBg: "bg-sky-500/20" },
  { column: "bg-amber-500/20 border-amber-400/30", logoBg: "bg-amber-500/20" },
  { column: "bg-emerald-500/20 border-emerald-400/30", logoBg: "bg-emerald-500/20" },
  { column: "bg-rose-500/20 border-rose-400/30", logoBg: "bg-rose-500/20" },
  { column: "bg-indigo-500/20 border-indigo-400/30", logoBg: "bg-indigo-500/20" },
  { column: "bg-cyan-500/20 border-cyan-400/30", logoBg: "bg-cyan-500/20" }
] as const;

// Outcome lanes keep a fixed tint wherever they sit on the board; pipeline lanes
// rotate through STAGE_TONES by position.
export const KIND_TONES: Partial<Record<StageKind, { column: string; logoBg: string }>> = {
  offer: { column: "bg-emerald-500/20 border-emerald-400/40", logoBg: "bg-emerald-500/20" },
  rejected: { column: "bg-rose-500/15 border-rose-400/40", logoBg: "bg-rose-500/20" },
  closed: { column: "bg-zinc-500/15 border-zinc-400/30", logoBg: "bg-zinc-500/20" }
};
