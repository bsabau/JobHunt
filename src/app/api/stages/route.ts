import { NextRequest, NextResponse } from "next/server";
import { addStage, listStages } from "@/lib/db";
import {
  isApiValidationError,
  readJsonObject,
  requiredString,
  validationErrorResponse
} from "@/lib/api-validation";

export async function GET() {
  return NextResponse.json(await listStages());
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    const stage = await addStage(requiredString(body, "name"));
    return NextResponse.json(stage, { status: 201 });
  } catch (error) {
    if (isApiValidationError(error)) {
      return validationErrorResponse(error);
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to add stage" },
      { status: 400 }
    );
  }
}
