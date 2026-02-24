import { NextResponse } from "next/server";
import { deleteStage } from "@/lib/db";

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const result = await deleteStage(Number(id));

  if (!result.deleted) {
    const status = result.reason === "Stage not found" ? 404 : 400;
    return NextResponse.json({ message: result.reason }, { status });
  }

  return NextResponse.json({ success: true });
}
