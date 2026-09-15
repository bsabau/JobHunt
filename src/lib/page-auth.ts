import { redirect } from "next/navigation";
import { isApiError } from "@/lib/api-errors";
import { requireSession, type Session } from "@/lib/auth";

// Page-side counterpart to requireSession(): an unauthenticated visitor is sent
// to /login instead of getting a thrown 401 rendered as a server error.
export async function requirePageSession(options: { write?: boolean } = {}): Promise<Session> {
  try {
    return await requireSession(options);
  } catch (error) {
    if (isApiError(error)) {
      redirect("/login");
    }

    throw error;
  }
}
