import assert from "node:assert/strict";
import {
  daysBetweenDateOnly,
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

console.log("Timezone checks passed.");
