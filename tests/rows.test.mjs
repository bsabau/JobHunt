import assert from "node:assert/strict";
import { test } from "node:test";
import { mapApplication, mapStage } from "../src/lib/db/rows.ts";

const row = {
  id: 7,
  company: "Acme",
  role: "Engineer",
  notes: "Salary 90k, recruiter Jane",
  interview_date: "2026-10-02",
  source_url: "",
  logo_url: null,
  referral: true,
  work_mode: "hybrid",
  location: "Utrecht",
  salary: "70-80k",
  stage_id: 3,
  stage_name: "Interview",
  stage_kind: "interview",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: new Date("2026-09-02T10:00:00Z"),
  stage_entered_at: "2026-09-02T10:00:00Z",
  applied_at: "2026-09-01T10:00:00Z",
  stale_clock_at: "2026-09-05T10:00:00Z",
  followed_up_at: new Date("2026-09-05T10:00:00Z"),
  snoozed_until: null
};

test("the owner sees the notes; a guest never does", () => {
  assert.equal(mapApplication(row, "user").notes, "Salary 90k, recruiter Jane");
  assert.equal(mapApplication(row, "guest").notes, null);
});

test("snake_case columns map to the Application shape", () => {
  assert.deepEqual(mapApplication(row, "user"), {
    id: 7,
    company: "Acme",
    role: "Engineer",
    notes: "Salary 90k, recruiter Jane",
    interviewDate: "2026-10-02",
    sourceUrl: null,
    logoUrl: null,
    referral: true,
    workMode: "hybrid",
    location: "Utrecht",
    salary: "70-80k",
    stageId: 3,
    stageName: "Interview",
    stageKind: "interview",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    stageEnteredAt: "2026-09-02T10:00:00.000Z",
    appliedAt: "2026-09-01T10:00:00.000Z",
    staleClockAt: "2026-09-05T10:00:00.000Z",
    followedUpAt: "2026-09-05T10:00:00.000Z",
    snoozedUntil: null
  });
  assert.deepEqual(mapStage({ id: 3, name: "Interview", sort_order: 2, kind: "interview" }), {
    id: 3,
    name: "Interview",
    sortOrder: 2,
    kind: "interview"
  });
});

test("a wishlist card that was never sent has no applied date", () => {
  assert.equal(mapApplication({ ...row, applied_at: null }, "user").appliedAt, null);
});

test("the stale clock and follow-up reach the guest too: the board's stale marker needs them", () => {
  const guest = mapApplication(row, "guest");
  assert.deepEqual([guest.staleClockAt, guest.followedUpAt, guest.snoozedUntil], ["2026-09-05T10:00:00.000Z", "2026-09-05T10:00:00.000Z", null]);
});

test("salary is owner-only like notes; referral, work mode and location reach the guest", () => {
  assert.equal(mapApplication(row, "user").salary, "70-80k");
  const guest = mapApplication(row, "guest");
  assert.equal(guest.salary, null);
  assert.deepEqual([guest.referral, guest.workMode, guest.location], [true, "hybrid", "Utrecht"]);
});
