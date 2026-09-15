import { NextResponse } from "next/server";
import { deleteStage } from "@/lib/db";
import { errorResponse } from "@/lib/api-errors";
import { positiveInteger } from "@/lib/api-validation";

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;

  try {
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
