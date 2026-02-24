import { NextResponse } from "next/server";
import { deleteApplication } from "@/lib/db";

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const deleted = await deleteApplication(Number(id));

  if (!deleted) {
    return NextResponse.json({ message: "Application not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
