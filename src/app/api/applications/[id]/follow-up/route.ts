import { NextRequest, NextResponse } from "next/server";
import { recordStaleAction } from "@/lib/db";
import { errorResponse } from "@/lib/api-errors";
import { requireSession } from "@/lib/auth";
import { positiveInteger, readJsonObject, requiredEnum } from "@/lib/api-validation";

interface Params {
  params: Promise<{ id: string }>;
}

const STALE_ACTIONS = ["followed_up", "snooze", "unsnooze", "unfollow"] as const;

// What the owner did about a stale application: followed up (restarts the
// stale clock), snoozed it for a week, or one of the two undos, which touch
// one field each. The server sets the times. Closing it is a normal stage
// move (PATCH .../status).
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    await requireSession({ write: true });
    const applicationId = positiveInteger(id, "id");
    const payload = await readJsonObject(request);
    const action = requiredEnum(payload, "action", STALE_ACTIONS);
    return NextResponse.json(await recordStaleAction(applicationId, action));
  } catch (error) {
    return errorResponse(error, "Failed to update the application");
  }
}
