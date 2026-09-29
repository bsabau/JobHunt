"use client";

import { FormEvent, useState } from "react";
import { Application, Stage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trackApplicationUpdated } from "@/lib/analytics";
import { TEXT_LIMITS } from "@/lib/limits";
import { applicationsForCompany, duplicateCompanyWarning } from "@/lib/utils";
import { useFeedback } from "@/components/feedback";
import { ApplicationTimeline } from "@/components/application-timeline";

interface EditApplicationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: Application | null;
  applications: Application[];
  stages: Stage[];
  onUpdated: (application: Application) => void;
  timeZone: string;
  now: number;
  // Where focus goes on close; the dialog has no trigger element to return to.
  onCloseAutoFocus?: (event: Event) => void;
}

function normalizeDateForInput(value: string | null): string {
  if (!value) {
    return "";
  }

  // Prefer already-normalized date strings from API.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
}

interface EditApplicationFormProps {
  application: Application;
  applications: Application[];
  stages: Stage[];
  onOpenChange: (open: boolean) => void;
  onUpdated: (application: Application) => void;
}

function EditApplicationForm({ application, applications, stages, onOpenChange, onUpdated }: EditApplicationFormProps) {
  const { confirm, toast } = useFeedback();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    company: application.company,
    role: application.role,
    sourceUrl: application.sourceUrl ?? "",
    notes: application.notes ?? "",
    interviewDate: normalizeDateForInput(application.interviewDate),
    stageId: application.stageId
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const warning = duplicateCompanyWarning(form.company, applicationsForCompany(form.company, applications, application.id));
    if (warning && !(await confirm({ title: "Save with a duplicate company?", description: warning, confirmLabel: "Save anyway" }))) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/applications/${application.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, expectedStageId: application.stageId })
      });

      if (response.status === 409) {
        throw new Error("This application was moved elsewhere, please reload.");
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message || "Failed to update application");
      }

      const updated = (await response.json()) as Application;
      onUpdated(updated);
      trackApplicationUpdated({
        stageChanged: form.stageId !== application.stageId,
        stageKind: updated.stageKind,
        hasInterviewDate: Boolean(form.interviewDate)
      });
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast(error instanceof Error ? error.message : "Could not update application.", { tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="edit-company">Company</Label>
        <Input
          id="edit-company"
          value={form.company}
          onChange={(e) => setForm((current) => ({ ...current, company: e.target.value }))}
          maxLength={TEXT_LIMITS.company}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-role">Role</Label>
        <Input
          id="edit-role"
          value={form.role}
          onChange={(e) => setForm((current) => ({ ...current, role: e.target.value }))}
          maxLength={TEXT_LIMITS.role}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-source-url">Job link</Label>
        <Input
          id="edit-source-url"
          type="url"
          value={form.sourceUrl}
          onChange={(e) => setForm((current) => ({ ...current, sourceUrl: e.target.value }))}
          maxLength={TEXT_LIMITS.url}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-interview-date">Interview date</Label>
        <Input
          id="edit-interview-date"
          type="date"
          value={form.interviewDate}
          onChange={(e) => setForm((current) => ({ ...current, interviewDate: e.target.value }))}
        />
      </div>
      <div className="space-y-2">
        <Label>Stage</Label>
        <Select
          value={String(form.stageId)}
          onValueChange={(value) => setForm((current) => ({ ...current, stageId: Number(value) }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {stages.map((stage) => (
              <SelectItem value={String(stage.id)} key={stage.id}>
                {stage.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-notes">Notes</Label>
        <Textarea
          id="edit-notes"
          value={form.notes}
          onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
          maxLength={TEXT_LIMITS.notes}
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function EditApplicationDialog({
  open,
  onOpenChange,
  application,
  applications,
  stages,
  onUpdated,
  timeZone,
  now,
  onCloseAutoFocus
}: EditApplicationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Only the body scrolls, so the header and the close button stay in view. */}
      <DialogContent className="flex max-h-[90vh] flex-col" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Edit application</DialogTitle>
          <DialogDescription>Update details and interview planning for this application.</DialogDescription>
        </DialogHeader>
        {application ? (
          <div className="-mx-6 space-y-6 overflow-y-auto px-6">
            <EditApplicationForm
              key={application.id}
              application={application}
              applications={applications}
              stages={stages}
              onOpenChange={onOpenChange}
              onUpdated={onUpdated}
            />
            {/* Below the form: the owner opens this dialog to edit, and the
                form must not move when the history arrives. */}
            <div className="border-t border-border/60 pt-4">
              <ApplicationTimeline
                // A moved or edited card loads its path again.
                key={`${application.id}-${application.stageId}-${application.updatedAt}`}
                applicationId={application.id}
                timeZone={timeZone}
                now={now}
              />
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
