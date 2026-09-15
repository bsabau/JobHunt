import { NextResponse } from "next/server";
import { getSankeyData } from "@/lib/db";
import { errorResponse } from "@/lib/api-errors";
import { requireSession } from "@/lib/auth";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json(await getSankeyData());
  } catch (error) {
    return errorResponse(error, "Failed to load sankey data");
  }
}
