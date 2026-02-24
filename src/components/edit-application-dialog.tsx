"use client";

import { FormEvent, useEffect, useState } from "react";
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

interface EditApplicationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  application: Application | null;
  stages: Stage[];
  onUpdated: (application: Application) => void;
}

export function EditApplicationDialog({ open, onOpenChange, application, stages, onUpdated }: EditApplicationDialogProps) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    company: "",
    role: "",
    sourceUrl: "",
    notes: "",
    interviewDate: "",
    stageId: 0
  });

  useEffect(() => {
    if (!application) {
      return;
    }

    setForm({
      company: application.company,
      role: application.role,
      sourceUrl: application.sourceUrl ?? "",
      notes: application.notes ?? "",
      interviewDate: application.interviewDate ?? "",
      stageId: application.stageId
    });
  }, [application]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!application) {
      return;
    }

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
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Could not update application.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit application</DialogTitle>
          <DialogDescription>Update details and interview planning for this application.</DialogDescription>
        </DialogHeader>
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
            <Button type="submit" disabled={loading || !application}>
              {loading ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
