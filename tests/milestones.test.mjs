// The application_milestones view and the stats statements (rates, weekly
// applications), on an in-process Postgres (PGlite) built by the real
// migrations, with cards moved by the production move statement. Never points
// at a real database.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../scripts/migration-utils.mjs";
import { TERMINAL_KINDS } from "../src/lib/stage-kinds.ts";
import { sqlFragment, stageMoveStatement, stageUpdateStatement } from "../src/lib/stage-statements.ts";
import { milestoneStatsStatement, weeklySentStatement } from "../src/lib/stats-statements.ts";

const BOARD = [
  { name: "Wishlist", kind: "intake" },
  { name: "Applied", kind: "active" },
  { name: "Screening", kind: "active" },
  { name: "Interview", kind: "interview" },
  { name: "Offer", kind: "offer" },
  { name: "Rejected", kind: "rejected" },
  { name: "Ghosted", kind: "closed" }
].map((stage, sortOrder) => ({ ...stage, sortOrder }));

let pg;

async function sql(strings, ...values) {
  return (await pg.query(strings.reduce((query, part, index) => `${query}$${index}${part}`), values)).rows;
}

before(async () => {
  pg = new PGlite();
  await runMigrations(sql, () => {});
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE application_transitions, applications, stages RESTART IDENTITY CASCADE`;
  for (const stage of BOARD) {
    await sql`INSERT INTO stages (name, sort_order, kind) VALUES (${stage.name}, ${stage.sortOrder}, ${stage.kind})`;
  }
});

const idOf = async (name) => (await sql`SELECT id FROM stages WHERE name = ${name}`)[0]?.id;
const CREATED = "2026-01-01T00:00:00.000Z";

async function createApp(stageName) {
  const [row] = await sql`
    INSERT INTO applications (company, role, stage_id, created_at)
    VALUES ('Acme', 'Engineer', ${await idOf(stageName)}, ${CREATED}) RETURNING id`;
  return row.id;
}

async function move(appId, ...names) {
  for (const toName of names) {
    const [{ stage_id: fromId }] = await sql`SELECT stage_id FROM applications WHERE id = ${appId}`;
    const toId = await idOf(toName);
    const statement = stageMoveStatement(sqlFragment`stage_id = ${toId}, updated_at = NOW()`, appId, fromId, toId, TERMINAL_KINDS);
    const [row] = (await pg.query(statement.text, statement.params)).rows;
    assert.equal(row.updated, 1, `move to ${toName}`);
  }
}

const iso = (value) => (value === null ? null : new Date(value).toISOString());

async function milestones(appId) {
  const [row] = await sql`SELECT * FROM application_milestones WHERE application_id = ${appId}`;
  return {
    appliedAt: iso(row.applied_at),
    responded: row.responded,
    respondedAt: iso(row.responded_at),
    interviewed: row.interviewed,
    firstInterviewAt: iso(row.first_interview_at),
    offered: row.offered,
    offeredAt: iso(row.offered_at),
    rejectedAt: iso(row.rejected_at)
  };
}

// The time of the application's n-th edge on its current path (0-based).
async function edgeAt(appId, index) {
  const rows = await sql`SELECT transitioned_at FROM application_transitions WHERE application_id = ${appId} ORDER BY transitioned_at, id`;
  return iso(rows[index].transitioned_at);
}

async function stats() {
  const statement = milestoneStatsStatement();
  return (await pg.query(statement.text, statement.params)).rows[0];
}

test("created in a pipeline lane and never moved: sent at creation, no reply", async () => {
  const app = await createApp("Applied");
  const m = await milestones(app);
  assert.equal(m.appliedAt, CREATED);
  assert.equal(m.responded, false);
  assert.equal(m.respondedAt, null);
});

test("a move to another pipeline lane is the reply", async () => {
  const app = await createApp("Applied");
  await move(app, "Screening");
  const m = await milestones(app);
  assert.equal(m.responded, true);
  assert.equal(m.respondedAt, await edgeAt(app, 0));
  assert.equal(m.interviewed, false);
});

test("a rejection is a reply", async () => {
  const app = await createApp("Applied");
  await move(app, "Rejected");
  const m = await milestones(app);
  assert.equal(m.responded, true);
  assert.equal(m.rejectedAt, await edgeAt(app, 0));
});

test("closing is not a reply, and counts as ghosted", async () => {
  const app = await createApp("Applied");
  await move(app, "Ghosted");
  assert.equal((await milestones(app)).responded, false);
  const row = await stats();
  assert.deepEqual([row.applied, row.responded, row.ghosted], [1, 0, 1]);
});

test("a wishlist card not sent yet is in no denominator", async () => {
  const app = await createApp("Wishlist");
  assert.equal((await milestones(app)).appliedAt, null);
  assert.equal((await stats()).applied, 0);
});

test("from the wishlist, the reply is the edge after the one that sent it", async () => {
  const app = await createApp("Wishlist");
  await move(app, "Applied", "Interview");
  const m = await milestones(app);
  assert.equal(m.appliedAt, await edgeAt(app, 0));
  assert.equal(m.respondedAt, await edgeAt(app, 1));
  assert.equal(m.firstInterviewAt, await edgeAt(app, 1));
  assert.deepEqual([m.offered, m.offeredAt], [false, null], "an interview is not an offer");
});

test("from the wishlist straight to a rejection: never sent, never counted", async () => {
  const app = await createApp("Wishlist");
  await move(app, "Rejected");
  assert.equal((await milestones(app)).appliedAt, null);
  assert.equal((await stats()).applied, 0);
});

test("from the wishlist straight to an interview: the interview implies a reply", async () => {
  const app = await createApp("Wishlist");
  await move(app, "Interview");
  const m = await milestones(app);
  assert.equal(m.appliedAt, await edgeAt(app, 0));
  assert.deepEqual([m.responded, m.respondedAt, m.interviewed], [true, null, true]);
});

test("created directly in an interview lane: interviewed and responded, times unknown", async () => {
  const app = await createApp("Interview");
  const m = await milestones(app);
  assert.deepEqual([m.responded, m.respondedAt, m.interviewed, m.firstInterviewAt], [true, null, true, null]);
});

test("created directly in an offer lane: offered and responded", async () => {
  const app = await createApp("Offer");
  const m = await milestones(app);
  assert.deepEqual([m.responded, m.offered, m.offeredAt], [true, true, null]);
});

test("created directly in a rejected lane: responded", async () => {
  const app = await createApp("Rejected");
  assert.equal((await milestones(app)).responded, true);
});

test("from the wishlist straight to an offer: the offer implies a reply", async () => {
  const app = await createApp("Wishlist");
  await move(app, "Offer");
  const m = await milestones(app);
  assert.deepEqual([m.responded, m.respondedAt, m.offered], [true, null, true]);
  assert.equal(m.offeredAt, await edgeAt(app, 0));
});

test("the first interview is the earliest edge into any interview lane", async () => {
  const change = stageUpdateStatement(await idOf("Screening"), { kind: "interview" });
  await pg.query(change.text, change.params);
  const app = await createApp("Applied");
  await move(app, "Screening", "Interview");
  assert.equal((await milestones(app)).firstInterviewAt, await edgeAt(app, 0));
});

test("a move into an intake lane is not a reply", async () => {
  // An intake lane placed after the pipeline, so moving into it is forward.
  await sql`INSERT INTO stages (name, sort_order, kind) VALUES ('Later', 7, 'intake')`;
  const app = await createApp("Applied");
  await move(app, "Later");
  assert.equal((await milestones(app)).responded, false);
});

test("an edge sharing the sent edge's time is compared by id, so it is still the reply", async () => {
  const app = await createApp("Wishlist");
  await move(app, "Applied", "Screening");
  await sql`UPDATE application_transitions SET transitioned_at = '2026-02-01T00:00:00Z' WHERE application_id = ${app}`;
  const m = await milestones(app);
  assert.deepEqual([m.appliedAt, m.responded, m.respondedAt], ["2026-02-01T00:00:00.000Z", true, "2026-02-01T00:00:00.000Z"]);
});

test("a deleted entry lane leaves the flags false, never NULL", async () => {
  await sql`INSERT INTO stages (name, sort_order, kind) VALUES ('Temporary', 7, 'active')`;
  const app = await createApp("Temporary");
  await move(app, "Ghosted");
  await sql`DELETE FROM stages WHERE name = 'Temporary'`;
  const [row] = await sql`SELECT responded, interviewed, offered FROM application_milestones WHERE application_id = ${app}`;
  assert.deepEqual(row, { responded: false, interviewed: false, offered: false });
});

test("a rewind out of the interview lane clears 'interviewed'", async () => {
  const app = await createApp("Applied");
  await move(app, "Interview");
  assert.equal((await milestones(app)).interviewed, true);
  await move(app, "Screening");
  const m = await milestones(app);
  assert.equal(m.interviewed, false);
  assert.equal(m.responded, true, "the reconnect edge into Screening is still a reply");
});

test("the reply's lane deleted afterwards: still a reply", async () => {
  const app = await createApp("Applied");
  await move(app, "Screening", "Interview");
  await sql`DELETE FROM stages WHERE name = 'Screening'`;
  const m = await milestones(app);
  assert.equal(m.respondedAt, await edgeAt(app, 0));
});

test("a lane whose kind becomes 'interview' makes its cards interviewed", async () => {
  const app = await createApp("Applied");
  await move(app, "Screening");
  const change = stageUpdateStatement(await idOf("Screening"), { kind: "interview" });
  await pg.query(change.text, change.params);
  assert.equal((await milestones(app)).interviewed, true);
});

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
  const statement = weeklySentStatement(zone);
  return (await pg.query(statement.text, statement.params)).rows.map((row) => [row.week_start, row.sent]);
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

test("weekly: counts by the date sent, and a card not sent yet is in no week", async () => {
  await sentAt("2026-09-29T10:00:00Z");
  await sentAt("2026-09-30T10:00:00Z");
  await createApp("Wishlist");
  assert.deepEqual(await weekly("UTC"), [["2026-09-28", 2]]);
});
