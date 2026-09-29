"use client";

import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

const HIDE_OUTCOME_LANES_KEY = "board.hideOutcomeLanes";
const CHANGE_EVENT = "board-filter-change";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function readHideOutcomeLanes(): boolean {
  try {
    return window.localStorage.getItem(HIDE_OUTCOME_LANES_KEY) === "true";
  } catch {
    return false;
  }
}

// Remembered per browser. The server always renders "shown", and the stored
// choice applies after hydration, so the two never disagree.
export function useHideOutcomeLanes(): [boolean, (hide: boolean) => void] {
  const hide = useSyncExternalStore(subscribe, readHideOutcomeLanes, () => false);
  function setHide(next: boolean) {
    try {
      window.localStorage.setItem(HIDE_OUTCOME_LANES_KEY, String(next));
    } catch {
      // Storage can be unavailable (private mode); the choice then lasts until reload.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
  return [hide, setHide];
}

export function BoardFilter({
  query,
  onQueryChange,
  hideOutcomeLanes,
  onHideOutcomeLanesChange,
  matching,
  total
}: {
  query: string;
  onQueryChange: (query: string) => void;
  hideOutcomeLanes: boolean;
  onHideOutcomeLanesChange: (hide: boolean) => void;
  matching: number;
  total: number;
}) {
  const filtering = query.trim() !== "";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative">
        <Input
          // Plain text: a search field brings the browser's own clear button,
          // next to the one below.
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              onQueryChange("");
            }
          }}
          placeholder="Filter cards"
          aria-label="Filter cards by company or role"
          className="h-9 w-48 pr-8"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Clear the filter"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={hideOutcomeLanes}
          onChange={(event) => onHideOutcomeLanesChange(event.target.checked)}
          className="h-4 w-4 accent-sky-500"
        />
        Hide outcome lanes
      </label>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {filtering ? `${matching} of ${total} cards match` : ""}
      </p>
    </div>
  );
}
