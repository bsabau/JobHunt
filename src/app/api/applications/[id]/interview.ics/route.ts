import { NextRequest, NextResponse } from "next/server";
import { getInterviewEvent } from "@/lib/db";
import { NotFoundError, errorResponse } from "@/lib/api-errors";
import { requireSession } from "@/lib/auth";
import { positiveInteger } from "@/lib/api-validation";
import { interviewCalendar } from "@/lib/ics";

interface Params {
  params: Promise<{ id: string }>;
}

// Owner decision 17: timed interviews are 60 minutes long.
const INTERVIEW_MINUTES = 60;

// The interview as a calendar file: an all-day event on the date, or a
// 60-minute event at the time in its zone. Owner only. It holds the company,
// the role and the job link, never notes or salary.
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    await requireSession({ owner: true });
    const applicationId = positiveInteger(id, "id");
    const event = await getInterviewEvent(applicationId);
    if (!event || event.interview_date === null) {
      throw new NotFoundError(event ? "This application has no interview date" : "Application not found");
    }

    const ics = interviewCalendar({
      uid: `application-${applicationId}@${request.nextUrl.hostname}`,
      stamp: new Date(),
      summary: `Interview: ${event.company}, ${event.role}`,
      url: event.source_url,
      when:
        event.starts_at === null
          ? { date: event.interview_date }
          : { start: new Date(event.starts_at), minutes: INTERVIEW_MINUTES }
    });

    return new NextResponse(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="interview-${applicationId}.ics"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return errorResponse(error, "Failed to make the calendar file");
  }
}
