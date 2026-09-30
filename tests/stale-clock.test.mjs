// The stale clock: the application_stale_clock view, the stale rule in SQL
// (staleApplicationsStatement) and in TypeScript (isApplicationStale), held to
// the same cases at a fixed `now`, and the follow-up statement. PGlite built
// by the real migrations; never a real database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { iso, setupBoard } from "./helpers/pglite-board.mjs";
import { staleActionStatement } from "../src/lib/application-statements.ts";
import { STALE_THRESHOLD_DAYS, isApplicationStale } from "../src/lib/stale.ts";
import { staleApplicationsStatement } from "../src/lib/stats-statements.ts";

const { sql, createApp, move, run } = setupBoard();

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const daysAgo = (days) => new Date(NOW - days * 86_400_000).toISOString();

// Moves a card and dates its latest edge.
async function moveAt(app, lane, at) {
  await move(app, lane);
  await sql`
    UPDATE application_transitions SET transitioned_at = ${at}
    WHERE id = (SELECT id FROM application_transitions WHERE application_id = ${app} ORDER BY transitioned_at DESC, id DESC LIMIT 1)`;
}

async function clock(app) {
  const [row] = await sql`SELECT clock_started_at, followed_up_at, snoozed_until FROM application_stale_clock WHERE application_id = ${app}`;
  return iso(row.clock_started_at);
}

// The ids the SQL rule finds stale, and the ids the TypeScript twin finds
// stale from the same rows; they must agree.
async function staleBoth() {
  const sqlIds = (await run(staleApplicationsStatement(new Date(NOW).toISOString(), STALE_THRESHOLD_DAYS))).map((row) => row.id);
  const rows = await sql`
    SELECT a.id, s.kind, c.clock_started_at, c.snoozed_until
    FROM applications a JOIN stages s ON s.id = a.stage_id JOIN application_stale_clock c ON c.application_id = a.id
    ORDER BY a.id`;
  const tsIds = rows
    .filter((row) => isApplicationStale({ stageKind: row.kind, staleClockAt: iso(row.clock_started_at), snoozedUntil: iso(row.snoozed_until) }, NOW))
    .map((row) => row.id);
  assert.deepEqual([...sqlIds].sort(), tsIds, "SQL and isApplicationStale() disagree");
  return tsIds;
}

test("without a follow-up the clock is the lane entry", async () => {
  const fresh = await createApp("Applied", daysAgo(20));
  const moved = await createApp("Applied", daysAgo(40));
  await moveAt(moved, "Screening", daysAgo(5));
  assert.deepEqual([await clock(fresh), await clock(moved)], [daysAgo(20), daysAgo(5)]);
  assert.deepEqual(await staleBoth(), [fresh]);
});

test("a follow-up after the lane entry restarts the clock", async () => {
  const app = await createApp("Applied", daysAgo(30));
  await sql`UPDATE applications SET followed_up_at = ${daysAgo(3)} WHERE id = ${app}`;
  assert.equal(await clock(app), daysAgo(3));
  assert.deepEqual(await staleBoth(), []);
});

test("a follow-up made before the card entered its lane is ignored", async () => {
  const app = await createApp("Applied", daysAgo(60));
  await sql`UPDATE applications SET followed_up_at = ${daysAgo(40)} WHERE id = ${app}`;
  await moveAt(app, "Screening", daysAgo(20));
  assert.equal(await clock(app), daysAgo(20));
  assert.deepEqual(await staleBoth(), [app]);
});

test("a rewind keeps a later follow-up", async () => {
  const app = await createApp("Applied", daysAgo(60));
  await moveAt(app, "Screening", daysAgo(50));
  await moveAt(app, "Interview", daysAgo(40));
  await sql`UPDATE applications SET followed_up_at = ${daysAgo(2)} WHERE id = ${app}`;
  await move(app, "Screening"); // rewind onto a visited lane: its edge keeps day 50
  assert.equal(await clock(app), daysAgo(2));
  assert.deepEqual(await staleBoth(), []);
});

test("a snooze hides a stale card until it runs out", async () => {
  const snoozed = await createApp("Applied", daysAgo(30));
  const expired = await createApp("Applied", daysAgo(30));
  await sql`UPDATE applications SET snoozed_until = ${daysAgo(-2)} WHERE id = ${snoozed}`;
  await sql`UPDATE applications SET snoozed_until = ${daysAgo(1)} WHERE id = ${expired}`;
  assert.deepEqual(await staleBoth(), [expired]);
});

test("intake, offer and outcome lanes never go stale; the threshold is inclusive", async () => {
  for (const lane of ["Wishlist", "Offer", "Rejected", "Ghosted"]) await createApp(lane, daysAgo(100));
  const exactly = await createApp("Applied", daysAgo(STALE_THRESHOLD_DAYS));
  const almost = await createApp("Applied", new Date(NOW - STALE_THRESHOLD_DAYS * 86_400_000 + 60_000).toISOString());
  assert.ok(almost);
  assert.deepEqual(await staleBoth(), [exactly]);
});

test("the stale list reports the days since the clock started, and the follow-up", async () => {
  const app = await createApp("Applied", daysAgo(40));
  await sql`UPDATE applications SET followed_up_at = ${daysAgo(16)} WHERE id = ${app}`;
  const [row] = await run(staleApplicationsStatement(new Date(NOW).toISOString(), STALE_THRESHOLD_DAYS));
  assert.deepEqual([row.id, row.days_stale, iso(row.followed_up_at)], [app, 16, daysAgo(16)]);
});

test("the follow-up statement: follow up, snooze, the two undos, and updated_at untouched", async () => {
  const app = await createApp("Applied", daysAgo(30));
  const [{ updated_at: before }] = await sql`SELECT updated_at FROM applications WHERE id = ${app}`;
  const state = async () => {
    const [row] = await sql`SELECT followed_up_at, snoozed_until, updated_at FROM applications WHERE id = ${app}`;
    return [iso(row.followed_up_at), iso(row.snoozed_until), iso(row.updated_at)];
  };
  const now = new Date(NOW).toISOString();

  assert.equal((await run(staleActionStatement(app, "snooze", now))).length, 1);
  assert.deepEqual(await state(), [null, daysAgo(-7), iso(before)]);

  await run(staleActionStatement(app, "followed_up", now));
  assert.deepEqual(await state(), [now, null, iso(before)], "a follow-up ends the snooze");

  await run(staleActionStatement(app, "unfollow", now));
  assert.deepEqual(await state(), [null, null, iso(before)], "undoing a follow-up removes only it");

  assert.deepEqual(await run(staleActionStatement(999, "snooze", now)), [], "an unknown application changes nothing");
});

test("undoing a snooze keeps an earlier follow-up", async () => {
  const app = await createApp("Applied", daysAgo(40));
  await sql`UPDATE applications SET followed_up_at = ${daysAgo(16)} WHERE id = ${app}`;
  const now = new Date(NOW).toISOString();
  await run(staleActionStatement(app, "snooze", now));
  assert.deepEqual(await staleBoth(), []);
  await run(staleActionStatement(app, "unsnooze", now));
  const [row] = await sql`SELECT followed_up_at, snoozed_until FROM applications WHERE id = ${app}`;
  assert.deepEqual([iso(row.followed_up_at), row.snoozed_until], [daysAgo(16), null]);
  assert.deepEqual(await staleBoth(), [app], "stale again, counted from the kept follow-up");
});
