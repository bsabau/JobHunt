import { NextResponse } from "next/server";
import { getApplicationTimeline } from "@/lib/db";
import { errorResponse } from "@/lib/api-errors";
import { requireSession } from "@/lib/auth";
import { positiveInteger } from "@/lib/api-validation";

interface Params {
  params: Promise<{ id: string }>;
}

// Readable by the guest: the path holds lane names and dates, never notes.
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  try {
    await requireSession();
    return NextResponse.json(await getApplicationTimeline(positiveInteger(id, "id")));
  } catch (error) {
    return errorResponse(error, "Failed to load the application's history");
  }
}
