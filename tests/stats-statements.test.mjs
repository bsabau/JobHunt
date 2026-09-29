// The stats page's statements (src/lib/stats-statements.ts) on an in-process
// Postgres (PGlite) built by the real migrations. Never points at a real
// database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CREATED, setupBoard } from "./helpers/pglite-board.mjs";
import { milestoneStatsStatement, timeToHearBackStatement, weeklySentStatement } from "../src/lib/stats-statements.ts";

const { sql, idOf, createApp, move, edgeAt, run } = setupBoard();

async function stats() {
  return (await run(milestoneStatsStatement()))[0];
}

test("the stats statement: counts over sent applications, and the average days to an interview", async () => {
  const replied = await createApp("Applied");
  await move(replied, "Screening");
  const interviewed = await createApp("Applied");
  await move(interviewed, "Interview", "Offer");
  const ghosted = await createApp("Applied");
  await move(ghosted, "Ghosted");
  await createApp("Applied");
  await createApp("Wishlist");
  // Interviewed, but with no known interview time: counts in the rate, not in
  // the average's base.
  await createApp("Interview");
  const row = await stats();
  assert.deepEqual(
    [row.applied, row.responded, row.interviewed, row.offered, row.ghosted, row.interview_count],
    [5, 3, 2, 1, 1, 1]
  );
  const expected = (Date.parse(await edgeAt(interviewed, 0)) - Date.parse(CREATED)) / 86_400_000;
  assert.ok(Math.abs(Number(row.avg_days_to_interview) - expected) < 1e-6);
});

test("the stats statement on an empty board: zeros, and no average", async () => {
  const row = await stats();
  assert.deepEqual([row.applied, row.responded, row.ghosted, row.interview_count], [0, 0, 0, 0]);
  assert.equal(row.avg_days_to_interview, null);
});

async function weekly(zone) {
  return (await run(weeklySentStatement(zone))).map((row) => [row.week_start, row.sent]);
}

async function sentAt(instant) {
  await sql`INSERT INTO applications (company, role, stage_id, created_at) VALUES ('Acme', 'Engineer', ${await idOf("Applied")}, ${instant})`;
}

test("weekly: a Sunday-night application falls in the next week east of UTC", async () => {
  await sentAt("2026-09-27T23:30:00Z"); // Sunday in UTC, Monday 01:30 in Berlin
  assert.deepEqual(await weekly("UTC"), [["2026-09-21", 1]]);
  assert.deepEqual(await weekly("Europe/Berlin"), [["2026-09-28", 1]]);
});

test("weekly: the week boundary follows the zone's clock change", async () => {
  // Berlin leaves summer time on Sunday 2026-10-25; midnight is then 23:00 UTC.
  await sentAt("2026-10-25T22:30:00Z"); // Sunday 23:30 in Berlin
  await sentAt("2026-10-25T23:30:00Z"); // Monday 00:30 in Berlin
  assert.deepEqual(await weekly("Europe/Berlin"), [["2026-10-19", 1], ["2026-10-26", 1]]);
});

test("weekly: a card that waited in the wishlist counts in the week it was sent", async () => {
  const app = await createApp("Wishlist"); // created 2026-01-01
  await move(app, "Applied");
  await sql`UPDATE application_transitions SET transitioned_at = '2026-03-04T10:00:00Z' WHERE application_id = ${app}`;
  assert.deepEqual(await weekly("UTC"), [["2026-03-02", 1]]);
});

test("weekly: counts by the date sent, and a card not sent yet is in no week", async () => {
  await sentAt("2026-09-29T10:00:00Z");
  await sentAt("2026-09-30T10:00:00Z");
  await createApp("Wishlist");
  assert.deepEqual(await weekly("UTC"), [["2026-09-28", 2]]);
});

// A card created in Applied at CREATED whose first move, `days` later, goes to
// `lane` (Screening is a reply, Rejected a reply and a rejection).
async function repliedAfter(days, lane = "Screening") {
  const app = await createApp("Applied");
  await move(app, lane);
  const at = new Date(Date.parse(CREATED) + days * 86_400_000).toISOString();
  await sql`UPDATE application_transitions SET transitioned_at = ${at} WHERE application_id = ${app}`;
  return app;
}

async function hearBack() {
  return (await run(timeToHearBackStatement()))[0];
}

test("time to hear back: the median of an odd and of an even number of replies", async () => {
  await repliedAfter(2);
  await repliedAfter(4);
  await repliedAfter(9);
  assert.deepEqual([(await hearBack()).reply_median_days, (await hearBack()).reply_count], [4, 3]);
  await repliedAfter(10);
  assert.equal((await hearBack()).reply_median_days, 6.5);
});

test("time to hear back: an outlier does not move the median of the rest", async () => {
  for (const days of [3, 4, 5, 6]) await repliedAfter(days);
  await repliedAfter(120);
  assert.equal((await hearBack()).reply_median_days, 5);
});

test("time to hear back: rejections have their own median, and count as replies too", async () => {
  await repliedAfter(2);
  await repliedAfter(8, "Rejected");
  await repliedAfter(12, "Rejected");
  const row = await hearBack();
  assert.deepEqual([row.rejection_median_days, row.rejection_count], [10, 2]);
  assert.deepEqual([row.reply_median_days, row.reply_count], [8, 3]);
});

test("time to hear back: a reply at an unknown time is left out", async () => {
  await repliedAfter(4);
  await createApp("Interview"); // created there: replied, time unknown
  await createApp("Applied"); // no reply yet
  const row = await hearBack();
  assert.deepEqual([row.reply_median_days, row.reply_count], [4, 1]);
});

test("time to hear back: nothing yet gives no median, not zero", async () => {
  await createApp("Applied");
  const row = await hearBack();
  assert.deepEqual(row, { reply_median_days: null, reply_count: 0, rejection_median_days: null, rejection_count: 0 });
});
