import type { Role } from "@/lib/auth";
import type { StageKind } from "@/lib/stage-kinds";
import type { WorkMode } from "@/lib/limits";
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
  interview_time: string | null;
  interview_time_zone: string | null;
  source_url: string | null;
  logo_url: string | null;
  referral: boolean;
  work_mode: WorkMode | null;
  location: string | null;
  salary: string | null;
  stage_id: number;
  stage_name: string;
  stage_kind: StageKind;
  created_at: Timestamp;
  updated_at: Timestamp;
  stage_entered_at: Timestamp;
  applied_at: Timestamp | null;
  stale_clock_at: Timestamp;
  followed_up_at: Timestamp | null;
  snoozed_until: Timestamp | null;
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

// Notes and salary are owner-only: every application handed to a guest goes
// through here with viewer "guest", so no caller has to remember to redact.
export function mapApplication(row: ApplicationRow, viewer: Role): Application {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    notes: viewer === "guest" ? null : row.notes || null,
    interviewDate: row.interview_date || null,
    interviewTime: row.interview_time,
    interviewTimeZone: row.interview_time_zone,
    sourceUrl: row.source_url || null,
    logoUrl: row.logo_url || null,
    referral: row.referral,
    workMode: row.work_mode,
    location: row.location,
    salary: viewer === "guest" ? null : row.salary,
    stageId: row.stage_id,
    stageName: row.stage_name,
    stageKind: row.stage_kind,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    stageEnteredAt: toIsoString(row.stage_entered_at),
    appliedAt: row.applied_at === null ? null : toIsoString(row.applied_at),
    staleClockAt: toIsoString(row.stale_clock_at),
    followedUpAt: row.followed_up_at === null ? null : toIsoString(row.followed_up_at),
    snoozedUntil: row.snoozed_until === null ? null : toIsoString(row.snoozed_until)
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
