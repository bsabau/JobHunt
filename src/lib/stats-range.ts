// The stats page's date range: the last 30 or 90 days, or all time (owner
// decision 11 of the product plan). It lives in the URL as ?range=30, so a
// reload or a shared link keeps it. Loadable straight from Node for
// tests/stats-range.test.mjs.

export const STATS_RANGES = [30, 90] as const;
export type StatsRange = (typeof STATS_RANGES)[number] | null;

// Only the exact values in STATS_RANGES; anything else, an array included,
// means all time.
export function parseStatsRange(value: string | string[] | undefined): StatsRange {
  if (typeof value !== "string") {
    return null;
  }
  return STATS_RANGES.find((days) => String(days) === value) ?? null;
}

// The instant the range starts, `days` before `now`, or null for all time.
// Statements compare it with applied_at: a range means "applications sent in
// this period", so cards not sent yet appear only under all time.
export function rangeStart(range: StatsRange, now: number): string | null {
  return range === null ? null : new Date(now - range * 86_400_000).toISOString();
}

export function rangeLabel(range: StatsRange): string {
  return range === null ? "All time" : `Last ${range} days`;
}
