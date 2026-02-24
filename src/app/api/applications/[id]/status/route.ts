import { NextRequest, NextResponse } from "next/server";
import { updateApplicationStage } from "@/lib/db";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json();

  if (!body.stageId || Number.isNaN(Number(body.stageId))) {
    return NextResponse.json({ message: "Invalid stageId" }, { status: 400 });
  }

  try {
    const updated = await updateApplicationStage(Number(id), Number(body.stageId));

    if (!updated) {
      return NextResponse.json({ message: "Application not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to update application" },
      { status: 400 }
    );
  }
}
