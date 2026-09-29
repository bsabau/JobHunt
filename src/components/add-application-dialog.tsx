"use client";

import { FormEvent, useState } from "react";
import { Application, Stage } from "@/lib/types";
import { DEFAULT_CREATE_KIND } from "@/lib/stage-kinds";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trackApplicationCreated } from "@/lib/analytics";
import { TEXT_LIMITS } from "@/lib/limits";
import { applicationsForCompany, duplicateCompanyWarning } from "@/lib/utils";
import { useFeedback } from "@/components/feedback";

interface AddApplicationDialogProps {
  stages: Stage[];
  applications: Application[];
  onCreated: (application: Application) => void;
}

function getDefaultStageId(stages: Stage[]): number {
  const active = stages.find((stage) => stage.kind === DEFAULT_CREATE_KIND);
  return active?.id ?? stages[0]?.id ?? 0;
}

export function AddApplicationDialog({ stages, applications, onCreated }: AddApplicationDialogProps) {
  const { confirm, toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const defaultStageId = getDefaultStageId(stages);
  const [form, setForm] = useState({
    company: "",
    role: "",
    sourceUrl: "",
    notes: "",
    interviewDate: "",
    stageId: defaultStageId
  });
  const selectedStageId = stages.some((stage) => stage.id === form.stageId) ? form.stageId : defaultStageId;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const warning = duplicateCompanyWarning(form.company, applicationsForCompany(form.company, applications));
    if (warning && !(await confirm({ title: "Add another application?", description: warning, confirmLabel: "Add anyway" }))) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, stageId: selectedStageId })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message || "Failed to create application");
      }

      const created = (await response.json()) as Application;
      onCreated(created);
      trackApplicationCreated({
        stageKind: created.stageKind,
        hasSourceUrl: Boolean(form.sourceUrl.trim()),
        hasInterviewDate: Boolean(form.interviewDate),
        hasNotes: Boolean(form.notes.trim())
      });
      setOpen(false);
      setForm({ company: "", role: "", sourceUrl: "", notes: "", interviewDate: "", stageId: defaultStageId });
    } catch (error) {
      console.error(error);
      toast(error instanceof Error ? error.message : "Could not add application.", { tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add Application</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a new application</DialogTitle>
          <DialogDescription>
            We will search a matching company logo online and attach it to the card automatically.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="company">Company</Label>
            <Input
              id="company"
              value={form.company}
              onChange={(e) => setForm((current) => ({ ...current, company: e.target.value }))}
              maxLength={TEXT_LIMITS.company}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Input
              id="role"
              value={form.role}
              onChange={(e) => setForm((current) => ({ ...current, role: e.target.value }))}
              maxLength={TEXT_LIMITS.role}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sourceUrl">Job link</Label>
            <Input
              id="sourceUrl"
              type="url"
              placeholder="https://..."
              value={form.sourceUrl}
              onChange={(e) => setForm((current) => ({ ...current, sourceUrl: e.target.value }))}
              maxLength={TEXT_LIMITS.url}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="interviewDate">Interview date</Label>
            <Input
              id="interviewDate"
              type="date"
              value={form.interviewDate}
              onChange={(e) => setForm((current) => ({ ...current, interviewDate: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Initial stage</Label>
            <Select
              value={String(selectedStageId)}
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
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
              maxLength={TEXT_LIMITS.notes}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading || stages.length === 0}>
              {loading ? "Saving..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
