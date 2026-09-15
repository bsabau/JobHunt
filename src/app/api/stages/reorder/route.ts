import { NextRequest, NextResponse } from "next/server";
import { reorderStages } from "@/lib/db";
import { errorResponse } from "@/lib/api-errors";
import { requireSession } from "@/lib/auth";
import { ApiValidationError, positiveInteger, readJsonObject } from "@/lib/api-validation";

export async function PATCH(request: NextRequest) {
  try {
    await requireSession({ write: true });
    const body = await readJsonObject(request);
    if (!Array.isArray(body.stageIds)) {
      throw new ApiValidationError("stageIds array is required");
    }

    const updated = await reorderStages(body.stageIds.map((value) => positiveInteger(value, "stageId")));
    return NextResponse.json(updated);
  } catch (error) {
    return errorResponse(error, "Failed to reorder stages");
  }
}
