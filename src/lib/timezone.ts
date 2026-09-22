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
