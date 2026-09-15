import { NextRequest, NextResponse } from "next/server";
import { updateApplicationStage } from "@/lib/db";
import { errorResponse } from "@/lib/api-errors";
import { requireSession } from "@/lib/auth";
import { optionalPositiveInteger, positiveInteger, readJsonObject } from "@/lib/api-validation";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    await requireSession({ write: true });
    const applicationId = positiveInteger(id, "id");
    const body = await readJsonObject(request);
    const updated = await updateApplicationStage(
      applicationId,
      positiveInteger(body.stageId, "stageId"),
      optionalPositiveInteger(body, "expectedStageId")
    );

    if (!updated) {
      return NextResponse.json({ message: "Application not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error, "Failed to update application");
  }
}
