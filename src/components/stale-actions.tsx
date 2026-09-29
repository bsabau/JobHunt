"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useFeedback } from "@/components/feedback";
import { trackStaleAction } from "@/lib/analytics";

// The owner's three answers to a stale application. Followed up and snooze go
// through PATCH .../follow-up; close is the normal stage move, guarded by the
// lane the card was in when the page loaded. The page then reloads its data.
export function StaleActions({
  applicationId,
  company,
  stageId,
  closeStageId
}: {
  applicationId: number;
  company: string;
  stageId: number;
  closeStageId: number | null;
}) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [pending, setPending] = useState(false);

  async function send(action: "followed_up" | "snooze" | "close") {
    setPending(true);
    try {
      const response =
        action === "close"
          ? await fetch(`/api/applications/${applicationId}/status`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stageId: closeStageId, expectedStageId: stageId })
            })
          : await fetch(`/api/applications/${applicationId}/follow-up`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action })
            });

      if (response.status === 409) {
        toast(`${company} was moved elsewhere in the meantime. The list has been refreshed.`);
      } else if (!response.ok) {
        toast("Couldn't update the application. Try again.", { tone: "error" });
        return;
      } else {
        trackStaleAction({ action });
        toast(
          action === "followed_up"
            ? `Follow-up recorded for ${company}; its stale clock restarts.`
            : action === "snooze"
              ? `${company} is snoozed for 7 days.`
              : `${company} moved to the closed lane.`
        );
      }
      router.refresh();
    } catch {
      toast("Couldn't update the application. Try again.", { tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={pending} onClick={() => void send("followed_up")}>
        Followed up
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={pending} onClick={() => void send("snooze")}>
        Snooze 7 days
      </Button>
      {closeStageId !== null ? (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={pending} onClick={() => void send("close")}>
          Close
        </Button>
      ) : null}
    </div>
  );
}
