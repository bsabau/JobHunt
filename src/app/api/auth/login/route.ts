import { NextRequest, NextResponse } from "next/server";
import { readJsonObject, requiredString, isApiValidationError, validationErrorResponse } from "@/lib/api-validation";
import {
  validateCredentials,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  isAuthConfigurationError
} from "@/lib/auth";

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 5;
const MAX_TRACKED_IPS = 5_000;

// Best-effort, per-instance brute-force throttle. It resets on cold start and
// does not coordinate across regions/instances; a platform-level rate limit
// (e.g. Vercel Firewall) is the durable fix. `x-forwarded-for` is only a
// trustworthy key where the platform sets it (Vercel does); on other hosts the
// header is client-controlled and the counter is trivially bypassed, so it
// must never be the only control.
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();

  return "unknown";
}

function pruneExpiredAttempts(now: number) {
  if (loginAttempts.size < MAX_TRACKED_IPS) {
    return;
  }

  for (const [ip, record] of loginAttempts) {
    if (now >= record.resetAt) {
      loginAttempts.delete(ip);
    }
  }
}

function recordFailedAttempt(ip: string, now: number) {
  pruneExpiredAttempts(now);

  const record = loginAttempts.get(ip);
  if (!record || now >= record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }

  record.count += 1;
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const now = Date.now();
  const attempt = loginAttempts.get(ip);

  if (attempt && now < attempt.resetAt && attempt.count >= LOGIN_MAX_ATTEMPTS) {
    const retryAfter = Math.max(1, Math.ceil((attempt.resetAt - now) / 1000));
    return NextResponse.json(
      { message: "Too many login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  try {
    const body = await readJsonObject(request);
    const user = requiredString(body, "user");
    const pass = requiredString(body, "pass");

    const role = await validateCredentials(user, pass);
    if (!role) {
      recordFailedAttempt(ip, Date.now());
      return NextResponse.json({ message: "Invalid credentials" }, { status: 401 });
    }

    loginAttempts.delete(ip);

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
  } catch (error) {
    if (isApiValidationError(error)) {
      return validationErrorResponse(error);
    }

    if (isAuthConfigurationError(error)) {
      // Log the configuration problem server-side but do not reveal it to the
      // caller: an unauthenticated probe should not be able to tell a
      // misconfigured deployment from bad credentials.
      console.error("Login failed due to auth configuration:", error.message);
      return NextResponse.json({ message: "Invalid credentials" }, { status: 401 });
    }

    return NextResponse.json({ message: "Login failed" }, { status: 500 });
  }
}
