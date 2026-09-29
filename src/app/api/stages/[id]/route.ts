import { NextRequest, NextResponse } from "next/server";
import { deleteStage, updateStageKind } from "@/lib/db";
import { errorResponse } from "@/lib/api-errors";
import { requireSession } from "@/lib/auth";
import { positiveInteger, readJsonObject, requiredEnum } from "@/lib/api-validation";
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
    const stage = await updateStageKind(stageId, requiredEnum(body, "kind", STAGE_KINDS));
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
    const result = await deleteStage(stageId);

    if (!result.deleted) {
      const status = result.reason === "Stage not found" ? 404 : 409;
      return NextResponse.json({ message: result.reason }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, "Failed to delete stage");
  }
}
