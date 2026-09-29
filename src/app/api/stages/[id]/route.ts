import { NextRequest, NextResponse } from "next/server";
import { deleteStage, updateStage } from "@/lib/db";
import { errorResponse } from "@/lib/api-errors";
import { requireSession } from "@/lib/auth";
import {
  ApiValidationError,
  TEXT_LIMITS,
  optionalEnum,
  optionalString,
  positiveInteger,
  readJsonObject
} from "@/lib/api-validation";
import { STAGE_KINDS } from "@/lib/stage-kinds";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    await requireSession({ write: true });
    const stageId = positiveInteger(id, "id");
    const body = await readJsonObject(request);
    const name = optionalString(body, "name", { maxLength: TEXT_LIMITS.stageName });
    const kind = optionalEnum(body, "kind", STAGE_KINDS);
    if (name === undefined && kind === undefined) {
      throw new ApiValidationError("Send a name, a kind, or both");
    }
    const stage = await updateStage(stageId, { name, kind });
    return NextResponse.json(stage);
  } catch (error) {
    return errorResponse(error, "Failed to update stage");
  }
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;

  try {
    await requireSession({ write: true });
    const stageId = positiveInteger(id, "id");
    await deleteStage(stageId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Failed to delete stage");
  }
}
