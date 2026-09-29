// Runs the production stage statements (move, rename) against an in-process
// Postgres (PGlite) built by the real migrations, and holds the move statement
// to the same scenarios as its TypeScript twin, rewindTransitionPath(). Never
// points at a real database.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../scripts/migration-utils.mjs";
import { compileSql, sqlFragment, stageMoveStatement, stageUpdateStatement } from "../src/lib/stage-statements.ts";
import { TERMINAL_KINDS, compareStageRank, withPipelineRank } from "../src/lib/stage-kinds.ts";
import { rewindTransitionPath } from "../src/lib/transitions.ts";

// Board order puts an outcome lane before Screening, as on the live board.
const BOARD = [
  { name: "Wishlist", kind: "intake" },
  { name: "Applied", kind: "active" },
  { name: "Rejected at screening", kind: "rejected" },
  { name: "Screening", kind: "active" },
  { name: "Interview", kind: "interview" },
  { name: "Ghosting", kind: "closed" },
  { name: "Offer", kind: "offer" },
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

// Looked up each time: a test may delete a lane and re-create its name.
async function idOf(stageName) {
  const [row] = await sql`SELECT id FROM stages WHERE name = ${stageName}`;
  return row?.id;
}

async function createApp(stageName) {
  const [row] = await sql`INSERT INTO applications (company, role, stage_id) VALUES ('Acme', 'Engineer', ${await idOf(stageName)}) RETURNING id`;
  return row.id;
}

async function currentStage(appId) {
  const [row] = await sql`SELECT s.name FROM applications a JOIN stages s ON s.id = a.stage_id WHERE a.id = ${appId}`;
  return row?.name;
}

async function history(appId) {
  const rows = await sql`
    SELECT id, from_status, from_stage_id, to_status, to_stage_id, transitioned_at
    FROM application_transitions
    WHERE application_id = ${appId}
    ORDER BY transitioned_at ASC, id ASC`;
  return rows.map((row) => ({
    id: row.id,
    fromStatus: row.from_status,
    fromStageId: row.from_stage_id,
    toStatus: row.to_status,
    toStageId: row.to_stage_id,
    transitionedAt: new Date(row.transitioned_at).toISOString()
  }));
}

// The pipeline rank of the lanes as they are now, so the twin sees reorders.
async function rankedStages() {
  const rows = await sql`SELECT id, name, sort_order, kind FROM stages`;
  return withPipelineRank(rows.map((row) => ({ id: row.id, name: row.name, sortOrder: row.sort_order, kind: row.kind })));
}

// Names only, for readable expectations.
const shape = (transitions) => transitions.map((t) => `${t.fromStatus}->${t.toStatus}`);
// Names and lane ids ("-" for a deleted lane), for comparing SQL with the twin.
const idShape = (transitions) =>
  transitions.map((t) => `${t.fromStatus}#${t.fromStageId ?? "-"}->${t.toStatus}#${t.toStageId ?? "-"}`);

async function runMove(appId, toName, expectedName) {
  const toStageId = await idOf(toName);
  const expectedStageId = await idOf(expectedName);
  const statement = stageMoveStatement(
    sqlFragment`stage_id = ${toStageId}, updated_at = NOW()`,
    appId,
    expectedStageId,
    toStageId,
    TERMINAL_KINDS
  );
  const [row] = (await pg.query(statement.text, statement.params)).rows;
  return { found: row.found, updated: row.updated };
}

// Moves the card with the SQL statement and checks the resulting history
// against the TypeScript twin: forward moves append one edge, rewinds follow
// rewindTransitionPath().
async function move(appId, toName) {
  const fromName = await currentStage(appId);
  const beforeMove = await history(appId);
  const ranked = await rankedStages();
  const rankOf = (name) => ranked.find((stage) => stage.name === name);
  const target = rankOf(toName);

  const expected =
    compareStageRank(target, rankOf(fromName)) >= 0
      ? toName === fromName
        ? beforeMove
        : [...beforeMove, { fromStatus: fromName, fromStageId: rankOf(fromName).id, toStatus: toName, toStageId: target.id }]
      : rewindTransitionPath(beforeMove, target, fromName, ranked);

  const outcome = await runMove(appId, toName, fromName);
  assert.deepEqual(outcome, { found: 1, updated: 1 });
  assert.equal(await currentStage(appId), toName);

  const afterMove = await history(appId);
  assert.deepEqual(idShape(afterMove), idShape(expected), `SQL and rewindTransitionPath() disagree on ${fromName} -> ${toName}`);
  return { before: beforeMove, after: afterMove };
}

async function moveAll(appId, ...names) {
  for (const name of names) {
    await move(appId, name);
  }
}

describe("stage move statement", () => {
  test("a forward move appends one edge", async () => {
    const app = await createApp("Applied");
    const { after: path } = await move(app, "Screening");
    assert.deepEqual(shape(path), ["Applied->Screening"]);
  });

  test("a rewind onto a visited lane keeps the original edge and timestamp", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Screening", "Interview", "Offer");
    const original = (await history(app))[0];
    const { after: path } = await move(app, "Screening");
    assert.deepEqual(shape(path), ["Applied->Screening"]);
    assert.equal(path[0].id, original.id);
    assert.equal(path[0].transitionedAt, original.transitionedAt);
  });

  test("a rewind onto a skipped lane inserts a reconnect edge", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Offer");
    const skipped = (await history(app))[0];
    const { after: path } = await move(app, "Interview");
    assert.deepEqual(shape(path), ["Applied->Interview"]);
    assert.notEqual(path[0].id, skipped.id);
  });

  test("a rewind to the entry lane leaves no edges", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Screening", "Interview");
    const { after: path } = await move(app, "Applied");
    assert.deepEqual(shape(path), []);
  });

  test("a rewind below the entry lane clears the path", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Interview");
    const { after: path } = await move(app, "Wishlist");
    assert.deepEqual(shape(path), []);
  });

  test("a move into an outcome lane placed early on the board is forward", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Screening");
    const { after: path } = await move(app, "Rejected at screening");
    assert.deepEqual(shape(path), ["Applied->Screening", "Screening->Rejected at screening"]);
  });

  test("a move out of an outcome lane into the pipeline is a rewind", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Screening", "Rejected at screening");
    const { after: path } = await move(app, "Screening");
    assert.deepEqual(shape(path), ["Applied->Screening"]);
  });

  test("moves between outcome lanes follow their board order", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Ghosting");
    const { after: forward } = await move(app, "Rejected");
    assert.deepEqual(shape(forward), ["Applied->Ghosting", "Ghosting->Rejected"]);
    const { after: back } = await move(app, "Rejected at screening");
    assert.deepEqual(shape(back), ["Applied->Rejected at screening"]);
  });

  test("after a lane reorder, the first edge into the target is the boundary", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Screening", "Interview", "Offer");
    // Interview now sits before Screening, so the recorded path is no longer
    // in rank order.
    await sql`
      UPDATE stages SET sort_order = CASE name WHEN 'Screening' THEN 4 WHEN 'Interview' THEN 3 END
      WHERE name IN ('Screening', 'Interview')`;
    const { after: path } = await move(app, "Screening");
    assert.deepEqual(shape(path), ["Applied->Screening"]);
  });

  test("a stale expectedStageId changes nothing and reports a conflict", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Screening");
    const beforeMove = await history(app);
    assert.deepEqual(await runMove(app, "Interview", "Applied"), { found: 1, updated: 0 });
    assert.equal(await currentStage(app), "Screening");
    assert.deepEqual(await history(app), beforeMove);
  });

  test("a move to an unknown lane fails on the stage foreign key", async () => {
    // The data layer relies on this instead of checking the lane first.
    const app = await createApp("Applied");
    const statement = stageMoveStatement(sqlFragment`stage_id = ${9999}, updated_at = NOW()`, app, await idOf("Applied"), 9999, TERMINAL_KINDS);
    await assert.rejects(pg.query(statement.text, statement.params), (error) => error.code === "23503" && /stage_id/.test(error.message));
    assert.equal(await currentStage(app), "Applied");
    assert.deepEqual(await history(app), []);
  });

  test("an unknown lane with a stale expectedStageId reports a conflict, not a foreign-key error", async () => {
    // The guarded UPDATE matches no row, so the foreign key never fires: the
    // route answers 409 "moved elsewhere" rather than 400 "lane not found".
    const app = await createApp("Applied");
    const statement = stageMoveStatement(sqlFragment`stage_id = ${9999}, updated_at = NOW()`, app, await idOf("Screening"), 9999, TERMINAL_KINDS);
    const [row] = (await pg.query(statement.text, statement.params)).rows;
    assert.deepEqual({ found: row.found, updated: row.updated }, { found: 1, updated: 0 });
  });

  test("an unknown application reports missing", async () => {
    assert.deepEqual(await runMove(999, "Interview", "Applied"), { found: 0, updated: 0 });
  });

  test("history naming a deleted lane is skipped when finding the boundary", async () => {
    const app = await createApp("Offer");
    const [applied, interview, offer] = [await idOf("Applied"), await idOf("Interview"), await idOf("Offer")];
    await sql`
      INSERT INTO application_transitions (application_id, from_status, from_stage_id, to_status, to_stage_id, transitioned_at) VALUES
        (${app}, 'Applied', ${applied}, 'Old lane', NULL, '2026-01-01T00:00:00Z'),
        (${app}, 'Old lane', NULL, 'Interview', ${interview}, '2026-01-02T00:00:00Z'),
        (${app}, 'Interview', ${interview}, 'Offer', ${offer}, '2026-01-03T00:00:00Z')`;
    const { after: path } = await move(app, "Interview");
    assert.deepEqual(shape(path), ["Applied->Old lane", "Old lane->Interview"]);
  });

  test("a lane deleted and re-created under the same name does not inherit the old history", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Screening", "Interview");
    const oldScreening = await idOf("Screening");
    await sql`DELETE FROM stages WHERE id = ${oldScreening}`;
    await sql`INSERT INTO stages (name, sort_order, kind) VALUES ('Screening', 3, 'active')`;
    assert.notEqual(await idOf("Screening"), oldScreening);

    // The old edge keeps its name but loses its id, so it is not the new lane.
    assert.deepEqual(idShape(await history(app))[0], `Applied#${await idOf("Applied")}->Screening#-`);
    // The twin agrees on the rewind (checked inside move). The path runs from
    // the deleted lane into the new one, so the card has an edge into its lane.
    await move(app, "Screening");
    assert.deepEqual(idShape(await history(app)), [
      `Applied#${await idOf("Applied")}->Screening#-`,
      `Screening#-->Screening#${await idOf("Screening")}`
    ]);
  });

  test("rewinds after the entry lane was deleted still match the twin", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Screening", "Interview");
    await sql`DELETE FROM stages WHERE name = 'Applied'`;
    // Onto a visited lane: the edge into Screening is kept.
    const { after: kept } = await move(app, "Screening");
    assert.deepEqual(idShape(kept), [`Applied#-->Screening#${await idOf("Screening")}`]);
    // Below every lane on the path: with the entry lane gone nothing is
    // cleared, and the path reconnects from the deleted entry lane.
    const { after: reconnected } = await move(app, "Wishlist");
    assert.deepEqual(idShape(reconnected), [`Applied#-->Wishlist#${await idOf("Wishlist")}`]);
  });

  test("a rewind whose boundary cannot be resolved leaves the history alone", async () => {
    // Rows as the previous code wrote them (names only), e.g. during a deploy.
    const app = await createApp("Offer");
    await sql`
      INSERT INTO application_transitions (application_id, from_status, to_status, transitioned_at) VALUES
        (${app}, 'Applied', 'Screening', '2026-01-01T00:00:00Z'),
        (${app}, 'Screening', 'Offer', '2026-01-02T00:00:00Z')`;
    const { after: path } = await move(app, "Interview");
    assert.deepEqual(shape(path), ["Applied->Screening", "Screening->Offer"]);
  });
});

describe("applied date through real moves", () => {
  async function appliedAt(appId) {
    const [row] = await sql`SELECT applied_at FROM application_applied_at WHERE application_id = ${appId}`;
    return row.applied_at && new Date(row.applied_at).toISOString();
  }
  async function firstMoveInto(appId, stageName) {
    const [row] = await sql`
      SELECT t.transitioned_at FROM application_transitions t JOIN stages s ON s.id = t.to_stage_id
      WHERE t.application_id = ${appId} AND s.name = ${stageName}
      ORDER BY t.transitioned_at, t.id LIMIT 1`;
    return new Date(row.transitioned_at).toISOString();
  }

  test("a wishlist card is sent when it leaves intake, and unsent again when rewound into it", async () => {
    const app = await createApp("Wishlist");
    assert.equal(await appliedAt(app), null);
    await moveAll(app, "Applied", "Interview");
    const sent = await firstMoveInto(app, "Applied");
    assert.equal(await appliedAt(app), sent);
    await move(app, "Applied");
    assert.equal(await appliedAt(app), sent, "a rewind onto a visited lane keeps the date");
    await move(app, "Wishlist");
    assert.equal(await appliedAt(app), null);
  });

  test("a wishlist card dropped straight into an outcome lane was never sent", async () => {
    const app = await createApp("Wishlist");
    await move(app, "Ghosting");
    assert.equal(await appliedAt(app), null);
  });

  // A known limit of deriving the date: moving below the entry lane clears the
  // path, so the card now looks like it started in the wishlist and the date
  // becomes the next move out of it.
  test("a card created in the pipeline and moved back to the wishlist loses its creation date", async () => {
    const app = await createApp("Applied");
    const [{ created_at: created }] = await sql`SELECT created_at FROM applications WHERE id = ${app}`;
    assert.equal(await appliedAt(app), new Date(created).toISOString());
    await moveAll(app, "Wishlist", "Applied");
    assert.equal(await appliedAt(app), await firstMoveInto(app, "Applied"));
  });
});

describe("stage update statement", () => {
  async function update(stageName, changes) {
    const statement = stageUpdateStatement(await idOf(stageName), changes);
    return (await pg.query(statement.text, statement.params)).rows;
  }

  test("a rename rewrites the lane's names in history, and only those", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Screening", "Interview");
    const screening = await idOf("Screening");

    const [row] = await update("Screening", { name: "Phone screen" });
    assert.deepEqual({ id: row.id, name: row.name, kind: row.kind }, { id: screening, name: "Phone screen", kind: "active" });
    assert.deepEqual(shape(await history(app)), ["Applied->Phone screen", "Phone screen->Interview"]);

    // Moves after the rename still agree with the twin.
    await move(app, "Phone screen");
    assert.deepEqual(shape(await history(app)), ["Applied->Phone screen"]);
  });

  test("a kind change leaves names alone", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Screening");
    const [row] = await update("Screening", { kind: "interview" });
    assert.equal(row.kind, "interview");
    assert.equal(row.name, "Screening");
    assert.deepEqual(shape(await history(app)), ["Applied->Screening"]);
  });

  test("a rename onto another lane's name is rejected, whatever the case", async () => {
    await assert.rejects(update("Screening", { name: "interview" }), (error) => error.code === "23505");
  });

  test("a rename onto a deleted neighbour's name is allowed: they are different lanes", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Screening", "Interview");
    // Screening is deleted; its edge into Interview keeps the name "Screening".
    await sql`DELETE FROM stages WHERE name = 'Screening'`;
    const interview = await idOf("Interview");
    await update("Interview", { name: "Screening" });
    assert.deepEqual(idShape(await history(app)).slice(1), [`Screening#-->Screening#${interview}`]);
  });

  test("an unknown lane returns no row", async () => {
    const statement = stageUpdateStatement(999, { name: "Nowhere" });
    assert.deepEqual((await pg.query(statement.text, statement.params)).rows, []);
  });

  test("deleting a renamed lane keeps its last name in history", async () => {
    const app = await createApp("Applied");
    await moveAll(app, "Screening", "Interview");
    await update("Screening", { name: "Phone screen" });
    await sql`DELETE FROM stages WHERE name = 'Phone screen'`;
    assert.deepEqual(idShape(await history(app)).map((edge) => edge.replace(/#\d+/g, "#id")), [
      "Applied#id->Phone screen#-",
      "Phone screen#-->Interview#id"
    ]);
  });
});

describe("compileSql", () => {
  test("numbers parameters across nested fragments", () => {
    const inner = sqlFragment`a = ${1}, b = ${"two"}`;
    const statement = compileSql(sqlFragment`UPDATE t SET ${inner} WHERE id = ${3} AND k = ANY(${["x"]})`);
    assert.equal(statement.text, "UPDATE t SET a = $1, b = $2 WHERE id = $3 AND k = ANY($4)");
    assert.deepEqual(statement.params, [1, "two", 3, ["x"]]);
  });
});
