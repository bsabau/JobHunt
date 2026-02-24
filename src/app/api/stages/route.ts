import { NextRequest, NextResponse } from "next/server";
import { addStage, listStages } from "@/lib/db";

export async function GET() {
  return NextResponse.json(await listStages());
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ message: "Stage name is required" }, { status: 400 });
  }

  try {
    const stage = await addStage(body.name);
    return NextResponse.json(stage, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to add stage" },
      { status: 400 }
    );
  }
}
