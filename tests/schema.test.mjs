// Checks the schema the real migrations build, on an in-process Postgres
// (PGlite). Never points at a real database.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../scripts/migration-utils.mjs";

let pg;

async function sql(strings, ...values) {
  return (await pg.query(strings.reduce((query, part, index) => `${query}$${index}${part}`), values)).rows;
}

async function rejectsWith(promise, code, constraint) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected SQLSTATE ${code}, got ${error.code}: ${error.message}`);
    if (constraint) {
      assert.match(error.message, new RegExp(constraint));
    }
    return true;
  });
}

before(async () => {
  pg = new PGlite();
  // A leftover from the previous migration tool, as found in production.
  await sql`CREATE TABLE pgmigrations (id SERIAL PRIMARY KEY, name TEXT)`;
  await runMigrations(sql, () => {});
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await sql`TRUNCATE TABLE application_transitions, applications, stages RESTART IDENTITY CASCADE`;
  await sql`INSERT INTO stages (name, sort_order, kind) VALUES ('Applied', 0, 'active'), ('Interview', 1, 'interview')`;
});

// Forgets every migration from `filename` on and applies them again, so the
// schema always ends in its final state and later tests are unaffected.
async function rerunFrom(filename, log = () => {}) {
  await sql`DELETE FROM schema_migrations WHERE filename >= ${filename}`;
  await runMigrations(sql, log);
}

const applied = async () => (await sql`SELECT id FROM stages WHERE name = 'Applied'`)[0].id;

describe("schema built by the migrations", () => {
  test("foreign keys are indexed", async () => {
    const rows = await sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`;
    const names = rows.map((row) => row.indexname);
    assert.ok(names.includes("application_transitions_app_time_idx"));
    assert.ok(names.includes("applications_stage_id_idx"));
  });

  test("the unused tables are gone", async () => {
    const rows = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('application_transitions_backup', 'pgmigrations')`;
    assert.deepEqual(rows, []);
  });

  test("lane names are unique regardless of case", async () => {
    await rejectsWith(sql`INSERT INTO stages (name, sort_order) VALUES ('applied', 2)`, "23505", "stages_name_lower_key");
  });

  test("blank names are rejected", async () => {
    await rejectsWith(sql`INSERT INTO stages (name, sort_order) VALUES ('  ', 2)`, "23514", "stages_name_not_blank");
    await rejectsWith(
      sql`INSERT INTO applications (company, role, stage_id) VALUES (' ', 'Engineer', ${await applied()})`,
      "23514",
      "applications_company_not_blank"
    );
    await rejectsWith(
      sql`INSERT INTO applications (company, role, stage_id) VALUES ('Acme', '', ${await applied()})`,
      "23514",
      "applications_role_not_blank"
    );
  });

  test("lane positions cannot be negative", async () => {
    await rejectsWith(sql`INSERT INTO stages (name, sort_order) VALUES ('Offer', -1)`, "23514", "stages_sort_order_non_negative");
  });

  test("a transition cannot go from a lane to itself; a deleted namesake is another lane", async () => {
    const id = await applied();
    const [app] = await sql`INSERT INTO applications (company, role, stage_id) VALUES ('Acme', 'Engineer', ${id}) RETURNING id`;
    await rejectsWith(
      sql`INSERT INTO application_transitions (application_id, from_status, from_stage_id, to_status, to_stage_id)
          VALUES (${app.id}, 'Applied', ${id}, 'Applied', ${id})`,
      "23514",
      "application_transitions_distinct_lanes"
    );
    // A deleted "Applied" (NULL id) into the live one is a real move.
    await sql`INSERT INTO application_transitions (application_id, from_status, from_stage_id, to_status, to_stage_id)
              VALUES (${app.id}, 'Applied', NULL, 'Applied', ${id})`;
  });

  test("legacy 'created' rows are removed, and re-running the migration is harmless", async () => {
    const [app] = await sql`INSERT INTO applications (company, role, stage_id) VALUES ('Acme', 'Engineer', ${await applied()}) RETURNING id`;
    await sql`
      INSERT INTO application_transitions (application_id, from_status, to_status) VALUES
        (${app.id}, 'Created', 'Applied'),
        (${app.id}, 'Applied', 'Interview')`;
    await rerunFrom("1730000010000");
    const rows = await sql`SELECT from_status, to_status FROM application_transitions WHERE application_id = ${app.id}`;
    assert.deepEqual(rows, [{ from_status: "Applied", to_status: "Interview" }]);
  });

  test("the phase 2 and 3 migrations re-run cleanly on a migrated database", async () => {
    const logged = [];
    await rerunFrom("1730000006000", (line) => logged.push(line));
    assert.equal(logged.length, 7);
    const rows = await sql`
      SELECT conname FROM pg_constraint
      WHERE conname IN ('applications_company_not_blank', 'applications_role_not_blank', 'stages_name_not_blank',
                        'stages_sort_order_non_negative', 'application_transitions_distinct_lanes',
                        'application_transitions_no_self_loop')
      ORDER BY conname`;
    assert.deepEqual(rows.map((row) => row.conname), [
      "application_transitions_distinct_lanes",
      "applications_company_not_blank",
      "applications_role_not_blank",
      "stages_name_not_blank",
      "stages_sort_order_non_negative"
    ], "each constraint exists exactly once, and the name-based self-loop check is gone");
  });

  test("a legacy 'created -> created' row does not stop the migrations", async () => {
    // The state of a copy that predates migration 1730000010000.
    await sql`ALTER TABLE application_transitions DROP CONSTRAINT IF EXISTS application_transitions_no_self_loop`;
    const [app] = await sql`INSERT INTO applications (company, role, stage_id) VALUES ('Acme', 'Engineer', ${await applied()}) RETURNING id`;
    await sql`INSERT INTO application_transitions (application_id, from_status, to_status) VALUES (${app.id}, 'created', 'created')`;
    await rerunFrom("1730000009000");
    assert.deepEqual(await sql`SELECT id FROM application_transitions WHERE application_id = ${app.id}`, []);
  });

  test("a run that read a stale list re-checks each file under the lock", async () => {
    // Simulates losing the race: the list read before locking says nothing is
    // applied, so only the re-check inside the lock prevents a second apply.
    const staleSql = (strings, ...values) =>
      /SELECT filename\s+FROM schema_migrations;/.test(strings.join("?")) ? Promise.resolve([]) : sql(strings, ...values);
    const logged = [];
    await runMigrations(staleSql, (line) => logged.push(line));
    assert.deepEqual(logged, []);
  });

  test("history is backfilled with lane ids by name; names without a lane stay empty", async () => {
    const [app] = await sql`INSERT INTO applications (company, role, stage_id) VALUES ('Acme', 'Engineer', ${await applied()}) RETURNING id`;
    // Rows as written before the id columns existed.
    await sql`
      INSERT INTO application_transitions (application_id, from_status, to_status) VALUES
        (${app.id}, 'Applied', 'Interview'),
        (${app.id}, 'Interview', 'Gone lane')`;
    await rerunFrom("1730000011000");
    const rows = await sql`
      SELECT t.from_status, fs.name AS from_lane, t.to_status, ts.name AS to_lane
      FROM application_transitions t
      LEFT JOIN stages fs ON fs.id = t.from_stage_id
      LEFT JOIN stages ts ON ts.id = t.to_stage_id
      WHERE t.application_id = ${app.id}
      ORDER BY t.id`;
    assert.deepEqual(rows, [
      { from_status: "Applied", from_lane: "Applied", to_status: "Interview", to_lane: "Interview" },
      { from_status: "Interview", from_lane: "Interview", to_status: "Gone lane", to_lane: null }
    ]);
  });

  test("deleting a lane keeps its name in history and clears its id", async () => {
    const [lane] = await sql`INSERT INTO stages (name, sort_order) VALUES ('Screening', 2) RETURNING id`;
    const [app] = await sql`INSERT INTO applications (company, role, stage_id) VALUES ('Acme', 'Engineer', ${await applied()}) RETURNING id`;
    await sql`
      INSERT INTO application_transitions (application_id, from_status, from_stage_id, to_status, to_stage_id)
      VALUES (${app.id}, 'Screening', ${lane.id}, 'Applied', ${await applied()})`;
    await sql`DELETE FROM stages WHERE id = ${lane.id}`;
    const [row] = await sql`SELECT from_status, from_stage_id FROM application_transitions WHERE application_id = ${app.id}`;
    assert.deepEqual(row, { from_status: "Screening", from_stage_id: null });
  });

  test("a second run applies nothing", async () => {
    const logged = [];
    await runMigrations(sql, (line) => logged.push(line));
    assert.deepEqual(logged, []);
  });
});
