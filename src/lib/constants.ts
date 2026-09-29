import { Application, StageKind } from "@/lib/types";
import { STALE_EXCLUDED_KINDS } from "@/lib/stage-kinds";
import { daysBetweenDateOnly, todayInTimeZone } from "@/lib/timezone";

export const STALE_THRESHOLD_DAYS = 14;

// Staleness is a pipeline concept: pre-application (Wishlist) and resolved
// stages (Offer/Rejected/Closed) are not "going stale", whatever they are named.
export function isStaleEligibleStage(kind: StageKind): boolean {
  return !STALE_EXCLUDED_KINDS.includes(kind);
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

export function daysUntil(dateStr: string, timeZone?: string): number {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!dateOnly) {
    const target = new Date(dateStr);
    if (Number.isNaN(target.getTime())) {
      return 0;
    }
    target.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86_400_000);
  }

  const targetDate = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  const today = timeZone ? todayInTimeZone(timeZone) : localTodayDateOnly();
  return daysBetweenDateOnly(today, targetDate);
}

function localTodayDateOnly(): string {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
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
