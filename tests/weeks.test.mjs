import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, fillWeeks, isWeekOpen, weekStartOf } from "../src/lib/weeks.ts";

test("weeks start on Monday", () => {
  assert.equal(weekStartOf("2026-09-28"), "2026-09-28", "a Monday is its own week start");
  assert.equal(weekStartOf("2026-10-04"), "2026-09-28", "a Sunday belongs to the week before");
  assert.equal(weekStartOf("2027-01-01"), "2026-12-28", "across a year end");
});

test("days add across month and year ends", () => {
  assert.equal(addDays("2026-09-28", 7), "2026-10-05");
  assert.equal(addDays("2026-12-28", 7), "2027-01-04");
  assert.equal(addDays("2026-03-02", -7), "2026-02-23");
});

test("gaps are filled with empty weeks and the running total carries on", () => {
  const weeks = fillWeeks([{ weekStart: "2026-12-21", sent: 2 }, { weekStart: "2027-01-04", sent: 3 }], "2027-01-04");
  assert.deepEqual(weeks, [
    { weekStart: "2026-12-21", sent: 2, cumulative: 2 },
    { weekStart: "2026-12-28", sent: 0, cumulative: 2 },
    { weekStart: "2027-01-04", sent: 3, cumulative: 5 }
  ]);
});

test("weeks run on to the current week, so a quiet stretch shows", () => {
  const weeks = fillWeeks([{ weekStart: "2026-09-14", sent: 1 }], "2026-09-28");
  assert.deepEqual(weeks.map((week) => [week.weekStart, week.sent, week.cumulative]), [
    ["2026-09-14", 1, 1],
    ["2026-09-21", 0, 1],
    ["2026-09-28", 0, 1]
  ]);
});

test("a row newer than the current week still ends the chart (clocks a moment apart at midnight)", () => {
  const weeks = fillWeeks([{ weekStart: "2026-10-05", sent: 1 }], "2026-09-28");
  assert.deepEqual(weeks.map((week) => week.weekStart), ["2026-10-05"]);
});

test("under a date range the weeks start at the range's first week", () => {
  const weeks = fillWeeks([{ weekStart: "2026-09-21", sent: 2 }], "2026-09-28", "2026-09-07");
  assert.deepEqual(weeks.map((week) => [week.weekStart, week.sent]), [
    ["2026-09-07", 0],
    ["2026-09-14", 0],
    ["2026-09-21", 2],
    ["2026-09-28", 0]
  ]);
});

test("one week, and no weeks", () => {
  assert.deepEqual(fillWeeks([{ weekStart: "2026-09-28", sent: 4 }], "2026-09-28"), [{ weekStart: "2026-09-28", sent: 4, cumulative: 4 }]);
  assert.deepEqual(fillWeeks([], "2026-09-28"), []);
});

test("a week stays open until `days` have passed since its Sunday", () => {
  // The week of Mon 2026-09-14 ends on Sun 2026-09-20.
  assert.equal(isWeekOpen("2026-09-14", 14, "2026-10-03"), true, "13 days after the Sunday");
  assert.equal(isWeekOpen("2026-09-14", 14, "2026-10-04"), false, "14 days after the Sunday");
  assert.equal(isWeekOpen("2026-09-28", 14, "2026-09-30"), true, "the current week");
  assert.equal(isWeekOpen("2026-09-14", 60, "2026-10-04"), true, "a longer median keeps it open");
});
