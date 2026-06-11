"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Plus, Trash2 } from "lucide-react";
import { STAGE_TONES, daysSince, daysUntil, isApplicationStale } from "@/lib/constants";
import { Application, Stage } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AddApplicationDialog } from "@/components/add-application-dialog";
import { EditApplicationDialog } from "@/components/edit-application-dialog";
import {
  trackApplicationDeleted,
  trackApplicationMoved,
  trackStageAdded,
  trackStageDeleted,
  trackStageReordered
} from "@/lib/analytics";

interface KanbanBoardProps {
  initialApplications: Application[];
  initialStages: Stage[];
  readOnly?: boolean;
}

type DragItem =
  | { type: "application"; id: number }
  | { type: "stage"; id: number }
  | null;

function toneFor(index: number) {
  return STAGE_TONES[index % STAGE_TONES.length];
}

function CompanyLogo({ company, logoUrl, logoBgClass }: { company: string; logoUrl: string | null; logoBgClass: string }) {
  const [failed, setFailed] = useState(false);

  if (!logoUrl || failed) {
    return (
      <div
        className={`h-10 w-10 rounded-md border border-border/60 ${logoBgClass} flex items-center justify-center text-[11px] text-muted-foreground`}
        aria-hidden="true"
      >
        {company.slice(0, 1).toUpperCase()}
      </div>
    );
  }

  return (
    <div className={`h-10 w-10 rounded-md border border-border/60 ${logoBgClass} p-1`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Logo URLs are dynamic third-party favicon endpoints. */}
      <img
        src={logoUrl}
        alt={`${company} logo`}
        width={32}
        height={32}
        loading="lazy"
        className="h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export function KanbanBoard({ initialApplications, initialStages, readOnly = false }: KanbanBoardProps) {
  const [applications, setApplications] = useState<Application[]>(initialApplications);
  const [stages, setStages] = useState<Stage[]>(initialStages);
  const [editingApplication, setEditingApplication] = useState<Application | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [draggedItem, setDraggedItem] = useState<DragItem>(null);
  const [stageDropTargetId, setStageDropTargetId] = useState<number | null>(null);
  const [binHover, setBinHover] = useState(false);

  const grouped = useMemo(() => {
    return stages.reduce(
      (acc, stage) => {
        acc[stage.id] = applications.filter((item) => item.stageId === stage.id);
        return acc;
      },
      {} as Record<number, Application[]>
    );
  }, [applications, stages]);

  async function moveCard(id: number, stageId: number) {
    const app = applications.find((item) => item.id === id);
    const fromStage = app ? stages.find((stage) => stage.id === app.stageId) : undefined;
    const toStage = stages.find((stage) => stage.id === stageId);

    const response = await fetch(`/api/applications/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId })
    });

    if (!response.ok) {
      alert("Failed to move application.");
      return;
    }

    const updated = (await response.json()) as Application;
    setApplications((current) => current.map((item) => (item.id === id ? updated : item)));

    if (fromStage && toStage && fromStage.id !== toStage.id) {
      trackApplicationMoved({ fromStageName: fromStage.name, toStageName: toStage.name });
    }
  }

  async function deleteApplicationById(id: number) {
    const response = await fetch(`/api/applications/${id}`, { method: "DELETE" });

    if (!response.ok) {
      alert("Failed to delete application.");
      return;
    }

    setApplications((current) => current.filter((item) => item.id !== id));
    trackApplicationDeleted();
  }

  async function addStage() {
    const name = window.prompt("Stage name", "Interview Round 2");
    if (!name) {
      return;
    }

    const response = await fetch("/api/stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });

    const body = (await response.json().catch(() => null)) as { message?: string } | Stage | null;

    if (!response.ok) {
      alert((body as { message?: string } | null)?.message || "Failed to add stage");
      return;
    }

    const stage = body as Stage;
    setStages((current) => [...current, stage]);
    trackStageAdded({ stageName: stage.name });
  }

  async function deleteStageById(id: number) {
    const response = await fetch(`/api/stages/${id}`, { method: "DELETE" });
    const body = (await response.json().catch(() => null)) as { message?: string } | null;

    if (!response.ok) {
      alert(body?.message || "Cannot delete stage.");
      return;
    }

    setStages((current) => current.filter((stage) => stage.id !== id));
    trackStageDeleted();
  }

  async function reorderStage(draggedStageId: number, targetStageId: number) {
    if (draggedStageId === targetStageId) {
      return;
    }

    const current = [...stages];
    const draggedStage = current.find((stage) => stage.id === draggedStageId);
    const targetIndex = current.findIndex((stage) => stage.id === targetStageId);

    if (!draggedStage || targetIndex === -1) {
      return;
    }

    const withoutDragged = current.filter((stage) => stage.id !== draggedStageId);
    const insertIndex = withoutDragged.findIndex((stage) => stage.id === targetStageId);
    withoutDragged.splice(insertIndex, 0, draggedStage);

    const reordered = withoutDragged.map((stage, index) => ({ ...stage, sortOrder: index }));
    setStages(reordered);

    const response = await fetch("/api/stages/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageIds: reordered.map((stage) => stage.id) })
    });

    if (!response.ok) {
      setStages(current);
      alert("Failed to reorder stages.");
      return;
    }

    trackStageReordered();
  }

  async function onDropToStage(targetStageId: number) {
    if (!draggedItem) {
      return;
    }

    if (draggedItem.type === "application") {
      await moveCard(draggedItem.id, targetStageId);
    }

    if (draggedItem.type === "stage") {
      await reorderStage(draggedItem.id, targetStageId);
    }

    setDraggedItem(null);
    setStageDropTargetId(null);
  }

  function onStageHeaderDragStart(stageId: number) {
    setDraggedItem({ type: "stage", id: stageId });
    setStageDropTargetId(null);
  }

  function onAnyDragEnd() {
    setDraggedItem(null);
    setStageDropTargetId(null);
    setBinHover(false);
  }

  function formatInterviewDate(date: string) {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (dateOnly) {
      const [, year, month, day] = dateOnly;
      return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(
        new Date(Number(year), Number(month) - 1, Number(day))
      );
    }

    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(date));
  }

  function formatInterviewLabel(date: string) {
    const formatted = formatInterviewDate(date);
    const until = daysUntil(date);
    if (until === 0) {
      return `${formatted} · Today`;
    }
    if (until === 1) {
      return `${formatted} · Tomorrow`;
    }
    if (until > 1) {
      return `${formatted} · In ${until} days`;
    }
    return formatted;
  }

  async function onDropToBin() {
    if (!draggedItem) {
      return;
    }

    if (draggedItem.type === "application") {
      await deleteApplicationById(draggedItem.id);
    }

    if (draggedItem.type === "stage") {
      await deleteStageById(draggedItem.id);
    }

    setDraggedItem(null);
    setStageDropTargetId(null);
    setBinHover(false);
  }

  return (
    <section className="space-y-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Applications Board</h2>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void addStage()}>
              <Plus className="mr-1 h-4 w-4" />
              Add Stage
            </Button>
            <AddApplicationDialog
              stages={stages}
              onCreated={(app) => setApplications((current) => [app, ...current])}
            />
          </div>
        )}
      </div>

      <div className="overflow-x-auto overscroll-x-contain pb-3">
        <div
          className="inline-grid gap-4"
          style={{ gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(240px, 280px))` }}
        >
          {stages.map((stage, index) => {
            const tone = toneFor(index);
            return (
              <div
                key={stage.id}
                className={`rounded-xl border p-3 transition-all ${tone.column} ${
                  draggedItem?.type === "stage" && stageDropTargetId === stage.id
                    ? "ring-2 ring-sky-300/80 ring-offset-2 ring-offset-background"
                    : ""
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggedItem?.type === "stage") {
                    setStageDropTargetId(stage.id);
                  }
                }}
                onDragLeave={() => {
                  if (draggedItem?.type === "stage" && stageDropTargetId === stage.id) {
                    setStageDropTargetId(null);
                  }
                }}
                onDrop={() => void onDropToStage(stage.id)}
              >
                <div
                  className={`mb-3 flex items-center justify-between gap-2 rounded-md border border-dashed border-border/50 px-2 py-1 ${readOnly ? "" : "cursor-grab active:cursor-grabbing"}`}
                  draggable={!readOnly}
                  onDragStart={readOnly ? undefined : () => onStageHeaderDragStart(stage.id)}
                  onDragEnd={readOnly ? undefined : onAnyDragEnd}
                  title={readOnly ? undefined : "Drag to reorder stage"}
                >
                  <h3 className="truncate text-sm font-semibold tracking-wide text-muted-foreground">{stage.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground">
                      {grouped[stage.id]?.length ?? 0}
                    </span>
                    <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
                <div className="space-y-3">
                  {(grouped[stage.id] ?? []).map((app) => {
                    const stale = isApplicationStale(app);
                    const staleDays = stale ? daysSince(app.updatedAt) : 0;
                    return (
                    <Card
                      key={app.id}
                      draggable={!readOnly}
                      onDragStart={readOnly ? undefined : () => setDraggedItem({ type: "application", id: app.id })}
                      onDragEnd={readOnly ? undefined : onAnyDragEnd}
                      onDoubleClick={readOnly ? undefined : () => {
                        setEditingApplication(app);
                        setEditOpen(true);
                      }}
                      title={app.notes && !readOnly ? "Double-click to view notes" : undefined}
                      className={`${readOnly ? "cursor-default" : "cursor-move"} border-border/70 bg-card/80 backdrop-blur ${
                        stale ? "border-l-4 border-l-amber-400/80" : ""
                      }`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <CardTitle className="text-base">{app.company}</CardTitle>
                          {stale ? (
                            <span className="shrink-0 rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                              Stale · {staleDays}d
                            </span>
                          ) : null}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center gap-3">
                          <CompanyLogo company={app.company} logoUrl={app.logoUrl} logoBgClass={tone.logoBg} />
                          <p className="text-sm text-muted-foreground">{app.role}</p>
                        </div>
                        {app.sourceUrl ? (
                          <a
                            className="text-xs font-medium text-sky-400 hover:text-sky-300"
                            href={app.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Job post
                          </a>
                        ) : null}
                        {app.interviewDate ? (
                          <div className="rounded-md border border-border/60 bg-background/70 p-2">
                            <p className="text-xs text-amber-300">Interview: {formatInterviewLabel(app.interviewDate)}</p>
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                    );
                  })}
                  {(grouped[stage.id] ?? []).length === 0 ? (
                    <div className="rounded-md border border-dashed border-border/70 p-3 text-center text-xs text-muted-foreground">
                      Drop applications or stages here
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!readOnly && (
        <>
          <div className="fixed bottom-4 left-4 z-40">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-xl border-2 border-dashed transition-colors ${
                binHover ? "border-rose-300 bg-rose-500/20 text-rose-200" : "border-border/70 bg-card/70 text-muted-foreground"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setBinHover(true);
              }}
              onDragLeave={() => setBinHover(false)}
              onDrop={() => void onDropToBin()}
              title="Drag application or stage here to delete"
            >
              <Trash2 className="h-7 w-7" />
            </div>
          </div>
          <EditApplicationDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            application={editingApplication}
            stages={stages}
            onUpdated={(updated) => {
              setApplications((current) => current.map((item) => (item.id === updated.id ? updated : item)));
              setEditingApplication(updated);
            }}
          />
        </>
      )}
    </section>
  );
}
