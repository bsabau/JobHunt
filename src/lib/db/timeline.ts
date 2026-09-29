import { NotFoundError } from "@/lib/api-errors";
import { applicationTimelineStatement } from "@/lib/application-statements";
import { TimelinePayload } from "@/lib/types";
import { ensureSchema, getSql } from "./client";
import { TimelineRow, mapTimeline } from "./rows";

// The application's current path. Holds no notes, so it is the same for the
// owner and the guest.
export async function getApplicationTimeline(id: number): Promise<TimelinePayload> {
  await ensureSchema();

  const statement = applicationTimelineStatement(id);
  const rows = (await getSql().query(statement.text, statement.params)) as TimelineRow[];

  if (rows.length === 0) {
    throw new NotFoundError("Application not found");
  }

  return mapTimeline(rows[0]);
}
