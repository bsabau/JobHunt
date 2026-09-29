import { StageKind } from "@/lib/stage-kinds";
import { Application, Stage } from "@/lib/types";

// Maps database rows to the shared TypeScript types.

function toIsoString(value: unknown): string {
  if (typeof value === "string") {
    return new Date(value).toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}

export function mapApplication(row: Record<string, unknown>): Application {
  return {
    id: Number(row.id),
    company: String(row.company),
    role: String(row.role),
    notes: row.notes ? String(row.notes) : null,
    interviewDate: row.interviewdate ? String(row.interviewdate) : null,
    sourceUrl: row.sourceurl ? String(row.sourceurl) : null,
    logoUrl: row.logourl ? String(row.logourl) : null,
    stageId: Number(row.stageid),
    stageName: String(row.stagename),
    stageKind: String(row.stagekind) as StageKind,
    createdAt: toIsoString(row.createdat),
    updatedAt: toIsoString(row.updatedat),
    stageEnteredAt: toIsoString(row.stageenteredat ?? row.createdat)
  };
}

// A lane row: `id, name, sort_order AS sortOrder, kind` (Postgres folds the
// alias to sortorder).
export function mapStage(row: Record<string, unknown>): Stage {
  return {
    id: Number(row.id),
    name: String(row.name),
    sortOrder: Number(row.sortorder),
    kind: String(row.kind) as StageKind
  };
}
