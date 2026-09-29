// The stats page's statements (src/lib/stats-statements.ts) on an in-process
// Postgres (PGlite) built by the real migrations. Never points at a real
// database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CREATED, setupBoard } from "./helpers/pglite-board.mjs";
import {
  milestoneStatsStatement,
  outcomesStatement,
  sourceApplicationsStatement,
  timeToHearBackStatement,
  topCompaniesStatement,
  visitsStatement,
  weeklyStatement
} from "../src/lib/stats-statements.ts";
import { rangeStart } from "../src/lib/stats-range.ts";

const { sql, idOf, createApp, move, edgeAt, run } = setupBoard();

async function stats() {
  return (await run(milestoneStatsStatement(null)))[0];
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
  return (await run(weeklyStatement(zone, null))).map((row) => [row.week_start, row.sent]);
}

async function weeklyResults(zone) {
  return (await run(weeklyStatement(zone, null))).map((row) => [row.week_start, row.sent, row.responded, row.interviewed, row.offered]);
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
  return (await run(timeToHearBackStatement(null)))[0];
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

// Sets the time of an application's n-th edge (0-based), `days` after CREATED.
async function edgeTime(app, index, days) {
  const [edge] = await sql`SELECT id FROM application_transitions WHERE application_id = ${app} ORDER BY transitioned_at, id OFFSET ${index} LIMIT 1`;
  const at = new Date(Date.parse(CREATED) + days * 86_400_000).toISOString();
  await sql`UPDATE application_transitions SET transitioned_at = ${at} WHERE id = ${edge.id}`;
}

test("time to hear back: days count from the sending, not from the card's creation", async () => {
  const app = await createApp("Wishlist");
  await move(app, "Applied", "Screening");
  await edgeTime(app, 0, 30); // sent 30 days after it was added
  await edgeTime(app, 1, 34); // reply 4 days later
  assert.equal((await hearBack()).reply_median_days, 4);
});

test("time to hear back: the rejection figure is a median of rejections", async () => {
  await repliedAfter(8, "Rejected");
  await repliedAfter(12, "Rejected");
  await repliedAfter(100, "Rejected");
  assert.equal((await hearBack()).rejection_median_days, 12);
});

test("time to hear back: a reply before the rejection gives two different figures", async () => {
  const app = await createApp("Applied");
  await move(app, "Screening", "Rejected");
  await edgeTime(app, 0, 3);
  await edgeTime(app, 1, 20);
  const row = await hearBack();
  assert.deepEqual([row.reply_median_days, row.rejection_median_days], [3, 20]);
});

test("time to hear back: a card never sent brings no rejection", async () => {
  const app = await createApp("Wishlist");
  await move(app, "Rejected");
  assert.equal((await hearBack()).rejection_count, 0);
});

test("time to hear back: a rejection dated before the sending is left out", async () => {
  const app = await createApp("Wishlist");
  await move(app, "Applied", "Screening");
  await edgeTime(app, 0, 5);
  await edgeTime(app, 1, 9);
  // Applied becomes a rejected lane: the sending is now the edge into
  // Screening, and the "rejection" the earlier edge into Applied.
  await sql`UPDATE stages SET kind = 'rejected' WHERE name = 'Applied'`;
  assert.equal((await hearBack()).rejection_count, 0);
});

test("weekly results: each week's applications with their replies, interviews and offers", async () => {
  const at = (day) => `2026-09-${day}T10:00:00Z`;
  const inWeek = async (day, ...lanes) => {
    const app = await createApp("Applied", at(day));
    if (lanes.length) await move(app, ...lanes);
  };
  await inWeek("01"); // week of Aug 31: no reply
  await inWeek("02", "Screening"); // replied
  await inWeek("08", "Interview", "Offer"); // week of Sep 7: interview and offer
  await inWeek("09", "Rejected");
  await inWeek("10", "Interview"); // an interview without an offer
  await inWeek("15", "Ghosted"); // week of Sep 14: closed, not a reply
  const wishlist = await createApp("Wishlist", at("15")); // not sent: in no week
  assert.ok(wishlist);
  assert.deepEqual(await weeklyResults("UTC"), [
    ["2026-08-31", 2, 1, 0, 0],
    ["2026-09-07", 3, 3, 2, 1],
    ["2026-09-14", 1, 0, 0, 0]
  ]);
});

test("source applications: each sent application's link and flags; unsent cards left out", async () => {
  const withLink = await createApp("Applied");
  await sql`UPDATE applications SET source_url = 'https://jobs.example.com/1' WHERE id = ${withLink}`;
  await move(withLink, "Interview");
  const repliedOnly = await createApp("Applied");
  await sql`UPDATE applications SET source_url = 'https://jobs.example.com/3' WHERE id = ${repliedOnly}`;
  await move(repliedOnly, "Screening"); // a reply, no interview
  await createApp("Applied"); // no link
  const unsent = await createApp("Wishlist");
  await sql`UPDATE applications SET source_url = 'https://jobs.example.com/2' WHERE id = ${unsent}`;
  const rows = (await run(sourceApplicationsStatement(null))).sort((a, b) => String(a.source_url).localeCompare(String(b.source_url)));
  assert.deepEqual(rows, [
    { source_url: "https://jobs.example.com/1", responded: true, interviewed: true, offered: false },
    { source_url: "https://jobs.example.com/3", responded: true, interviewed: false, offered: false },
    { source_url: null, responded: false, interviewed: false, offered: false }
  ]);
});

// Cards sent 10, 60 and 200 days before a fixed `now`, each rejected a day
// after it was sent, plus a card not sent yet (in the wishlist).
const NOW = Date.parse("2026-09-30T12:00:00.000Z");
async function cardsAcrossTime() {
  for (const daysAgo of [10, 60, 200]) {
    const sent = new Date(NOW - daysAgo * 86_400_000).toISOString();
    const app = await createApp("Applied", sent);
    await move(app, "Rejected");
    const replied = new Date(NOW - (daysAgo - 1) * 86_400_000).toISOString();
    await sql`UPDATE application_transitions SET transitioned_at = ${replied} WHERE application_id = ${app}`;
  }
  await createApp("Wishlist", new Date(NOW - 5 * 86_400_000).toISOString());
}

const RANGES = [["all time", null], ["90 days", 90], ["30 days", 30]];

test("ranged: sent applications, their medians and their sources follow the range", async () => {
  await cardsAcrossTime();
  const counts = {};
  for (const [label, range] of RANGES) {
    const start = rangeStart(range, NOW);
    const [milestone] = await run(milestoneStatsStatement(start));
    const [hearBack] = await run(timeToHearBackStatement(start));
    const sources = await run(sourceApplicationsStatement(start));
    const weeks = await run(weeklyStatement("UTC", start));
    counts[label] = [milestone.applied, milestone.responded, hearBack.rejection_count, sources.length, weeks.reduce((sum, week) => sum + week.sent, 0)];
  }
  assert.deepEqual(counts, { "all time": [3, 3, 3, 3, 3], "90 days": [2, 2, 2, 2, 2], "30 days": [1, 1, 1, 1, 1] });
});

test("ranged: the funnel, the companies and the outcomes count the unsent card only under all time", async () => {
  await cardsAcrossTime();
  const counts = {};
  for (const [label, range] of RANGES) {
    const start = rangeStart(range, NOW);
    const visitedApplications = new Set((await run(visitsStatement(start))).map((row) => row.application_id));
    const companies = (await run(topCompaniesStatement(start))).reduce((sum, row) => sum + row.count, 0);
    const outcomes = (await run(outcomesStatement(start))).reduce((sum, row) => sum + row.count, 0);
    counts[label] = [visitedApplications.size, companies, outcomes];
  }
  assert.deepEqual(counts, { "all time": [4, 4, 3], "90 days": [2, 2, 2], "30 days": [1, 1, 1] });
});
