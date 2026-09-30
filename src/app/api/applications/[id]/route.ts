import { NextRequest, NextResponse } from "next/server";
import { deleteApplication, updateApplication } from "@/lib/db";
import { scheduleLogoLookup } from "@/lib/logo-lookup";
import { errorResponse } from "@/lib/api-errors";
import { requireSession } from "@/lib/auth";
import {
  TEXT_LIMITS,
  optionalApplicationFields,
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

// A full replacement of the editable fields, hence PUT.
export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    await requireSession({ write: true });
    const applicationId = positiveInteger(id, "id");
    const payload = await readJsonObject(request);
    const updated = await updateApplication(applicationId, {
      company: requiredString(payload, "company", { maxLength: TEXT_LIMITS.company }),
      role: requiredString(payload, "role", { maxLength: TEXT_LIMITS.role }),
      notes: optionalString(payload, "notes", { maxLength: TEXT_LIMITS.notes }),
      interviewDate: optionalDateOnly(payload, "interviewDate"),
      sourceUrl: optionalHttpUrl(payload, "sourceUrl"),
      ...optionalApplicationFields(payload),
      stageId: positiveInteger(payload.stageId, "stageId"),
      // Mandatory so the stage change is always guarded against a concurrent move.
      expectedStageId: positiveInteger(payload.expectedStageId, "expectedStageId")
    });

    if (!updated) {
      return NextResponse.json({ message: "Application not found" }, { status: 404 });
    }

    // A renamed company comes back without a logo (the update clears it), as
    // does a card whose earlier lookup found nothing or failed; look it up.
    if (updated.logoUrl === null) {
      scheduleLogoLookup(updated.id, updated.company);
    }

    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error, "Failed to update application");
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;

  try {
    await requireSession({ write: true });
    const applicationId = positiveInteger(id, "id");
    const deleted = await deleteApplication(applicationId);

    if (!deleted) {
      return NextResponse.json({ message: "Application not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Failed to delete application");
  }
}
