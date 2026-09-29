"use client";

import { useEffect, useState } from "react";
import { colorFor, isTerminalKind } from "@/lib/stage-kinds";
import { daysSince, formatDay } from "@/lib/timezone";
import type { TimelineLane, TimelinePayload } from "@/lib/types";

type State = { status: "loading" } | { status: "error" } | { status: "ready"; lanes: TimelineLane[] };

function formatDays(days: number) {
  return days < 1 ? "under a day" : days === 1 ? "1 day" : `${days} days`;
}

// How long the card sat in a lane: until it entered the next one, or until
// `now` for the lane it is in. `now` is the page's clock, as everywhere on the
// board, so the server render and hydration agree. Whole days, rounded down per
// lane, so the lanes need not add up to the card's age.
function timeInLane(lanes: TimelineLane[], index: number, now: number) {
  const next = lanes[index + 1];
  return daysSince(lanes[index].enteredAt, next ? Date.parse(next.enteredAt) : now);
}

// Loads when mounted. The parent keys it by the card's lane and last update, so
// a moved or edited card mounts a fresh one instead of showing an old path.
export function ApplicationTimeline({
  applicationId,
  timeZone,
  now
}: {
  applicationId: number;
  timeZone: string;
  now: number;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/applications/${applicationId}/timeline`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<TimelinePayload>;
      })
      .then((payload) => {
        if (!cancelled) setState({ status: "ready", lanes: payload.lanes });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  return (
    <section aria-labelledby={`timeline-${applicationId}`} className="space-y-2">
      <div>
        <h3 id={`timeline-${applicationId}`} className="text-sm font-medium">
          History
        </h3>
        <p className="text-xs text-muted-foreground">Where it stands now: moving a card back rewrites its path.</p>
      </div>
      {state.status === "loading" ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Loading history…
        </p>
      ) : state.status === "error" ? (
        <p className="text-xs text-destructive" role="alert">
          Couldn&apos;t load the history. Close and reopen to try again.
        </p>
      ) : (
        <ol className="space-y-2 border-l border-border/60 pl-4">
          {state.lanes.map((lane, index) => {
            const current = index === state.lanes.length - 1;
            const days = timeInLane(state.lanes, index, now);
            return (
              <li key={`${index}-${lane.enteredAt}`} className="relative text-sm">
                <span
                  aria-hidden="true"
                  className="absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full border border-background"
                  style={{ backgroundColor: colorFor(lane.stageName, lane.stageKind ?? undefined, index) }}
                />
                <span className="font-medium">{lane.stageName}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {formatDay(lane.enteredAt, timeZone)} ·{" "}
                  {current
                    ? isTerminalKind(lane.stageKind ?? undefined)
                      ? `${formatDays(days)} ago`
                      : `${formatDays(days)} so far`
                    : formatDays(days)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
