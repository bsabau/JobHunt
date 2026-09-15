"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TIME_ZONE_COOKIE } from "@/lib/timezone";

// The server cannot know the browser's timezone on the first request, so the
// client records it in a cookie. When it differs from what is already stored we
// refresh so the server components re-render with the right zone immediately.
export function TimezoneSync() {
  const router = useRouter();

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone) {
      return;
    }

    const match = document.cookie.match(new RegExp(`(?:^|; )${TIME_ZONE_COOKIE}=([^;]*)`));
    const current = match ? decodeURIComponent(match[1]) : null;
    if (current === timeZone) {
      return;
    }

    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(timeZone)}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.refresh();
  }, [router]);

  return null;
}
