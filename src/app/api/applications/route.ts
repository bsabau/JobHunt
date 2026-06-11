import { NextRequest, NextResponse } from "next/server";
import { createApplication, listApplications, listStages } from "@/lib/db";
import { findCompanyLogo } from "@/lib/logo";
import {
  isApiValidationError,
  optionalDateOnly,
  optionalHttpUrl,
  optionalPositiveInteger,
  optionalString,
  readJsonObject,
  requiredString,
  validationErrorResponse
} from "@/lib/api-validation";

export async function GET() {
  const [applications, stages] = await Promise.all([listApplications(), listStages()]);
  return NextResponse.json({ applications, stages });
}

export async function POST(request: NextRequest) {
  try {
    const payload = await readJsonObject(request);
    const company = requiredString(payload, "company");
    const role = requiredString(payload, "role");
    const notes = optionalString(payload, "notes");
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
    if (isApiValidationError(error)) {
      return validationErrorResponse(error);
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to create application" },
      { status: 400 }
    );
  }
}
