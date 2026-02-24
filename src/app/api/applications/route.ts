import { NextRequest, NextResponse } from "next/server";
import { createApplication, listApplications, listStages } from "@/lib/db";
import { findCompanyLogo } from "@/lib/logo";

export async function GET() {
  const [applications, stages] = await Promise.all([listApplications(), listStages()]);
  return NextResponse.json({ applications, stages });
}

export async function POST(request: NextRequest) {
  const payload = await request.json();

  if (!payload.company || !payload.role) {
    return NextResponse.json({ message: "company and role are required" }, { status: 400 });
  }

  const logoUrl = await findCompanyLogo(payload.company);

  try {
    const application = await createApplication({
      company: String(payload.company),
      role: String(payload.role),
      notes: payload.notes ? String(payload.notes) : undefined,
      sourceUrl: payload.sourceUrl ? String(payload.sourceUrl) : undefined,
      stageId: payload.stageId ? Number(payload.stageId) : undefined,
      logoUrl
    });

    return NextResponse.json(application, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to create application" },
      { status: 400 }
    );
  }
}
