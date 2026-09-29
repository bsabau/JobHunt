"use client";

import { FormEvent, useState } from "react";
import { Stage, StageKind } from "@/lib/types";
import { KIND_COLORS, KIND_DESCRIPTIONS, KIND_LABELS } from "@/lib/stage-kinds";
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
import { TEXT_LIMITS } from "@/lib/limits";

// Pipeline kinds first, then outcomes, then the rarely used pre-application kind.
const KIND_OPTIONS: StageKind[] = ["active", "interview", "offer", "rejected", "closed", "intake"];

interface StageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // null adds a new lane; a stage edits that lane's name and type.
  stage: Stage | null;
  onSaved: (stage: Stage, mode: "add" | "edit") => void;
}

export function StageDialog({ open, onOpenChange, stage, onSaved }: StageDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* DialogContent unmounts while closed, so the form state starts fresh from `stage` on every open. */}
        <StageForm stage={stage} onSaved={onSaved} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function StageForm({
  stage,
  onSaved,
  onClose
}: {
  stage: Stage | null;
  onSaved: StageDialogProps["onSaved"];
  onClose: () => void;
}) {
  const [name, setName] = useState(stage?.name ?? "");
  const [kind, setKind] = useState<StageKind>(stage?.kind ?? "active");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    try {
      const response = stage
        ? await fetch(`/api/stages/${stage.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            // Only what changed, so an unchanged name never trips the unique check.
            body: JSON.stringify({ ...(name.trim() !== stage.name ? { name } : {}), kind })
          })
        : await fetch("/api/stages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, kind })
          });

      const body = (await response.json().catch(() => null)) as { message?: string } | Stage | null;

      if (!response.ok) {
        throw new Error((body as { message?: string } | null)?.message || "Failed to save stage");
      }

      onSaved(body as Stage, stage ? "edit" : "add");
      onClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to save stage");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{stage ? `Edit lane: ${stage.name}` : "Add a stage"}</DialogTitle>
        <DialogDescription>
          The type decides how the lane counts in stats. Rejected and closed lanes are outcomes: their cards never go
          stale and moving a card into them keeps its history, wherever the lane sits on the board.
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2">
          <Label htmlFor="stageName">Name</Label>
          <Input
            id="stageName"
            value={name}
            placeholder="Interview Round 2"
            onChange={(e) => setName(e.target.value)}
            maxLength={TEXT_LIMITS.stageName}
            required
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={kind} onValueChange={(value) => setKind(value as StageKind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((option) => (
                <SelectItem value={option} key={option}>
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLORS[option] }} />
                    {KIND_LABELS[option]}
                    <span className="text-xs text-muted-foreground">· {KIND_DESCRIPTIONS[option]}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="submit" disabled={loading || !name.trim()}>
            {loading ? "Saving..." : stage ? "Save" : "Add stage"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
