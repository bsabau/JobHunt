"use client";

import { ApplicationTimeline } from "@/components/application-timeline";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Application } from "@/lib/types";

function formatDay(isoDate: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }).format(
    new Date(isoDate)
  );
}

// The guest's view of a card: read-only, and built from the Application the
// guest already has, whose notes are always null. There is deliberately no
// notes field, so nothing here can show them.
export function ApplicationDetailsDialog({
  application,
  open,
  onOpenChange,
  timeZone,
  now,
  onCloseAutoFocus
}: {
  application: Application | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeZone: string;
  now: number;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto" onCloseAutoFocus={onCloseAutoFocus}>
        {application ? (
          <>
            <DialogHeader>
              <DialogTitle>{application.company}</DialogTitle>
              <DialogDescription>{application.role}</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Lane</dt>
              <dd>{application.stageName}</dd>
              <dt className="text-muted-foreground">{application.appliedAt ? "Applied" : "Added"}</dt>
              <dd>{formatDay(application.appliedAt ?? application.createdAt, timeZone)}</dd>
              {application.interviewDate ? (
                <>
                  <dt className="text-muted-foreground">Interview</dt>
                  {/* A DATE, shown as stored: parsing it would shift it by the zone. */}
                  <dd>{application.interviewDate}</dd>
                </>
              ) : null}
              {application.sourceUrl ? (
                <>
                  <dt className="text-muted-foreground">Job link</dt>
                  <dd className="truncate">
                    <a href={application.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline">
                      {application.sourceUrl}
                    </a>
                  </dd>
                </>
              ) : null}
            </dl>
            <ApplicationTimeline
              key={`${application.id}-${application.stageId}-${application.updatedAt}`}
              applicationId={application.id}
              timeZone={timeZone}
              now={now}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
