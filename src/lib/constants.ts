import type { StageKind } from "@/lib/types";

export { STALE_THRESHOLD_DAYS, isApplicationStale, isStaleEligibleStage } from "./stale.ts";

// The fewest applications a median is shown for; below it the stats show "—"
// (owner decision 9 of the product plan).
export const MEDIAN_MIN_SAMPLE = 5;

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
