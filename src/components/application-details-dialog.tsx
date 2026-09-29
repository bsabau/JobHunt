"use client";

import { ApplicationTimeline } from "@/components/application-timeline";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateOnly, formatDay } from "@/lib/timezone";
import type { Application } from "@/lib/types";

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
      {/* Only the body scrolls, so the header and the close button stay in view. */}
      <DialogContent className="flex max-h-[90vh] flex-col" onCloseAutoFocus={onCloseAutoFocus}>
        {application ? (
          <>
            <DialogHeader>
              <DialogTitle>{application.company}</DialogTitle>
              <DialogDescription>{application.role}</DialogDescription>
            </DialogHeader>
            <div className="-mx-6 space-y-4 overflow-y-auto px-6">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Lane</dt>
                <dd>{application.stageName}</dd>
                <dt className="text-muted-foreground">{application.appliedAt ? "Applied" : "Added"}</dt>
                <dd>{formatDay(application.appliedAt ?? application.createdAt, timeZone)}</dd>
                {application.interviewDate ? (
                  <>
                    <dt className="text-muted-foreground">Interview</dt>
                    <dd>{formatDateOnly(application.interviewDate)}</dd>
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
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
