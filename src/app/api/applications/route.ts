import { NextRequest, NextResponse } from "next/server";
import { createApplication, listApplications, listStages } from "@/lib/db";
import { findCompanyLogo } from "@/lib/logo";
import { errorResponse } from "@/lib/api-errors";
import { requireSession } from "@/lib/auth";
import {
  TEXT_LIMITS,
  optionalDateOnly,
  optionalHttpUrl,
  optionalPositiveInteger,
  optionalString,
  readJsonObject,
  requiredString
} from "@/lib/api-validation";

export async function GET() {
  try {
    const session = await requireSession();
    const [applications, stages] = await Promise.all([listApplications(), listStages()]);
    // Notes can hold salary expectations and recruiter contacts; guests get a
    // redacted DTO rather than the owner's free text.
    const visibleApplications =
      session.role === "guest" ? applications.map((application) => ({ ...application, notes: null })) : applications;
    return NextResponse.json({ applications: visibleApplications, stages });
  } catch (error) {
    return errorResponse(error, "Failed to load applications");
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSession({ write: true });
    const payload = await readJsonObject(request);
    const company = requiredString(payload, "company", { maxLength: TEXT_LIMITS.company });
    const role = requiredString(payload, "role", { maxLength: TEXT_LIMITS.role });
    const notes = optionalString(payload, "notes", { maxLength: TEXT_LIMITS.notes });
    const interviewDate = optionalDateOnly(payload, "interviewDate");
    const sourceUrl = optionalHttpUrl(payload, "sourceUrl");
    const stageId = optionalPositiveInteger(payload, "stageId");
    const logoUrl = await findCompanyLogo(company);

    const application = await createApplication({
      company,
      role,
      notes,
      interviewDate,
      sourceUrl,
      stageId,
      logoUrl
    });

    return NextResponse.json(application, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Failed to create application");
  }
}
