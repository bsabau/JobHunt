import { NextResponse } from "next/server";
import { getSankeyData } from "@/lib/db";

export async function GET() {
  return NextResponse.json(await getSankeyData());
}
