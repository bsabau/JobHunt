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

interface EditApplicationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: Application | null;
  stages: Stage[];
  onUpdated: (application: Application) => void;
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
  stages: Stage[];
  onOpenChange: (open: boolean) => void;
  onUpdated: (application: Application) => void;
}

function EditApplicationForm({ application, stages, onOpenChange, onUpdated }: EditApplicationFormProps) {
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

    setLoading(true);
    try {
      const response = await fetch(`/api/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message || "Failed to update application");
      }

      const updated = (await response.json()) as Application;
      onUpdated(updated);
      trackApplicationUpdated({
        stageChanged: form.stageId !== application.stageId,
        stageName: stages.find((stage) => stage.id === form.stageId)?.name ?? "unknown",
        hasInterviewDate: Boolean(form.interviewDate)
      });
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Could not update application.");
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
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-role">Role</Label>
        <Input
          id="edit-role"
          value={form.role}
          onChange={(e) => setForm((current) => ({ ...current, role: e.target.value }))}
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

export function EditApplicationDialog({ open, onOpenChange, application, stages, onUpdated }: EditApplicationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit application</DialogTitle>
          <DialogDescription>Update details and interview planning for this application.</DialogDescription>
        </DialogHeader>
        {application ? (
          <EditApplicationForm
            key={application.id}
            application={application}
            stages={stages}
            onOpenChange={onOpenChange}
            onUpdated={onUpdated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
