import { NextRequest, NextResponse } from "next/server";
import { addStage, listStages } from "@/lib/db";
import { errorResponse } from "@/lib/api-errors";
import { requireSession } from "@/lib/auth";
import { TEXT_LIMITS, optionalEnum, readJsonObject, requiredString } from "@/lib/api-validation";
import { STAGE_KINDS } from "@/lib/stage-kinds";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json(await listStages());
  } catch (error) {
    return errorResponse(error, "Failed to load stages");
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSession({ write: true });
    const body = await readJsonObject(request);
    const stage = await addStage(
      requiredString(body, "name", { maxLength: TEXT_LIMITS.stageName }),
      optionalEnum(body, "kind", STAGE_KINDS)
    );
    return NextResponse.json(stage, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Failed to add stage");
  }
}
