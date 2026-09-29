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
  stage_id: 3,
  stage_name: "Interview",
  stage_kind: "interview",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: new Date("2026-09-02T10:00:00Z"),
  stage_entered_at: "2026-09-02T10:00:00Z"
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
    stageId: 3,
    stageName: "Interview",
    stageKind: "interview",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
    stageEnteredAt: "2026-09-02T10:00:00.000Z"
  });
  assert.deepEqual(mapStage({ id: 3, name: "Interview", sort_order: 2, kind: "interview" }), {
    id: 3,
    name: "Interview",
    sortOrder: 2,
    kind: "interview"
  });
});
