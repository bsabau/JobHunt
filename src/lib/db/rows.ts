import { Application } from "@/lib/types";

// Maps database rows to the shared TypeScript types.

export function toIsoString(value: unknown): string {
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
    stageKind: String(row.stagekind ?? "active") as Application["stageKind"],
    createdAt: toIsoString(row.createdat),
    updatedAt: toIsoString(row.updatedat),
    stageEnteredAt: toIsoString(row.stageenteredat ?? row.createdat)
  };
}
