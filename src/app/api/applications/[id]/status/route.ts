import { NextRequest, NextResponse } from "next/server";
import { updateApplicationStage } from "@/lib/db";
import { errorResponse } from "@/lib/api-errors";
import { requireSession } from "@/lib/auth";
import { positiveInteger, readJsonObject } from "@/lib/api-validation";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    await requireSession({ write: true });
    const applicationId = positiveInteger(id, "id");
    const body = await readJsonObject(request);
    // The expected stage is mandatory: without it the move cannot be guarded
    // against a concurrent move and the recorded transition may start from a
    // stage the application had already left.
    const updated = await updateApplicationStage(
      applicationId,
      positiveInteger(body.stageId, "stageId"),
      positiveInteger(body.expectedStageId, "expectedStageId")
    );

    if (!updated) {
      return NextResponse.json({ message: "Application not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error, "Failed to update application");
  }
}
