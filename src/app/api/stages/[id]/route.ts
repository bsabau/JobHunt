import { NextResponse } from "next/server";
import { deleteStage } from "@/lib/db";
import { isApiValidationError, positiveInteger, validationErrorResponse } from "@/lib/api-validation";

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  let stageId: number;

  try {
    stageId = positiveInteger(id, "id");
  } catch (error) {
    if (isApiValidationError(error)) {
      return validationErrorResponse(error);
    }
    throw error;
  }

  const result = await deleteStage(stageId);

  if (!result.deleted) {
    const status = result.reason === "Stage not found" ? 404 : 400;
    return NextResponse.json({ message: result.reason }, { status });
  }

  return NextResponse.json({ success: true });
}
