import { NextRequest, NextResponse } from "next/server";
import { safeVerifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { CSP_HEADER, NONCE_HEADER, contentSecurityPolicy } from "@/lib/csp";

// Lets the request through. Pages get a fresh nonce and the policy that names
// it, on the request (so Next can put the nonce on its scripts) and on the
// response (so the browser applies it). API responses are not documents and
// need neither.
function pass(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, { development: process.env.NODE_ENV === "development" });
  const requestHeaders = new Headers(request.headers);
  // Next reads the nonce from the enforcing header name first, so that one
  // is always set here, replacing any the client sent.
  requestHeaders.set(CSP_HEADER, policy);
  requestHeaders.set(NONCE_HEADER, nonce);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_HEADER, policy);
  return response;
}

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
    return pass(request);
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

  return pass(request);
}

export const config = {
  // Everything except Next's static assets and the public app icon goes through
  // the session check. Each exclusion is exact: a bare prefix would also let
  // "/icon.svgx" or "/_next/staticfoo" through without a session. There is no
  // /_next/image route to exclude; the image optimizer is disabled.
  matcher: ["/((?!_next/static/|icon\\.svg$).*)"],
};
