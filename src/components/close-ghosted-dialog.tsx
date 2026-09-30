"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFeedback } from "@/components/feedback";
import { trackGhostedClosed } from "@/lib/analytics";
import type { StatsPayload } from "@/lib/types";

// Owner decision 13: "no reply after 21 days" unless the owner changes it.
const DEFAULT_DAYS = 21;
// The candidates start at the stale threshold, so N cannot go below it.
const MIN_DAYS = 14;
// Moves are sent one by one; a run stops at this many.
const MAX_PER_RUN = 50;

type Candidate = StatsPayload["ghostCandidates"][number];

// Closes applications that never got a reply, after one confirmation. Each
// card goes through the normal stage move with the lane it was in when the
// page loaded, so a card moved in the meantime is skipped (409) rather than
// overwritten, and its history gets one edge into the closed lane.
export function CloseGhostedDialog({
  candidates,
  closeStage,
  medianReplyDays
}: {
  candidates: Candidate[];
  closeStage: { id: number; name: string };
  // The all-time median days to a first reply, when there are enough replies.
  medianReplyDays: number | null;
}) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  // The field keeps what is typed ("3" on the way to "30"). Until it holds a
  // whole number of at least MIN_DAYS nothing is listed and nothing can be
  // closed, so the number on screen is always the one in effect.
  const [daysText, setDaysText] = useState(String(DEFAULT_DAYS));
  const days = /^\d+$/.test(daysText.trim()) && Number(daysText) >= MIN_DAYS ? Number(daysText) : null;
  const [unticked, setUnticked] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);

  const shown = days === null ? [] : candidates.filter((candidate) => candidate.daysSinceApplied >= days);
  const ticked = shown.filter((candidate) => !unticked.has(candidate.id));
  const toMove = ticked.slice(0, MAX_PER_RUN);

  function toggle(id: number) {
    setUnticked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function closeAll() {
    if (days === null) return;
    let moved = 0;
    // A 409 or 404 means the card was moved or deleted meanwhile, which is
    // expected; anything else is a failure. After a lost session or network
    // the run stops rather than sending the rest.
    const skipped: string[] = [];
    const failed: string[] = [];
    let stopped = false;
    for (const [index, candidate] of toMove.entries()) {
      setProgress(`Closing ${index + 1} of ${toMove.length}…`);
      let status: number | null = null;
      try {
        const response = await fetch(`/api/applications/${candidate.id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stageId: closeStage.id, expectedStageId: candidate.stageId })
        });
        status = response.status;
      } catch {
        status = null;
      }
      if (status !== null && status >= 200 && status < 300) {
        moved++;
      } else if (status === 409 || status === 404) {
        skipped.push(candidate.company);
      } else {
        failed.push(candidate.company);
        if (status === null || status === 401) {
          stopped = true;
          break;
        }
      }
    }
    setProgress(null);
    setOpen(false);
    setUnticked(new Set());
    if (moved > 0) trackGhostedClosed({ count: moved, days });
    const parts = [`${moved} application${moved === 1 ? "" : "s"} moved to ${closeStage.name}.`];
    if (skipped.length > 0) parts.push(`Skipped, moved or deleted elsewhere: ${skipped.join(", ")}.`);
    if (failed.length > 0) parts.push(`Could not be moved, try again: ${failed.join(", ")}.`);
    if (stopped) parts.push("The run stopped early: the connection or the session was lost.");
    toast(parts.join(" "), failed.length > 0 ? { tone: "error" } : undefined);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => progress === null && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Close ghosted applications…
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col">
        <DialogHeader>
          <DialogTitle>Close ghosted applications</DialogTitle>
          <DialogDescription>
            Move applications that never got a reply to {closeStage.name}. Each one keeps its history and gains one
            step into that lane.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-6 space-y-4 overflow-y-auto px-6">
          <div className="space-y-1">
            <Label htmlFor="ghosted-days">No reply after this many days</Label>
            <Input
              id="ghosted-days"
              type="number"
              min={MIN_DAYS}
              value={daysText}
              onChange={(event) => setDaysText(event.target.value)}
              className="w-28"
            />
            {days === null ? (
              <p className="text-xs text-destructive" role="alert">
                Enter a whole number of {MIN_DAYS} days or more.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {medianReplyDays !== null
                ? `Your median time to a first reply is ${medianReplyDays} days.`
                : "There are not enough replies yet for a median time to a reply."}
            </p>
          </div>
          {days === null ? null : shown.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No application has waited {days} days or more without a reply.</p>
          ) : (
            <ul className="space-y-1">
              {shown.map((candidate) => (
                <li key={candidate.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-accent/40">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-sky-500"
                      checked={!unticked.has(candidate.id)}
                      onChange={() => toggle(candidate.id)}
                      aria-label={`Close ${candidate.company}, ${candidate.role}`}
                      disabled={progress !== null}
                    />
                    <span className="flex-1 text-sm">
                      <span className="font-medium">{candidate.company}</span>
                      <span className="text-muted-foreground"> · {candidate.role}</span>
                      <span className="block text-xs text-muted-foreground">
                        {candidate.stageName} · sent {candidate.daysSinceApplied} days ago
                        {candidate.followedUpAt ? " · followed up" : ""}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {ticked.length > MAX_PER_RUN ? (
            <p className="text-xs text-muted-foreground">
              {ticked.length} are ticked; this run closes the first {MAX_PER_RUN}. Run it again for the rest.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <p className="mr-auto self-center text-xs text-muted-foreground" aria-live="polite">
            {progress ?? ""}
          </p>
          <Button onClick={() => void closeAll()} disabled={toMove.length === 0 || progress !== null}>
            {toMove.length === 0
              ? "Nothing to close"
              : `Close ${toMove.length} application${toMove.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
