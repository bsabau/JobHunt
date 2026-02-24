import { NextRequest, NextResponse } from "next/server";
import { deleteApplication, updateApplication } from "@/lib/db";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const payload = await request.json();

  if (!payload.company || !payload.role) {
    return NextResponse.json({ message: "company and role are required" }, { status: 400 });
  }

  if (!payload.stageId || Number.isNaN(Number(payload.stageId))) {
    return NextResponse.json({ message: "Valid stageId is required" }, { status: 400 });
  }

  try {
    const updated = await updateApplication(Number(id), {
      company: String(payload.company),
      role: String(payload.role),
      notes: payload.notes ? String(payload.notes) : undefined,
      interviewDate: payload.interviewDate ? String(payload.interviewDate) : null,
      sourceUrl: payload.sourceUrl ? String(payload.sourceUrl) : undefined,
      stageId: Number(payload.stageId)
    });

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

export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const deleted = await deleteApplication(Number(id));

  if (!deleted) {
    return NextResponse.json({ message: "Application not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
