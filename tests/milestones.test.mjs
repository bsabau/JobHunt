// The application_milestones view on an in-process Postgres (PGlite) built by
// the real migrations, with cards moved by the production move statement.
// Never points at a real database. The statements over it are tested in
// tests/stats-statements.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CREATED, iso, setupBoard } from "./helpers/pglite-board.mjs";
import { stageUpdateStatement } from "../src/lib/stage-statements.ts";
import { milestoneStatsStatement } from "../src/lib/stats-statements.ts";

const { sql, idOf, createApp, move, edgeAt, run } = setupBoard();

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

async function stats() {
  return (await run(milestoneStatsStatement(null)))[0];
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
  await run(change);
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
  await run(change);
  assert.equal((await milestones(app)).interviewed, true);
});
