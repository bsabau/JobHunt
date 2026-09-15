import { headers, cookies } from "next/headers";
import { DEFAULT_TIME_ZONE, normalizeTimeZone, TIME_ZONE_COOKIE } from "@/lib/timezone";

// Resolve the viewer's timezone from the platform geo header (Vercel) or the
// `tz` cookie the client writes, defaulting to UTC. Server-only: this module
// imports next/headers, so keep it out of client components.
export async function resolveRequestTimeZone(): Promise<string> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  return normalizeTimeZone(
    cookieStore.get(TIME_ZONE_COOKIE)?.value ??
      headerStore.get("x-vercel-ip-timezone") ??
      DEFAULT_TIME_ZONE
  );
}
