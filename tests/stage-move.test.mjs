// Runs the production stage-move statement against an in-process Postgres
// (PGlite) built by the real migrations, and holds it to the same scenarios as
// its TypeScript twin, rewindTransitionPath(). Never points at a real database.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../scripts/migration-utils.mjs";
import { compileSql, sqlFragment, stageMoveStatement } from "../src/lib/stage-move.ts";
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
const stageIds = new Map();

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
  stageIds.clear();
  for (const stage of BOARD) {
    const [row] = await sql`INSERT INTO stages (name, sort_order, kind) VALUES (${stage.name}, ${stage.sortOrder}, ${stage.kind}) RETURNING id`;
    stageIds.set(stage.name, row.id);
  }
});

async function createApp(stageName) {
  const [row] = await sql`INSERT INTO applications (company, role, stage_id) VALUES ('Acme', 'Engineer', ${stageIds.get(stageName)}) RETURNING id`;
  return row.id;
}

async function currentStage(appId) {
  const [row] = await sql`SELECT s.name FROM applications a JOIN stages s ON s.id = a.stage_id WHERE a.id = ${appId}`;
  return row?.name;
}

async function history(appId) {
  const rows = await sql`
    SELECT id, from_status, to_status, transitioned_at
    FROM application_transitions
    WHERE application_id = ${appId}
    ORDER BY transitioned_at ASC, id ASC`;
  return rows.map((row) => ({
    id: row.id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    transitionedAt: new Date(row.transitioned_at).toISOString()
  }));
}

// The pipeline rank of the lanes as they are now, so the twin sees reorders.
async function rankedStages() {
  const rows = await sql`SELECT name, sort_order, kind FROM stages`;
  return withPipelineRank(rows.map((row) => ({ name: row.name, sortOrder: row.sort_order, kind: row.kind })));
}

const shape = (transitions) => transitions.map((t) => `${t.fromStatus}->${t.toStatus}`);

async function runMove(appId, toName, expectedName) {
  const toStageId = stageIds.get(toName);
  const expectedStageId = expectedName === undefined ? null : stageIds.get(expectedName);
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
        : [...beforeMove, { fromStatus: fromName, toStatus: toName }]
      : rewindTransitionPath(beforeMove, target, fromName, ranked);

  const outcome = await runMove(appId, toName, fromName);
  assert.deepEqual(outcome, { found: 1, updated: 1 });
  assert.equal(await currentStage(appId), toName);

  const afterMove = await history(appId);
  assert.deepEqual(shape(afterMove), shape(expected), `SQL and rewindTransitionPath() disagree on ${fromName} -> ${toName}`);
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

  test("an unknown application reports missing", async () => {
    assert.deepEqual(await runMove(999, "Interview", "Applied"), { found: 0, updated: 0 });
  });

  test("history naming a deleted lane is skipped when finding the boundary", async () => {
    const app = await createApp("Offer");
    await sql`
      INSERT INTO application_transitions (application_id, from_status, to_status, transitioned_at) VALUES
        (${app}, 'Applied', 'Old lane', '2026-01-01T00:00:00Z'),
        (${app}, 'Old lane', 'Interview', '2026-01-02T00:00:00Z'),
        (${app}, 'Interview', 'Offer', '2026-01-03T00:00:00Z')`;
    const { after: path } = await move(app, "Interview");
    assert.deepEqual(shape(path), ["Applied->Old lane", "Old lane->Interview"]);
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
