import { NextRequest, NextResponse } from "next/server";
import { deleteApplication, updateApplication } from "@/lib/db";
import {
  isApiValidationError,
  optionalDateOnly,
  optionalHttpUrl,
  optionalString,
  positiveInteger,
  readJsonObject,
  requiredString,
  validationErrorResponse
} from "@/lib/api-validation";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    const applicationId = positiveInteger(id, "id");
    const payload = await readJsonObject(request);
    const updated = await updateApplication(applicationId, {
      company: requiredString(payload, "company"),
      role: requiredString(payload, "role"),
      notes: optionalString(payload, "notes"),
      interviewDate: optionalDateOnly(payload, "interviewDate"),
      sourceUrl: optionalHttpUrl(payload, "sourceUrl"),
      stageId: positiveInteger(payload.stageId, "stageId")
    });

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

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;

  let applicationId: number;
  try {
    applicationId = positiveInteger(id, "id");
  } catch (error) {
    if (isApiValidationError(error)) {
      return validationErrorResponse(error);
    }
    throw error;
  }

  const deleted = await deleteApplication(applicationId);

  if (!deleted) {
    return NextResponse.json({ message: "Application not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
