"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Application, Stage } from "@/lib/types";

interface ApplicationSearchProps {
  applications: Application[];
  stages: Stage[];
  onSelect: (application: Application) => void;
}

const MAX_SUGGESTIONS = 8;

// Company matches rank above role-only matches; within a group the board's
// existing order (most recently updated first) is kept.
function findMatches(applications: Application[], query: string): Application[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const byCompany: Application[] = [];
  const byRole: Application[] = [];

  for (const app of applications) {
    if (app.company.toLowerCase().includes(needle)) {
      byCompany.push(app);
    } else if (app.role.toLowerCase().includes(needle)) {
      byRole.push(app);
    }
  }

  return [...byCompany, ...byRole].slice(0, MAX_SUGGESTIONS);
}

export function ApplicationSearch({ applications, stages, onSelect }: ApplicationSearchProps) {
  const listId = useId();
  const blurTimerRef = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => findMatches(applications, query), [applications, query]);
  const stageNames = useMemo(() => new Map(stages.map((stage) => [stage.id, stage.name])), [stages]);

  const showList = open && matches.length > 0;
  const activeId = showList ? `${listId}-option-${matches[Math.min(activeIndex, matches.length - 1)].id}` : undefined;

  function select(app: Application) {
    onSelect(app);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (!showList) {
      if (event.key === "ArrowDown" && matches.length > 0) {
        setOpen(true);
        event.preventDefault();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(matches[Math.min(activeIndex, matches.length - 1)]);
    }
  }

  // Closing on blur must wait a beat so a click on a suggestion registers
  // before the list unmounts.
  function onBlur() {
    blurTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }

  function onFocus() {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setOpen(true);
  }

  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        role="combobox"
        aria-label="Search applications"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        placeholder="Find an application…"
        className="pl-8"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {matches.map((app, index) => {
            const active = index === Math.min(activeIndex, matches.length - 1);
            return (
              <li
                key={app.id}
                id={`${listId}-option-${app.id}`}
                role="option"
                aria-selected={active}
                className={`cursor-pointer rounded-sm px-2 py-1.5 text-sm ${active ? "bg-accent text-accent-foreground" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  // Keep focus on the input so the blur timer never races the click.
                  event.preventDefault();
                  select(app);
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{app.company}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{stageNames.get(app.stageId) ?? app.stageName}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground">{app.role}</p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
