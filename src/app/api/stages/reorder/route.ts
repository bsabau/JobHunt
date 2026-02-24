import { NextRequest, NextResponse } from "next/server";
import { reorderStages } from "@/lib/db";

export async function PATCH(request: NextRequest) {
  const body = await request.json();

  if (!Array.isArray(body.stageIds)) {
    return NextResponse.json({ message: "stageIds array is required" }, { status: 400 });
  }

  try {
    const updated = await reorderStages(body.stageIds.map((value: unknown) => Number(value)));
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to reorder stages" },
      { status: 400 }
    );
  }
}
