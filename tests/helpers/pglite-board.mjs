// A board on an in-process Postgres (PGlite) built by the real migrations, for
// tests of the stats views and statements. Cards are moved by the production
// move statement. Never points at a real database. Not a test file itself
// (npm test runs tests/**/*.test.mjs).
import assert from "node:assert/strict";
import { after, before, beforeEach } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../../scripts/migration-utils.mjs";
import { TERMINAL_KINDS } from "../../src/lib/stage-kinds.ts";
import { sqlFragment, stageMoveStatement } from "../../src/lib/stage-statements.ts";

export const BOARD = [
  { name: "Wishlist", kind: "intake" },
  { name: "Applied", kind: "active" },
  { name: "Screening", kind: "active" },
  { name: "Interview", kind: "interview" },
  { name: "Offer", kind: "offer" },
  { name: "Rejected", kind: "rejected" },
  { name: "Ghosted", kind: "closed" }
].map((stage, sortOrder) => ({ ...stage, sortOrder }));

export const CREATED = "2026-01-01T00:00:00.000Z";

export const iso = (value) => (value === null ? null : new Date(value).toISOString());

// Registers the setup hooks for the calling test file and returns its helpers.
// Every test starts from an empty board with the lanes above.
export function setupBoard() {
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

  async function createApp(stageName, createdAt = CREATED) {
    const [row] = await sql`
      INSERT INTO applications (company, role, stage_id, created_at)
      VALUES ('Acme', 'Engineer', ${await idOf(stageName)}, ${createdAt}) RETURNING id`;
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

  // The time of the application's n-th edge on its current path (0-based).
  async function edgeAt(appId, index) {
    const rows = await sql`SELECT transitioned_at FROM application_transitions WHERE application_id = ${appId} ORDER BY transitioned_at, id`;
    return iso(rows[index].transitioned_at);
  }

  // Runs a compiled statement ({ text, params }) and returns its rows.
  async function run(statement) {
    return (await pg.query(statement.text, statement.params)).rows;
  }

  return { sql, idOf, createApp, move, edgeAt, run, pg: () => pg };
}
