import { NextRequest, NextResponse } from "next/server";
import { validateCredentials, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { user, pass } = await request.json();

  const role = validateCredentials(user, pass);
  if (!role) {
    return NextResponse.json({ message: "Invalid credentials" }, { status: 401 });
  }

  const token = await createSessionToken(role);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return response;
}
