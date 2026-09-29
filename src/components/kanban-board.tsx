"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Plus, Settings2, Trash2 } from "lucide-react";
import { KIND_TONES, STAGE_TONES, daysSince, daysUntil, isApplicationStale } from "@/lib/constants";
import { KIND_LABELS, isTerminalKind } from "@/lib/stage-kinds";
import { Application, Stage } from "@/lib/types";
import { useMiddleButtonPan } from "@/lib/use-middle-button-pan";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AddApplicationDialog } from "@/components/add-application-dialog";
import { ApplicationSearch } from "@/components/application-search";
import { EditApplicationDialog } from "@/components/edit-application-dialog";
import { StageDialog } from "@/components/stage-dialog";
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
  timeZone: string;
}

type DragItem =
  | { type: "application"; id: number }
  | { type: "stage"; id: number }
  | null;

// Outcome lanes keep a fixed tint; pipeline lanes rotate by board position.
function toneFor(stage: Stage, index: number) {
  return KIND_TONES[stage.kind] ?? STAGE_TONES[index % STAGE_TONES.length];
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
        referrerPolicy="no-referrer"
        className="h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
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

// Rendered on the server and in the browser, so both the locale and the time
// zone are pinned to avoid a hydration mismatch.
function formatAppliedDate(isoDate: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(new Date(isoDate));
}

function formatAge(days: number) {
  return days <= 0 ? "today" : `${days}d ago`;
}

function formatInterviewLabel(date: string, timeZone: string) {
  const formatted = formatInterviewDate(date);
  const until = daysUntil(date, timeZone);
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

interface KanbanApplicationCardProps {
  app: Application;
  stale: boolean;
  staleDays: number;
  logoBgClass: string;
  readOnly: boolean;
  pending: boolean;
  highlighted: boolean;
  timeZone: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  onEdit: () => void;
}

function KanbanApplicationCard({
  app,
  stale,
  staleDays,
  logoBgClass,
  readOnly,
  pending,
  highlighted,
  timeZone,
  onDragStart,
  onDragEnd,
  onEdit
}: KanbanApplicationCardProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [notesVisible, setNotesVisible] = useState(false);
  const [notesPos, setNotesPos] = useState({ top: 0, left: 0 });
  const notes = app.notes?.trim();

  function showNotesTooltip() {
    if (!notes || !anchorRef.current) {
      return;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    setNotesPos({
      top: rect.top + rect.height / 2,
      left: rect.right + 10
    });
    setNotesVisible(true);
  }

  function hideNotesTooltip() {
    hideTimerRef.current = window.setTimeout(() => {
      setNotesVisible(false);
      hideTimerRef.current = null;
    }, 80);
  }

  return (
    <>
      <div
        ref={anchorRef}
        data-application-id={app.id}
        onMouseEnter={showNotesTooltip}
        onMouseLeave={hideNotesTooltip}
      >
        <Card
          draggable={!readOnly && !pending}
          onDragStart={readOnly || pending ? undefined : onDragStart}
          onDragEnd={readOnly || pending ? undefined : onDragEnd}
          onDoubleClick={readOnly ? undefined : onEdit}
          className={`${
            readOnly ? "cursor-default" : pending ? "cursor-wait opacity-60" : "cursor-move"
          } border-border/70 bg-card/80 backdrop-blur transition-shadow ${
            stale ? "border-l-4 border-l-amber-400/80" : ""
          } ${highlighted ? "ring-2 ring-sky-400 ring-offset-2 ring-offset-background animate-pulse" : ""}`}
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
              <CompanyLogo company={app.company} logoUrl={app.logoUrl} logoBgClass={logoBgClass} />
              <p className="text-sm text-muted-foreground">{app.role}</p>
            </div>
            {!isTerminalKind(app.stageKind) ? (
              <p className="text-xs text-muted-foreground/70">
                {app.stageKind === "intake" ? "Added" : "Applied"} {formatAppliedDate(app.createdAt, timeZone)} ·{" "}
                {formatAge(daysSince(app.createdAt))}
              </p>
            ) : null}
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
                <p className="text-xs text-amber-300">Interview: {formatInterviewLabel(app.interviewDate, timeZone)}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
      {notesVisible && notes ? (
        <div
          role="tooltip"
          onMouseEnter={showNotesTooltip}
          onMouseLeave={hideNotesTooltip}
          className="fixed z-[100] w-64 max-w-[min(16rem,calc(100vw-1rem))] -translate-y-1/2 rounded-lg border border-indigo-400/50 bg-indigo-950 px-3 py-2.5 shadow-xl"
          style={{ top: notesPos.top, left: notesPos.left }}
        >
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">Notes</p>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-indigo-50">{notes}</p>
        </div>
      ) : null}
    </>
  );
}

export function KanbanBoard({ initialApplications, initialStages, readOnly = false, timeZone }: KanbanBoardProps) {
  const [applications, setApplications] = useState<Application[]>(initialApplications);
  const [stages, setStages] = useState<Stage[]>(initialStages);
  const [editingApplication, setEditingApplication] = useState<Application | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [draggedItem, setDraggedItem] = useState<DragItem>(null);
  const [stageDropTargetId, setStageDropTargetId] = useState<number | null>(null);
  const [binHover, setBinHover] = useState(false);
  const [pendingMoveIds, setPendingMoveIds] = useState<number[]>([]);
  const pendingMoveIdsRef = useRef<Set<number>>(new Set());
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [stageDialog, setStageDialog] = useState<{ open: boolean; stage: Stage | null }>({ open: false, stage: null });
  const scrollRef = useRef<HTMLDivElement>(null);

  useMiddleButtonPan(scrollRef);

  // The highlight is a transient "here it is" cue, not a selection state.
  useEffect(() => {
    if (highlightedId === null) {
      return;
    }
    const timer = window.setTimeout(() => setHighlightedId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightedId]);

  function focusApplication(app: Application) {
    setHighlightedId(app.id);
    const card = scrollRef.current?.querySelector<HTMLElement>(`[data-application-id="${app.id}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }

  const grouped = useMemo(() => {
    return stages.reduce(
      (acc, stage) => {
        acc[stage.id] = applications.filter((item) => item.stageId === stage.id);
        return acc;
      },
      {} as Record<number, Application[]>
    );
  }, [applications, stages]);

  async function refreshBoard() {
    const response = await fetch("/api/applications");

    if (!response.ok) {
      return;
    }

    const body = (await response.json()) as { applications: Application[]; stages: Stage[] };
    setApplications(body.applications);
    setStages(body.stages);
  }

  async function moveCard(id: number, stageId: number) {
    // Ignore a second drop while this card's previous move is still in flight.
    if (pendingMoveIdsRef.current.has(id)) {
      return;
    }

    const app = applications.find((item) => item.id === id);

    if (!app || app.stageId === stageId) {
      return;
    }

    const fromStage = stages.find((stage) => stage.id === app.stageId);
    const toStage = stages.find((stage) => stage.id === stageId);
    const expectedStageId = app.stageId;

    pendingMoveIdsRef.current.add(id);
    setPendingMoveIds((current) => [...current, id]);

    try {
      const response = await fetch(`/api/applications/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId, expectedStageId })
      });

      if (response.status === 409) {
        await refreshBoard();
        alert("This application was moved elsewhere. The board has been refreshed.");
        return;
      }

      if (!response.ok) {
        alert("Failed to move application.");
        return;
      }

      const updated = (await response.json()) as Application;
      setApplications((current) => current.map((item) => (item.id === id ? updated : item)));

      if (fromStage && toStage && fromStage.id !== toStage.id) {
        trackApplicationMoved({ fromStageName: fromStage.name, toStageName: toStage.name });
      }
    } finally {
      pendingMoveIdsRef.current.delete(id);
      setPendingMoveIds((current) => current.filter((pendingId) => pendingId !== id));
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

  function onStageSaved(stage: Stage, mode: "add" | "edit") {
    if (mode === "add") {
      setStages((current) => [...current, stage]);
      trackStageAdded({ stageName: stage.name });
      return;
    }

    setStages((current) => current.map((item) => (item.id === stage.id ? stage : item)));
    // Cards carry their lane's name and kind (search, staleness, applied date),
    // so keep them in step.
    setApplications((current) =>
      current.map((item) =>
        item.stageId === stage.id ? { ...item, stageName: stage.name, stageKind: stage.kind } : item
      )
    );
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
      setStages((latest) => {
        const byId = new Map(latest.map((stage) => [stage.id, stage]));
        const restored = current
          .map((stage, index) => {
            const latestStage = byId.get(stage.id);
            return latestStage ? { ...latestStage, sortOrder: index } : null;
          })
          .filter((stage): stage is Stage => stage !== null);

        const restoredIds = new Set(restored.map((stage) => stage.id));
        for (const stage of latest) {
          if (!restoredIds.has(stage.id)) {
            restored.push(stage);
          }
        }

        return restored;
      });
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

  async function onDropToBin() {
    if (!draggedItem) {
      return;
    }

    if (draggedItem.type === "application") {
      const app = applications.find((item) => item.id === draggedItem.id);
      const label = app ? `"${app.company} - ${app.role}"` : "this application";
      if (!window.confirm(`Delete ${label}? This cannot be undone.`)) {
        onAnyDragEnd();
        return;
      }
      await deleteApplicationById(draggedItem.id);
    }

    if (draggedItem.type === "stage") {
      const stage = stages.find((item) => item.id === draggedItem.id);
      const label = stage ? `stage "${stage.name}"` : "this stage";
      if (!window.confirm(`Delete ${label}? This cannot be undone.`)) {
        onAnyDragEnd();
        return;
      }
      await deleteStageById(draggedItem.id);
    }

    setDraggedItem(null);
    setStageDropTargetId(null);
    setBinHover(false);
  }

  return (
    <section className="space-y-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">Applications Board</h2>
          <ApplicationSearch applications={applications} stages={stages} onSelect={focusApplication} />
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setStageDialog({ open: true, stage: null })}>
              <Plus className="mr-1 h-4 w-4" />
              Add Stage
            </Button>
            <AddApplicationDialog
              stages={stages}
              applications={applications}
              onCreated={(app) => setApplications((current) => [app, ...current])}
            />
          </div>
        )}
      </div>

      <div ref={scrollRef} className="scrollbar-none overflow-x-auto overscroll-x-contain pb-3 data-[panning=true]:cursor-grabbing data-[panning=true]:select-none">
        <div
          className="inline-grid gap-4"
          style={{ gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(240px, 280px))` }}
        >
          {stages.map((stage, index) => {
            const tone = toneFor(stage, index);
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
                  <h3
                    className="truncate text-sm font-semibold tracking-wide text-muted-foreground"
                    title={`${stage.name} · ${KIND_LABELS[stage.kind]}`}
                  >
                    {stage.name}
                  </h3>
                  <div className="flex items-center gap-2">
                    {!readOnly && (
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                        onClick={() => setStageDialog({ open: true, stage })}
                        title={`Edit lane (type: ${KIND_LABELS[stage.kind]})`}
                        aria-label={`Edit ${stage.name}`}
                      >
                        <Settings2 className="h-4 w-4" />
                      </button>
                    )}
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground">
                      {grouped[stage.id]?.length ?? 0}
                    </span>
                    <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
                <div className="space-y-3">
                  {(grouped[stage.id] ?? []).map((app) => {
                    const stale = isApplicationStale(app);
                    const staleDays = stale ? daysSince(app.stageEnteredAt ?? app.updatedAt) : 0;
                    return (
                      <KanbanApplicationCard
                        key={app.id}
                        app={app}
                        stale={stale}
                        staleDays={staleDays}
                        logoBgClass={tone.logoBg}
                        readOnly={readOnly}
                        pending={pendingMoveIds.includes(app.id)}
                        highlighted={highlightedId === app.id}
                        timeZone={timeZone}
                        onDragStart={() => setDraggedItem({ type: "application", id: app.id })}
                        onDragEnd={onAnyDragEnd}
                        onEdit={() => {
                          setEditingApplication(app);
                          setEditOpen(true);
                        }}
                      />
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
          <StageDialog
            open={stageDialog.open}
            onOpenChange={(open) => setStageDialog((current) => ({ ...current, open }))}
            stage={stageDialog.stage}
            onSaved={onStageSaved}
          />
          <EditApplicationDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            application={editingApplication}
            applications={applications}
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
