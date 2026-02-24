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
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface AddApplicationDialogProps {
  stages: Stage[];
  onCreated: (application: Application) => void;
}

export function AddApplicationDialog({ stages, onCreated }: AddApplicationDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    company: "",
    role: "",
    sourceUrl: "",
    notes: "",
    stageId: stages[0]?.id ?? 0
  });

  useEffect(() => {
    if (!stages.find((stage) => stage.id === form.stageId)) {
      setForm((current) => ({ ...current, stageId: stages[0]?.id ?? 0 }));
    }
  }, [stages, form.stageId]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message || "Failed to create application");
      }

      const created = (await response.json()) as Application;
      onCreated(created);
      setOpen(false);
      setForm({ company: "", role: "", sourceUrl: "", notes: "", stageId: stages[0]?.id ?? 0 });
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Could not add application.");
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
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Input
              id="role"
              value={form.role}
              onChange={(e) => setForm((current) => ({ ...current, role: e.target.value }))}
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
            />
          </div>
          <div className="space-y-2">
            <Label>Initial stage</Label>
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
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
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
