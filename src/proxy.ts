import { NextRequest, NextResponse } from "next/server";
import { safeVerifySessionToken, SESSION_COOKIE } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if ((origin && origin !== request.nextUrl.origin) || (fetchSite && !["same-origin", "none"].includes(fetchSite))) {
      return NextResponse.json({ message: "Cross-site requests are not allowed" }, { status: 403 });
    }
  }

  // Allow login page and login API without auth
  if (
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/api/auth/login"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await safeVerifySessionToken(token) : null;

  if (!session?.valid) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      const response = NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      response.cookies.delete(SESSION_COOKIE);
      return response;
    }
    const loginUrl = new URL("/login", request.url);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  // Block mutating API requests for guest users
  if (
    session.role === "guest" &&
    request.nextUrl.pathname.startsWith("/api/") &&
    request.method !== "GET"
  ) {
    return NextResponse.json({ message: "Guest access is read-only" }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
