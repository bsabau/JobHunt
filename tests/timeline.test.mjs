// The timeline statement on an in-process Postgres (PGlite) built by the real
// migrations, with cards moved by the production move statement. Never points
// at a real database.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../scripts/migration-utils.mjs";
import { applicationTimelineStatement } from "../src/lib/application-statements.ts";
import { mapTimeline } from "../src/lib/db/rows.ts";
import { TERMINAL_KINDS } from "../src/lib/stage-kinds.ts";
import { sqlFragment, stageMoveStatement, stageUpdateStatement } from "../src/lib/stage-statements.ts";

const BOARD = [
  { name: "Wishlist", kind: "intake" },
  { name: "Applied", kind: "active" },
  { name: "Screening", kind: "active" },
  { name: "Interview", kind: "interview" },
  { name: "Rejected", kind: "rejected" }
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

async function createApp(stageName, createdAt = "2026-01-01T00:00:00.000Z") {
  // A fixed creation time, earlier than any move, so a mix-up with updated_at
  // or a move's time shows.
  const [row] = await sql`
    INSERT INTO applications (company, role, stage_id, created_at)
    VALUES ('Acme', 'Engineer', ${await idOf(stageName)}, ${createdAt}) RETURNING id`;
  return row.id;
}

async function move(appId, toName) {
  const [{ stage_id: fromId }] = await sql`SELECT stage_id FROM applications WHERE id = ${appId}`;
  const toId = await idOf(toName);
  const statement = stageMoveStatement(sqlFragment`stage_id = ${toId}, updated_at = NOW()`, appId, fromId, toId, TERMINAL_KINDS);
  const [row] = (await pg.query(statement.text, statement.params)).rows;
  assert.equal(row.updated, 1, `move to ${toName}`);
}

async function timeline(appId) {
  const statement = applicationTimelineStatement(appId);
  const rows = (await pg.query(statement.text, statement.params)).rows;
  return rows.length === 0 ? null : mapTimeline(rows[0]);
}

const names = (payload) => payload.lanes.map((lane) => lane.stageName);

test("a card that never moved has only its entry lane, entered at its creation", async () => {
  const app = await createApp("Applied");
  const [{ created_at: created }] = await sql`SELECT created_at FROM applications WHERE id = ${app}`;
  const payload = await timeline(app);
  assert.deepEqual(payload.lanes, [
    { stageId: await idOf("Applied"), stageName: "Applied", stageKind: "active", enteredAt: new Date(created).toISOString() }
  ]);
});

test("forward moves add one lane each, in path order, with the move's time and the lane's kind", async () => {
  const app = await createApp("Applied");
  await move(app, "Screening");
  await move(app, "Interview");
  const payload = await timeline(app);
  assert.deepEqual(names(payload), ["Applied", "Screening", "Interview"]);
  assert.equal(payload.lanes[0].enteredAt, "2026-01-01T00:00:00.000Z", "the entry lane is entered at creation");
  assert.equal(payload.lanes[2].stageKind, "interview");
  const moves = await sql`SELECT transitioned_at FROM application_transitions WHERE application_id = ${app} ORDER BY transitioned_at, id`;
  assert.deepEqual(payload.lanes.slice(1).map((lane) => lane.enteredAt), moves.map((row) => new Date(row.transitioned_at).toISOString()));
});

test("a rewind onto a visited lane ends the path there, with its original time", async () => {
  const app = await createApp("Applied");
  await move(app, "Screening");
  const entered = (await timeline(app)).lanes[1].enteredAt;
  await move(app, "Interview");
  await move(app, "Screening");
  const payload = await timeline(app);
  assert.deepEqual(names(payload), ["Applied", "Screening"]);
  assert.equal(payload.lanes[1].enteredAt, entered);
});

test("a rewind below the entry lane leaves only the current lane", async () => {
  const app = await createApp("Applied");
  await move(app, "Interview");
  await move(app, "Wishlist");
  assert.deepEqual(names(await timeline(app)), ["Wishlist"]);
});

test("a renamed lane shows its new name; a deleted lane its old name, marked, without id or kind", async () => {
  const app = await createApp("Applied");
  await move(app, "Screening");
  await move(app, "Interview");
  const rename = stageUpdateStatement(await idOf("Interview"), { name: "Interviews" });
  await pg.query(rename.text, rename.params);
  await move(app, "Rejected");
  await sql`DELETE FROM stages WHERE name = 'Screening'`;
  const payload = await timeline(app);
  assert.deepEqual(names(payload), ["Applied", "Screening (deleted)", "Interviews", "Rejected"]);
  assert.deepEqual([payload.lanes[1].stageId, payload.lanes[1].stageKind], [null, null]);
});

test("each application gets only its own moves", async () => {
  const first = await createApp("Applied");
  const second = await createApp("Applied");
  await move(first, "Screening");
  await move(second, "Interview");
  await move(second, "Rejected");
  assert.deepEqual(names(await timeline(first)), ["Applied", "Screening"]);
  assert.deepEqual(names(await timeline(second)), ["Applied", "Interview", "Rejected"]);
});

test("lanes are joined by id: a new lane that took a deleted lane's name does not claim its history", async () => {
  const app = await createApp("Wishlist");
  await move(app, "Applied");
  await move(app, "Screening");
  await sql`DELETE FROM stages WHERE name IN ('Wishlist', 'Applied')`;
  await sql`INSERT INTO stages (name, sort_order, kind) VALUES ('Wishlist', 10, 'intake'), ('Applied', 11, 'active')`;
  const payload = await timeline(app);
  assert.deepEqual(names(payload), ["Wishlist (deleted)", "Applied (deleted)", "Screening"]);
  assert.deepEqual(payload.lanes.slice(0, 2).map((lane) => [lane.stageId, lane.stageKind]), [[null, null], [null, null]]);
});

test("a deleted entry lane keeps its name, marked", async () => {
  const app = await createApp("Wishlist");
  await move(app, "Applied");
  await sql`DELETE FROM stages WHERE name = 'Wishlist'`;
  const payload = await timeline(app);
  assert.deepEqual(names(payload), ["Wishlist (deleted)", "Applied"]);
  assert.equal(payload.lanes[0].stageId, null);
});

test("an unknown application has no timeline", async () => {
  assert.equal(await timeline(999), null);
});
