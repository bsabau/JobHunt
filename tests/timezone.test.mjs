import assert from "node:assert/strict";
import {
  daysBetweenDateOnly,
  daysSince,
  daysUntil,
  isValidTimeZone,
  normalizeTimeZone,
  todayInTimeZone
} from "../src/lib/timezone.ts";

// A single instant that falls on different calendar dates across zones.
const instant = new Date("2026-09-15T06:30:00.000Z");

for (const [zone, expected] of [
  ["UTC", "2026-09-15"],
  ["America/Los_Angeles", "2026-09-14"],
  ["America/New_York", "2026-09-15"],
  ["Pacific/Auckland", "2026-09-15"],
  ["Asia/Kolkata", "2026-09-15"]
]) {
  assert.equal(todayInTimeZone(zone, instant), expected, `todayInTimeZone(${zone})`);
}

// An invalid or missing zone must never reach Intl unchecked.
assert.equal(isValidTimeZone("America/Los_Angeles"), true);
assert.equal(isValidTimeZone("Not/AZone"), false);
assert.equal(isValidTimeZone(""), false);
assert.equal(isValidTimeZone(undefined), false);
assert.equal(normalizeTimeZone("Not/AZone"), "UTC");
assert.equal(normalizeTimeZone(undefined), "UTC");
assert.equal(normalizeTimeZone("Europe/Paris"), "Europe/Paris");

// Day math is timezone-independent: it anchors both dates to UTC midnight, so
// the same date-only pair is the same number of days apart everywhere.
assert.equal(daysBetweenDateOnly("2026-09-15", "2026-09-15"), 0);
assert.equal(daysBetweenDateOnly("2026-09-14", "2026-09-15"), 1);
assert.equal(daysBetweenDateOnly("2026-09-15", "2026-09-14"), -1);
assert.equal(daysBetweenDateOnly("2026-12-31", "2027-01-01"), 1);
assert.equal(daysBetweenDateOnly("2026-06-30", "2026-07-01"), 1);

// Relative dates use the caller's `now`, never the clock, so the server render
// and hydration agree.
const now = instant.getTime();
assert.equal(daysSince("2026-09-15T06:30:00.000Z", now), 0);
assert.equal(daysSince("2026-09-14T06:30:00.001Z", now), 0, "a day starts after a full 24 hours");
assert.equal(daysSince("2026-09-14T06:30:00.000Z", now), 1);
assert.equal(daysSince("2026-09-15T07:00:00.000Z", now), -1, "created after `now` (a card added after the page loaded)");
assert.equal(daysSince("not a date", now), 0);
// At 06:30 UTC it is still the 14th in Los Angeles, so the 15th is tomorrow there.
assert.equal(daysUntil("2026-09-15", "UTC", now), 0);
assert.equal(daysUntil("2026-09-15", "America/Los_Angeles", now), 1);
assert.equal(daysUntil("2026-09-14", "Pacific/Auckland", now), -1);

console.log("Timezone checks passed.");
