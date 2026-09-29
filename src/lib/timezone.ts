export const DEFAULT_TIME_ZONE = "UTC";
export const TIME_ZONE_COOKIE = "tz";

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(value: unknown): string {
  return isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}

// The calendar date the viewer is currently on, expressed in their timezone.
// A single Date instant can be two different dates depending on the zone, so
// every relative-date decision goes through this rather than the server's own
// local midnight.
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const get = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "01";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Whole-day difference between two YYYY-MM-DD dates. Both are anchored to UTC
// midnight so the difference is timezone-independent.
export function daysBetweenDateOnly(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);

  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return 0;
  }

  return Math.round((toMs - fromMs) / 86_400_000);
}

// Relative dates take `now` from the caller instead of reading the clock: a
// page takes one timestamp on the server and passes it down, so the server
// render and the browser's hydration compute the same ages and labels.
export function daysSince(isoDate: string, now: number): number {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) {
    return 0;
  }
  return Math.floor((now - then) / 86_400_000);
}

export function daysUntil(dateStr: string, timeZone: string | undefined, now: number): number {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!dateOnly) {
    const target = new Date(dateStr);
    if (Number.isNaN(target.getTime())) {
      return 0;
    }
    target.setHours(0, 0, 0, 0);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86_400_000);
  }

  const targetDate = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  const today = timeZone ? todayInTimeZone(timeZone, new Date(now)) : localTodayDateOnly(now);
  return daysBetweenDateOnly(today, targetDate);
}

function localTodayDateOnly(now: number): string {
  const today = new Date(now);
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
}
