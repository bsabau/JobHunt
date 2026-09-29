// Week arithmetic on YYYY-MM-DD strings, for the weekly stats. Loadable
// straight from Node for tests/weeks.test.mjs. Dates are never parsed with
// new Date(string): each is built from its parts at UTC midnight, so the
// result does not depend on the zone the code runs in.

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

// The Monday on or before the date (weeks start on Monday, owner decision 8).
export function weekStartOf(date: string): string {
  const weekday = new Date(toUtcMs(date)).getUTCDay(); // 0 is Sunday
  return addDays(date, -((weekday + 6) % 7));
}

// Every week from the first one with applications through `untilWeekStart`
// (the current week, so a quiet stretch shows as empty weeks), with a running
// total. Nothing when no application was sent.
export function fillWeeks(
  rows: readonly { weekStart: string; sent: number }[],
  untilWeekStart: string
): { weekStart: string; sent: number; cumulative: number }[] {
  if (rows.length === 0) {
    return [];
  }
  const sentByWeek = new Map(rows.map((row) => [row.weekStart, row.sent]));
  const first = rows.reduce((min, row) => (row.weekStart < min ? row.weekStart : min), rows[0].weekStart);
  const last = rows.reduce((max, row) => (row.weekStart > max ? row.weekStart : max), untilWeekStart);
  const weeks: { weekStart: string; sent: number; cumulative: number }[] = [];
  let cumulative = 0;
  for (let week = first; week <= last; week = addDays(week, 7)) {
    const sent = sentByWeek.get(week) ?? 0;
    cumulative += sent;
    weeks.push({ weekStart: week, sent, cumulative });
  }
  return weeks;
}

// A week is still open while fewer than `days` have passed since its last day
// (the Sunday): its applications can still get replies, so its figures can
// still rise. `today` is the viewer's date, from todayInTimeZone() and the
// page's `now`.
export function isWeekOpen(weekStart: string, days: number, today: string): boolean {
  const lastDay = addDays(weekStart, 6);
  return (toUtcMs(today) - toUtcMs(lastDay)) / DAY_MS < days;
}
