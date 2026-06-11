import { NextRequest, NextResponse } from "next/server";
import { readJsonObject, requiredString, isApiValidationError, validationErrorResponse } from "@/lib/api-validation";
import {
  validateCredentials,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  isAuthConfigurationError
} from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    const user = requiredString(body, "user");
    const pass = requiredString(body, "pass");

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
  } catch (error) {
    if (isApiValidationError(error)) {
      return validationErrorResponse(error);
    }

    if (isAuthConfigurationError(error)) {
      console.error(error.message);
      return NextResponse.json(
        { message: "Authentication is not configured. Check AUTH_USER, AUTH_PASS, and AUTH_SECRET in Vercel." },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: "Login failed" }, { status: 500 });
  }
}
