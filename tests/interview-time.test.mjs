// The interview's instant as Postgres computes it for the calendar file, and
// the constraints on the time and its zone. PGlite built by the real
// migrations; never a real database.
import assert from "node:assert/strict";
import { test } from "node:test";
import { iso, setupBoard } from "./helpers/pglite-board.mjs";
import { interviewEventStatement } from "../src/lib/application-statements.ts";

const { sql, createApp, run, pg } = setupBoard();

async function withInterview(date, time, zone) {
  const app = await createApp("Applied");
  await sql`UPDATE applications SET interview_date = ${date}, interview_time = ${time}, interview_time_zone = ${zone}, source_url = 'https://jobs.example.com/1', notes = 'private', salary = 'private' WHERE id = ${app}`;
  return (await run(interviewEventStatement(app)))[0];
}

test("the instant follows the zone's clock on both sides of a change", async () => {
  // Berlin: summer time (UTC+2) until 03:00 on 2026-10-25, then UTC+1.
  assert.equal(iso((await withInterview("2026-10-24", "10:00", "Europe/Berlin")).starts_at), "2026-10-24T08:00:00.000Z");
  assert.equal(iso((await withInterview("2026-10-25", "10:00", "Europe/Berlin")).starts_at), "2026-10-25T09:00:00.000Z");
  // New York moves to summer time on 2026-03-08.
  assert.equal(iso((await withInterview("2026-03-09", "09:30", "America/New_York")).starts_at), "2026-03-09T13:30:00.000Z");
});

test("without a time the event is the date alone; notes and salary are never read", async () => {
  const row = await withInterview("2026-10-05", null, null);
  assert.deepEqual(row, { company: "Acme", role: "Engineer", source_url: "https://jobs.example.com/1", interview_date: "2026-10-05", starts_at: null });
});

test("a time needs its zone and a date; an unknown application has no event", async () => {
  const app = await createApp("Applied");
  await assert.rejects(pg().query("UPDATE applications SET interview_date = '2026-10-05', interview_time = '10:00' WHERE id = $1", [app]), /applications_interview_time_has_zone/);
  await assert.rejects(pg().query("UPDATE applications SET interview_time = '10:00', interview_time_zone = 'UTC' WHERE id = $1", [app]), /applications_interview_time_has_date/);
  assert.deepEqual(await run(interviewEventStatement(999)), []);
});
