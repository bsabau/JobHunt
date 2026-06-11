import { NextRequest, NextResponse } from "next/server";
import { reorderStages } from "@/lib/db";
import {
  ApiValidationError,
  isApiValidationError,
  positiveInteger,
  readJsonObject,
  validationErrorResponse
} from "@/lib/api-validation";

export async function PATCH(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    if (!Array.isArray(body.stageIds)) {
      throw new ApiValidationError("stageIds array is required");
    }

    const updated = await reorderStages(body.stageIds.map((value) => positiveInteger(value, "stageId")));
    return NextResponse.json(updated);
  } catch (error) {
    if (isApiValidationError(error)) {
      return validationErrorResponse(error);
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to reorder stages" },
      { status: 400 }
    );
  }
}
