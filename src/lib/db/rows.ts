import type { Role } from "@/lib/auth";
import type { StageKind } from "@/lib/stage-kinds";
import type { Application, Stage, TimelinePayload } from "@/lib/types";

// Type-only imports, so the tests can load this file straight from Node.
//
// Rows as the queries return them. Columns keep their snake_case names (an
// alias such as `AS stageName` would reach JavaScript folded to "stagename"),
// and each query casts its result to one of these once. The Neon driver parses
// int4 as number, numeric and DATE-as-text as string, and timestamptz as a
// string or Date depending on the path, which the types reflect.

type Timestamp = string | Date;

export interface ApplicationRow {
  id: number;
  company: string;
  role: string;
  notes: string | null;
  interview_date: string | null;
  source_url: string | null;
  logo_url: string | null;
  stage_id: number;
  stage_name: string;
  stage_kind: StageKind;
  created_at: Timestamp;
  updated_at: Timestamp;
  stage_entered_at: Timestamp;
  applied_at: Timestamp | null;
}

export interface StageRow {
  id: number;
  name: string;
  sort_order: number;
  kind: StageKind;
}

function toIsoString(value: Timestamp): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

// Notes are owner-only: every application handed to a guest goes through here
// with viewer "guest", so no caller has to remember to redact.
export function mapApplication(row: ApplicationRow, viewer: Role): Application {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    notes: viewer === "guest" ? null : row.notes || null,
    interviewDate: row.interview_date || null,
    sourceUrl: row.source_url || null,
    logoUrl: row.logo_url || null,
    stageId: row.stage_id,
    stageName: row.stage_name,
    stageKind: row.stage_kind,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    stageEnteredAt: toIsoString(row.stage_entered_at),
    appliedAt: row.applied_at === null ? null : toIsoString(row.applied_at)
  };
}

// applicationTimelineStatement(): one row, the steps as JSON. Timestamps inside
// JSON arrive as strings in Postgres's own format, so they go through
// toIsoString() like the columns do.
export interface TimelineRow {
  created_at: Timestamp;
  entry_stage_id: number | null;
  entry_stage_name: string;
  entry_stage_kind: StageKind | null;
  steps: { stage_id: number | null; stage_name: string; stage_kind: StageKind | null; transitioned_at: string }[];
}

export function mapTimeline(row: TimelineRow): TimelinePayload {
  return {
    lanes: [
      {
        stageId: row.entry_stage_id,
        stageName: row.entry_stage_name,
        stageKind: row.entry_stage_kind,
        enteredAt: toIsoString(row.created_at)
      },
      ...row.steps.map((step) => ({
        stageId: step.stage_id,
        stageName: step.stage_name,
        stageKind: step.stage_kind,
        enteredAt: toIsoString(step.transitioned_at)
      }))
    ]
  };
}

export function mapStage(row: StageRow): Stage {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    kind: row.kind
  };
}
