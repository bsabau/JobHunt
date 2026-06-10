import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  // Allow login page and login API without auth
  if (
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/api/auth/login"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session?.valid) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Block mutating API requests for guest users
  if (
    session.role === "guest" &&
    request.nextUrl.pathname.startsWith("/api/") &&
    request.method !== "GET"
  ) {
    return NextResponse.json({ message: "Guest access is read-only" }, { status: 403 });
  }

  // Pass role via request header so server components can read it
  const response = NextResponse.next();
  response.headers.set("x-user-role", session.role);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
