import { Application, StageKind } from "@/lib/types";

export const DEFAULT_STAGE_NAMES = ["Wishlist", "Applied", "Interview", "Offer", "Rejected"];

export const STALE_THRESHOLD_DAYS = 14;

// Staleness is a pipeline concept: pre-application (Wishlist) and resolved
// stages (Offer/Rejected) are not "going stale", whatever they are named.
const STALE_EXCLUDED_KINDS = new Set<StageKind>(["intake", "offer", "rejected"]);

export function isStaleEligibleStage(kind: StageKind): boolean {
  return !STALE_EXCLUDED_KINDS.has(kind);
}

export function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) {
    return 0;
  }
  return Math.floor((Date.now() - then) / 86_400_000);
}

export function stageEnteredAt(app: Application): string {
  return app.stageEnteredAt ?? app.updatedAt;
}

export function isApplicationStale(app: Application): boolean {
  if (!isStaleEligibleStage(app.stageKind)) {
    return false;
  }
  return daysSince(stageEnteredAt(app)) >= STALE_THRESHOLD_DAYS;
}

export function daysUntil(dateStr: string): number {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const target = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(dateStr);
  if (Number.isNaN(target.getTime())) {
    return 0;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
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
