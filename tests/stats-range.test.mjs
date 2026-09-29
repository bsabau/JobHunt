import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStatsRange, rangeLabel, rangeStart } from "../src/lib/stats-range.ts";

test("only 30 and 90 are ranges; everything else is all time", () => {
  assert.equal(parseStatsRange("30"), 30);
  assert.equal(parseStatsRange("90"), 90);
  for (const value of ["7", "-1", "all ", "30 ", " 90", "030", "30.0", "", undefined, ["30"], ["30", "90"]]) {
    assert.equal(parseStatsRange(value), null, JSON.stringify(value));
  }
});

test("a range starts that many days before now; all time has no start", () => {
  const now = Date.parse("2026-09-30T12:00:00.000Z");
  assert.equal(rangeStart(30, now), "2026-08-31T12:00:00.000Z");
  assert.equal(rangeStart(null, now), null);
  assert.deepEqual([rangeLabel(30), rangeLabel(null)], ["Last 30 days", "All time"]);
});
