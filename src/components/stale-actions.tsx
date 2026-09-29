"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useFeedback } from "@/components/feedback";
import { trackStaleAction } from "@/lib/analytics";

// The owner's three answers to a stale application. Followed up and snooze go
// through PATCH .../follow-up; close is the normal stage move, guarded by the
// lane the card was in when the page loaded. The page then reloads its data.
// Where focus goes after an action: the row it was in is gone once the list
// reloads, and the list's heading is always there.
export const STALE_LIST_HEADING_ID = "stale-applications-heading";

export function StaleActions({
  applicationId,
  company,
  stageId,
  closeStage
}: {
  applicationId: number;
  company: string;
  stageId: number;
  closeStage: { id: number; name: string } | null;
}) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [pending, setPending] = useState(false);

  function followUpRequest(action: "followed_up" | "snooze" | "clear") {
    return fetch(`/api/applications/${applicationId}/follow-up`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
  }

  function done() {
    router.refresh();
    document.getElementById(STALE_LIST_HEADING_ID)?.focus();
  }

  // Undoes a follow-up or a snooze from the toast.
  async function undo() {
    const response = await followUpRequest("clear").catch(() => null);
    if (response?.ok) {
      toast(`Undone for ${company}.`);
    } else {
      toast("Couldn't undo. Try again.", { tone: "error" });
    }
    router.refresh();
  }

  async function send(action: "followed_up" | "snooze" | "close") {
    setPending(true);
    try {
      const response =
        action === "close"
          ? await fetch(`/api/applications/${applicationId}/status`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stageId: closeStage?.id, expectedStageId: stageId })
            })
          : await followUpRequest(action);

      if (response.status === 409) {
        toast(`${company} was moved elsewhere in the meantime. The list has been refreshed.`);
      } else if (response.status === 404) {
        toast(`${company} no longer exists. The list has been refreshed.`);
      } else if (!response.ok) {
        toast("Couldn't update the application. Try again.", { tone: "error" });
        return;
      } else {
        trackStaleAction({ action });
        if (action === "close") {
          toast(`${company} moved to ${closeStage?.name}.`);
        } else {
          toast(
            action === "followed_up"
              ? `Follow-up recorded for ${company}; its stale clock restarts.`
              : `${company} is snoozed for 7 days.`,
            { action: { label: "Undo", onClick: () => void undo() } }
          );
        }
      }
      done();
    } catch {
      toast("Couldn't update the application. Try again.", { tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={pending}
        aria-label={`Followed up with ${company}`}
        onClick={() => void send("followed_up")}
      >
        Followed up
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={pending}
        aria-label={`Snooze ${company} for 7 days`}
        onClick={() => void send("snooze")}
      >
        Snooze 7 days
      </Button>
      {closeStage !== null ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={pending}
          aria-label={`Close ${company}: move it to ${closeStage.name}`}
          onClick={() => void send("close")}
        >
          Close
        </Button>
      ) : null}
    </div>
  );
}
