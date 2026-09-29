// Stage kinds carry the semantics of a lane; the lane's board position is only
// layout. This module has no runtime imports so the verify scripts can load it
// straight from Node.

export const STAGE_KINDS = ["intake", "active", "interview", "offer", "rejected", "closed"] as const;

export type StageKind = (typeof STAGE_KINDS)[number];

export const KIND_LABELS: Record<StageKind, string> = {
  intake: "Wishlist",
  active: "Pipeline",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  closed: "Closed"
};

export const KIND_DESCRIPTIONS: Record<StageKind, string> = {
  intake: "Not applied yet",
  active: "In progress, can go stale",
  interview: "Counts towards time-to-interview",
  offer: "Offer received",
  rejected: "Outcome: rejected",
  closed: "Outcome: dead end without a rejection (e.g. ghosted)"
};

// Outcome lanes: a card that lands here has left the pipeline. Offer stays in
// the pipeline group so "Offer -> Rejected" (declined or rescinded) is a
// forward move and "Rejected -> Offer" is an undo.
export const TERMINAL_KINDS: readonly StageKind[] = ["rejected", "closed"];

export function isTerminalKind(kind: StageKind | undefined): boolean {
  return kind !== undefined && TERMINAL_KINDS.includes(kind);
}

// Kinds that are never "going stale": not applied yet, or already resolved.
export const STALE_EXCLUDED_KINDS: readonly StageKind[] = ["intake", "offer", "rejected", "closed"];

// Pipeline rank: every terminal lane sorts after every pipeline lane, whatever
// its board position, so moving a card into an outcome lane is always forward.
// db.ts `stageMoveQuery` implements the same rule in SQL as the row value
// (kind IN ('rejected','closed'), sort_order); keep the two in step.
export function compareStageRank(
  a: { sortOrder: number; kind?: StageKind },
  b: { sortOrder: number; kind?: StageKind }
): number {
  const terminalDelta = Number(isTerminalKind(a.kind)) - Number(isTerminalKind(b.kind));
  return terminalDelta !== 0 ? terminalDelta : a.sortOrder - b.sortOrder;
}

// Replaces each stage's sortOrder with its pipeline rank (0..n-1), for the pure
// history helpers that only compare sortOrder.
export function withPipelineRank<T extends { sortOrder: number; kind?: StageKind }>(stages: T[]): T[] {
  return [...stages].sort(compareStageRank).map((stage, rank) => ({ ...stage, sortOrder: rank }));
}

export const KIND_COLORS: Record<StageKind, string> = {
  intake: "#94a3b8",
  active: "#60a5fa",
  interview: "#818cf8",
  offer: "#34d399",
  rejected: "#f87171",
  closed: "#cbd5e1"
};

// Name colours for pipeline lanes and for history-only names that no longer
// have a stage (and so no kind).
const NAME_COLORS: Record<string, string> = {
  new: "#64748b",
  wishlist: "#94a3b8",
  applied: "#60a5fa",
  screening: "#a78bfa",
  interview: "#818cf8",
  ghosting: "#cbd5e1",
  offer: "#34d399",
  rejected: "#f87171"
};

const FALLBACK_COLOR = "#94a3b8";
const PALETTE = ["#60a5fa", "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#818cf8", "#22d3ee", "#fb7185"];

// Outcome and interview kinds share one colour so every rejection lane is red
// and every interview round matches; pipeline lanes keep their own colours.
export function colorFor(name: string, kind?: StageKind, fallbackIndex?: number): string {
  if (kind && kind !== "active" && kind !== "intake") {
    return KIND_COLORS[kind];
  }

  const named = NAME_COLORS[name.toLowerCase()];
  if (named) {
    return named;
  }

  if (fallbackIndex !== undefined) {
    return PALETTE[fallbackIndex % PALETTE.length] ?? FALLBACK_COLOR;
  }

  return kind ? KIND_COLORS[kind] : FALLBACK_COLOR;
}
