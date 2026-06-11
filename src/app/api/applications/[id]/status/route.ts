import { NextRequest, NextResponse } from "next/server";
import { updateApplicationStage } from "@/lib/db";
import {
  isApiValidationError,
  positiveInteger,
  readJsonObject,
  validationErrorResponse
} from "@/lib/api-validation";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    const applicationId = positiveInteger(id, "id");
    const body = await readJsonObject(request);
    const updated = await updateApplicationStage(applicationId, positiveInteger(body.stageId, "stageId"));

    if (!updated) {
      return NextResponse.json({ message: "Application not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (isApiValidationError(error)) {
      return validationErrorResponse(error);
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to update application" },
      { status: 400 }
    );
  }
}
