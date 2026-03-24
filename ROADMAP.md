# Roadmap

Feature backlog for the JobHunt app, ordered by priority. The app currently has ~6 applications — these features are planned for when daily applying ramps up.

---

## Phase 1 — Essentials (do first)

### Bulk Import from CSV
**Why:** Adding 10+ applications one by one is tedious. This removes the biggest friction to daily use.

**Implementation:**
- Add an "Import CSV" button next to "Add Application" in the kanban header
- Accept CSV with columns: `company, role, source_url, notes` (all optional except company+role)
- Parse client-side with a simple CSV parser (no library needed for basic CSV)
- Preview table before confirming import
- POST to a new `/api/applications/bulk` endpoint
- Each row runs through `findCompanyLogo()` for logo lookup
- All imported apps land in the "Applied" stage by default
- Show a summary after import: X added, Y failed (with reasons)

**Files to touch:**
- `src/components/import-csv-dialog.tsx` (new)
- `src/app/api/applications/bulk/route.ts` (new)
- `src/lib/db.ts` — add `createApplicationsBulk()`
- `src/components/kanban-board.tsx` — add import button

---

### Search & Filter on the Board
**Why:** Once past ~15 cards, finding a specific company becomes slow.

**Implementation:**
- Add a search input above the kanban columns
- Filter cards client-side by company name, role, or notes (case-insensitive substring match)
- Highlight matching text in cards
- Optional: filter by stage dropdown (useful when columns overflow horizontally)
- All filtering is client-side on `initialApplications` — no API changes needed

**Files to touch:**
- `src/components/kanban-board.tsx` — add search state, filter logic, and input UI

---

## Phase 2 — Insights (do once applying daily)

### Dashboard Stats Bar
**Why:** Quick overview of pipeline health without counting cards manually.

**Implementation:**
- Stats row above the kanban columns showing:
  - Total applications
  - Response rate: `(apps that left "Applied") / total`
  - Applications this week
  - Average days in current stage
- Compute client-side from `initialApplications` + stage data (no new API)
- Simple horizontal card row, responsive

**Files to touch:**
- `src/components/dashboard-stats.tsx` (new)
- `src/app/page.tsx` — render stats above KanbanBoard

---

### Application Timeline
**Why:** See the full history of a single application — when it moved, how long it sat in each stage.

**Implementation:**
- Click a card → show timeline in the edit dialog or a new detail panel
- New API: `GET /api/applications/[id]/timeline` returning transitions ordered by date
- New DB function: `getApplicationTimeline(id)` querying `application_transitions`
- Render as a vertical timeline with stage names, dates, and durations between steps

**Files to touch:**
- `src/lib/db.ts` — add `getApplicationTimeline()`
- `src/app/api/applications/[id]/timeline/route.ts` (new)
- `src/components/edit-application-dialog.tsx` — add timeline tab/section

---

## Phase 3 — Automation (do once volume is high)

### Stale Application Alerts
**Why:** Applications sitting in "Applied" or "Screening" for 14+ days are likely ghosted.

**Implementation:**
- Add a subtle visual indicator (border glow or badge) on cards where `updatedAt` is older than a configurable threshold (default: 14 days)
- Threshold stored in localStorage (user preference)
- Optional: "Move stale to Ghosting" bulk action button that appears when stale cards exist
- All client-side logic — compare `updatedAt` against `Date.now()`

**Files to touch:**
- `src/components/kanban-board.tsx` — stale detection + visual indicator
- `src/lib/constants.ts` — default stale threshold

---

### Weekly Digest View
**Why:** Track momentum — am I applying more or less than last week?

**Implementation:**
- New page at `/stats` linked from the main nav
- Show:
  - Applications added per week (bar chart)
  - Transitions per week (line chart)
  - Current pipeline funnel (horizontal bar)
- New API: `GET /api/stats` returning weekly aggregates
- Uses Recharts (already a dependency) for charts

**Files to touch:**
- `src/app/stats/page.tsx` (new)
- `src/app/api/stats/route.ts` (new)
- `src/lib/db.ts` — add `getWeeklyStats()`
- `src/components/kanban-board.tsx` — add nav link to `/stats`
