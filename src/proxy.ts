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

  // Allow login page and login/logout APIs without auth (logout must work with an expired session)
  if (
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/api/auth/login" ||
    request.nextUrl.pathname === "/api/auth/logout"
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

  // Block mutating API requests for guest users.
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
  // Everything except Next's static assets and the public app icon goes through
  // the session check. Each exclusion is exact: a bare prefix would also let
  // "/icon.svgx" or "/_next/staticfoo" through without a session. There is no
  // /_next/image route to exclude; the image optimizer is disabled.
  matcher: ["/((?!_next/static/|icon\\.svg$).*)"],
};
