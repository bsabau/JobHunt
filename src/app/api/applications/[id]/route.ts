import { NextRequest, NextResponse } from "next/server";
import { deleteApplication, updateApplication } from "@/lib/db";
import { errorResponse } from "@/lib/api-errors";
import {
  TEXT_LIMITS,
  optionalDateOnly,
  optionalHttpUrl,
  optionalString,
  positiveInteger,
  readJsonObject,
  requiredString
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
      company: requiredString(payload, "company", { maxLength: TEXT_LIMITS.company }),
      role: requiredString(payload, "role", { maxLength: TEXT_LIMITS.role }),
      notes: optionalString(payload, "notes", { maxLength: TEXT_LIMITS.notes }),
      interviewDate: optionalDateOnly(payload, "interviewDate"),
      sourceUrl: optionalHttpUrl(payload, "sourceUrl"),
      stageId: positiveInteger(payload.stageId, "stageId")
    });

    if (!updated) {
      return NextResponse.json({ message: "Application not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error, "Failed to update application");
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;

  try {
    const applicationId = positiveInteger(id, "id");
    const deleted = await deleteApplication(applicationId);

    if (!deleted) {
      return NextResponse.json({ message: "Application not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, "Failed to delete application");
  }
}
