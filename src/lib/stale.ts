// The stale rule, loadable straight from Node so tests/stale-clock.test.mjs can
// hold it to the SQL twin, staleApplicationsStatement() in stats-statements.ts.

import type { Application } from "@/lib/types";
import { STALE_EXCLUDED_KINDS, type StageKind } from "./stage-kinds.ts";
import { daysSince } from "./timezone.ts";

export const STALE_THRESHOLD_DAYS = 14;

// Staleness is a pipeline concept: pre-application (Wishlist) and resolved
// stages (Offer/Rejected/Closed) are not "going stale", whatever they are named.
export function isStaleEligibleStage(kind: StageKind): boolean {
  return !STALE_EXCLUDED_KINDS.includes(kind);
}

// A lane that can go stale, STALE_THRESHOLD_DAYS since the stale clock started
// (lane entry, or a later follow-up), and no snooze still running.
export function isApplicationStale(
  app: Pick<Application, "stageKind" | "staleClockAt" | "snoozedUntil">,
  now: number
): boolean {
  if (!isStaleEligibleStage(app.stageKind)) {
    return false;
  }
  if (app.snoozedUntil !== null && Date.parse(app.snoozedUntil) > now) {
    return false;
  }
  return daysSince(app.staleClockAt, now) >= STALE_THRESHOLD_DAYS;
}
