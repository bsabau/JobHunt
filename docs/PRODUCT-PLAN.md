# Product plan

Plan for the ideas in `docs/PRODUCT-AUDIT-2026-09-29.md` (IDs `R-`, `M-`, `F-` match that file) and for `ROADMAP.md` (CSV import, which has no audit ID and is called `IMP` here). `docs/FIX-PLAN.md` is finished; this plan builds on what it shipped: lane kinds, lane ids in history, the three views (`application_entry_stage`, `application_stage_entry`, `application_applied_at`), redaction in `mapApplication()`, the PGlite tests and the enforced CSP.

Nothing here is implemented yet. Each step's section should end with what was actually done, as in the fix plan.

## Summary

| ID | What | Size | Depends on | Migration | Step |
|---|---|---|---|---|---|
| F-3 | Application timeline in the card dialog | small | | no | 1.1 |
| F-4 | Board filter and "hide outcome lanes" | small | | no | 1.2 |
| M-1 | Rate tiles: response, interview, offer, ghosted | small | | yes (view) | 2.1 |
| R-4 | Replace two summary tiles | tiny | M-1 | no | 2.1 |
| R-3 | Drop the daily transitions chart | tiny | | no | 2.1 |
| R-1 | One funnel chart | small | | no | 2.2 |
| R-2 | Weekly bars with a cumulative line | small | | no | 2.3 |
| M-2 | Time to hear back | small | 2.1 | no | 3.1 |
| M-3 | Results by application week | medium | 2.1, 3.1 | no | 3.2 |
| M-4 | Results by source | small | 2.1 | no | 3.3 |
| M-5 | Date range filter on the stats page | small | 2.1 to 3.3 | no | 3.4 |
| F-1 | Actions on stale applications | medium | | yes (columns, view) | 4.1 |
| F-2 | Close ghosted applications in bulk | small | 2.1, 4.1 | no | 4.2 |
| F-6 | Optional fields: referral, location, salary | medium | 3.3 | yes (columns) | 5.1 |
| F-7 | Calendar export for interviews | small | | yes (columns) | 5.2 |
| IMP | Bulk import from CSV (optional) | medium | | no | 5.3 |
| F-5 | CSV export (optional) | small | | no | 5.4 |

Sizes: tiny is under an hour, small is up to half a day, medium is about a day.

## Order and reasoning

| Phase | Goal | Steps | Size |
|---|---|---|---|
| 1 | Daily use of the board | 1.1 F-3, 1.2 F-4 | 1 day |
| 2 | A stats page that says each thing once | 2.1 M-1, R-3, R-4; 2.2 R-1; 2.3 R-2 | 1 to 2 days |
| 3 | New metrics | 3.1 M-2, 3.2 M-3, 3.3 M-4, 3.4 M-5 | 2 days |
| 4 | Acting on what the stats show | 4.1 F-1, 4.2 F-2 | 1 to 2 days |
| 5 | More fields, calendar; optional CSV | 5.1 F-6, 5.2 F-7, 5.3 IMP, 5.4 F-5 | 2 to 4 days |

- Phase 1 is the timeline and the filter. CSV import and export were first in `ROADMAP.md`; the owner does not need them now (2026-09-29), so they are optional steps 5.3 and 5.4. Without the export, the backup before the bulk close (4.2) is Neon's point-in-time restore.
- Phase 2 comes before phase 3 because every new metric reads the view that 2.1 adds, and because removing four charts first leaves room on the page for the new ones.
- M-5 is last in phase 3: it adds a parameter to every ranged query, so it is cheaper once those queries exist.
- F-2 needs "no reply yet" (2.1) and must respect a snooze (4.1).
- Phase 5 comes last. 5.1 and 5.2 are built after phases 1 to 4 (decisions 14 and 16); 5.3 and 5.4 are optional and wait until the owner asks for them (decision 19). The steps of phase 5 can be built in any order; where two share a piece, the first one built adds it.

One step is one branch and one pull request. Steps inside a phase can be reordered; the "Depends on" column is the only hard order.

## Rules for every step

These repeat `AGENTS.md` where a product step is likely to trip over it.

- `npm run check` before every commit. `npm run build` as well when a route, a page or a dependency changed.
- **No new npm dependency** is planned in any step. The CSV parser, the CSV writer and the `.ics` writer are small pure modules in this repo. If a step turns out to need a package, say so in the PR and check that Radix still resolves to one copy of each package (the lesson of PR #19).
- **SQL that a test must run** is built with `sqlFragment` / `compileSql` in a module without runtime imports, as `stage-statements.ts` is, and executed with `getSql().query(text, params)` or, inside the stats snapshot, `tx.query(text, params)` (`NeonQueryFunctionInTransaction` has it). Tests run the same text on PGlite built by the real migrations.
- **New statements take `now` as a parameter** (`${now}::timestamptz`) instead of calling `NOW()`, so a test can fix the clock. The pages already read the clock once with `requestNow()`.
- **Migrations**: forward-only, harmless when run twice, `LATEST_MIGRATION` updated in the same commit. File numbers continue from `1730000016000`; take the next free thousand at the time of writing. Every migration in this plan is additive (a view, or nullable columns), so the previous code keeps working after it. Runbook for production: the owner runs `npm run migrate:prod`, then merges. The implementer never runs it.
- **A view's column list is a contract**: `CREATE OR REPLACE VIEW` can only append columns. Record in `docs/ARCHITECTURE.md` which columns each new view reads, as the existing migration notes do.
- **Guest**: every new route calls `requireSession()` before any database access; anything that changes data or returns owner-only text passes `{ write: true }`, or the `owner` option that 5.2 or 5.4 adds, whichever comes first. Everything that reaches a guest goes through `mapApplication(row, viewer)`.
- **CSP**: no step needs a new host. A step that adds a download or reads a file says so in its section; check the Vercel preview with the console open, since `next start` does not show every problem.
- **Analytics**: new events carry counts, booleans and lane kinds only. Never a company, a host name, a file name or any other text the owner typed.
- **Public repository**: test fixtures and examples use invented names. No real company, recruiter, salary or URL from the owner's data in code, tests, docs, commit messages or PR descriptions.
- **Docs in the same change**: follow the table in `AGENTS.md`. Each step below names the files it expects to touch.
- **Browser check**: use the feature as a person would (keyboard included) on a production build before asking for review.

---

## Phase 1: the board

### 1.1 Application timeline (F-3)

**Goal:** see how one application moved and how long it sat in each lane.

**Scope**

- `GET /api/applications/:id/timeline`, for owner and guest. No notes are involved.
- Response: `{ entry: { stageId, stageName, stageKind, at }, steps: [{ fromStageName, toStageId, toStageName, toStageKind, at }] }`. `entry.at` is `created_at`. Steps are ordered by `(transitioned_at, id)`. `stageKind` and the ids are `null` for a deleted lane, whose name is returned as `<name> (deleted)`, as the charts do.
- In the dialog: a vertical list, one line per lane with the date it was entered and the time spent there. The last line counts up to `now`.
- The dialog states in one sentence that this is the current path: a move backwards rewrites it.
- The owner sees it in the edit dialog, loaded when the dialog opens. The guest gets a read-only details dialog (company, role, link, dates, timeline) on Enter or double-click (decision 4).

**Data**

- No migration.
- One query in a new `src/lib/db/timeline.ts`: the entry lane from `application_entry_stage`, the steps from `application_transitions` joined to `stages` by id for the live name and kind.
- 404 through `NotFoundError` when the application does not exist.

**Files**

- New: `src/lib/db/timeline.ts`, `src/lib/application-statements.ts` (no runtime imports; later steps add to it), `src/app/api/applications/[id]/timeline/route.ts`, `src/components/application-timeline.tsx`, `src/components/application-details-dialog.tsx` (guest), `tests/timeline.test.mjs`.
- Changed: `src/lib/types.ts` (`TimelinePayload`), `src/lib/db/index.ts`, `src/components/edit-application-dialog.tsx`, `src/components/kanban-board.tsx`, `src/lib/timezone.ts` if a duration helper is added, `package.json` (`verify:timeline`).
- Docs: `AGENTS.md` (Commands, Key modules), `docs/ARCHITECTURE.md` (Routes, Source layout, Verification), `README.md`, `ROADMAP.md`.

**Domain rules touched**

- `application_transitions` is the current path, not an audit log.
- The entry lane comes from `application_entry_stage`; do not derive it again.
- Join history to lanes by id. The stored name is the fallback for a deleted lane only.
- After a rewind the kept or reconnected edge carries the boundary's timestamp, so durations describe the corrected path.
- Dates: format with pinned locale and time zone; durations take the `now` prop, never `Date.now()` in the component.

**Guest and notes:** the payload has no notes field at all. The guest dialog is built from the `Application` the guest already has, where notes are `null`.

**CSP:** none.

**Tests** (`timeline.test.mjs`, PGlite, moves made with `stageMoveStatement()`)

- A card with no moves returns the entry and no steps.
- Forward moves return one step each, in order.
- After a rewind onto a visited lane the path ends at that lane with its original timestamp.
- After a rewind below the entry lane there are no steps and the entry is the current lane.
- A renamed lane appears under its new name; a deleted lane appears as `(deleted)` with `null` id and kind.
- Make the query a statement in `application-statements.ts` so the test runs the production text.

**Acceptance**

- The timeline of a card moved Applied, Screening, Interview shows three lines with dates and durations that add up to the card's age.
- Moving that card back to Applied and reopening the dialog shows one line.
- The guest can open the details dialog by keyboard and mouse, sees no notes field and no edit controls.
- An unknown id returns 404; a request without a session returns 401.

Done in PR #30:

- `GET /api/applications/:id/timeline` returns `{ lanes }`: the entry lane first, entered at `created_at`, then every lane moved into. This is flatter than the planned `{ entry, steps }`: the path is contiguous, so each step's "from" is the lane before it. One statement (`applicationTimelineStatement()` in the new `src/lib/application-statements.ts`, built with `sqlFragment`, which it imports from `./stage-statements.ts` now that `allowImportingTsExtensions` is on) returns the steps as JSON, so the path is one round trip.
- The edit dialog shows a "History" section below the form, so the form keeps its place while the history loads and "Save changes" stays where it was: each lane with the date entered and the days spent there ("so far" for the current lane, "ago" for an outcome lane). It reloads when the card moves or is saved. Only the dialog's body scrolls, so the header and the close button stay in view.
- Days are whole days, rounded down per lane, so they need not add up to the card's age; the acceptance check "durations add up to the card's age" was dropped for that reason.
- The guest opens a read-only details dialog with Enter or a double-click: company, role, lane, applied date, interview date, link and history, and no notes field (decision 4).
- Fixed on the way: the card's notes tooltip stayed on top of an opened dialog, and closing a card dialog left focus nowhere. Focus now returns to the card.
- `tests/timeline.test.mjs` (PGlite, moves made with `stageMoveStatement()`) covers a card with no moves, forward moves (entry lane at creation), a rewind onto a visited lane (original time kept), a rewind below the entry lane, renamed and deleted lanes (entry lane included), two applications side by side, a new lane that took a deleted lane's name (joins by id) and an unknown id. Fable's mutations of the application filter, the joins and the creation time all fail it.
- Dates on the board, in the timeline and in the guest dialog now share `formatDay()` and `formatDateOnly()` in `src/lib/timezone.ts`; the guest dialog shows the interview date as the card does.

### 1.2 Board filter (F-4)

**Goal:** narrow the board instead of jumping to one card.

**Scope**

- A text filter over company and role (case-insensitive substring), next to the search.
- A toggle "Hide outcome lanes" that hides lanes whose kind is in `TERMINAL_KINDS`. Offer lanes stay visible.
- Each lane header shows "3 of 12" while a text filter is active.
- The toggle is remembered in `localStorage` and read after mount, so the server HTML and hydration agree. The text filter is not remembered.
- Choosing a search result whose card is filtered out or in a hidden lane clears what hides it, then focuses the card.
- Client side only. No request changes.

**Files**

- New: `src/components/board-filter.tsx`, `src/lib/board-filter.ts` (the pure predicate), `tests/board-filter.test.mjs`.
- Changed: `src/components/kanban-board.tsx`, `src/components/application-search.tsx` only if the two inputs are merged, `package.json` (`verify:board-filter`).
- Docs: `AGENTS.md` (Commands), `docs/ARCHITECTURE.md` (Verification), `README.md`, `ROADMAP.md`.

**Domain rules touched:** the hidden lanes are chosen by kind (`TERMINAL_KINDS`), never by name or position.

**Guest and notes:** available to the guest. The filter must not match on notes: a guest has none, and the owner's results would then differ from what the visible card text explains.

**CSP:** none.

**Tests:** the predicate matches company or role, ignores case and surrounding spaces, and an empty filter matches everything; the hidden-lane rule hides `rejected` and `closed` and nothing else.

**Acceptance**

- Typing narrows every lane; clearing restores it; drag and drop and the "Move to" menu work while a filter is active.
- Moving a card into a hidden lane through the menu works, and a toast says where it went.
- Reloading keeps the toggle and logs no hydration warning.

Done in PR #31:

- `BoardFilter` next to the search: a text filter over company and role (Escape or the clear button empties it; focus stays in the field), a "Hide outcome lanes" checkbox and a live "N of M cards match", counted over the lanes on screen, with ", K more in hidden lanes" when some match there. Lane badges read "3 of 12" while filtering, and a lane with cards but no matches says "No cards match the filter".
- The toggle is remembered in `localStorage` through `useSyncExternalStore`, whose server snapshot is "shown", so the server HTML and hydration agree; a reload with the toggle on logs no warning. When storage is blocked the choice is kept in memory until reload.
- The rules live in `src/lib/board-filter.ts` (`matchesBoardFilter()`, `isLaneHidden()` by `isTerminalKind()`), tested in `tests/board-filter.test.mjs`. Offer lanes stay visible.
- A search result behind the filter or in a hidden lane clears what hides it; the board then scrolls to the card once it has re-rendered. Every selection is a new scroll request, so choosing the same card twice scrolls twice.
- A card that lands out of sight after a menu move, an edit or a new card says why ("is in Rejected, which is hidden", "does not match the filter"), and focus moves to the control that hides it. Lanes keep their colour when others are hidden.
- Checked on a production build, owner and guest, including a reload with the toggle on and the keyboard regression script.

---

## Phase 2: a stats page that says each thing once

### 2.1 Milestones view, rate tiles, tile and chart cleanup (M-1, R-3, R-4)

**Goal:** define "got a reply", "reached an interview" and "got an offer" once, show them as rates, and remove the two tiles and the chart that answer no question.

**Data: view `application_milestones`**

A view, not columns: every value is derived from the current path, and a stored copy would need updating by every move, rewind, lane delete and kind change. It builds on `application_applied_at` and `application_entry_stage`.

| Column | Definition |
|---|---|
| `application_id` | |
| `applied_at` | From `application_applied_at`. `NULL` while the card has not been sent |
| `responded` | `responded_at IS NOT NULL`, or the entry lane's kind is `interview`, `offer` or `rejected` (a card added after the reply came) |
| `responded_at` | Time of the first edge after the applied moment whose target lane is not `intake` and not `closed`. `NULL` when there is none |
| `interviewed` | `first_interview_at IS NOT NULL`, or the entry lane's kind is `interview` |
| `first_interview_at` | Time of the first edge into a lane of kind `interview` |
| `offered` | `offered_at IS NOT NULL`, or the entry lane's kind is `offer` |
| `offered_at` | Time of the first edge into a lane of kind `offer` |
| `rejected_at` | Time of the first edge into a lane of kind `rejected` |

Details the migration must get right:

- "After the applied moment": for a card whose entry lane is `intake`, the applied edge is its first edge into a pipeline lane (the one whose time is `applied_at`); the response is the first later edge by `(transitioned_at, id)`. For every other card, any first edge qualifies. Compare by `(transitioned_at, id)`, not by time alone: a rewind's reconnect edge reuses the boundary's timestamp.
- A move into a `closed` lane is the owner giving up, not a reply, so it is not a response. A move into `rejected` is.
- An edge into a deleted lane (`to_stage_id IS NULL`) counts as a response, consistent with `application_applied_at`, where a deleted lane counts as a pipeline lane.
- The booleans exist because a card created directly in an interview, offer or rejected lane has had a reply at an unknown time. It counts in the rates and is left out of the medians (3.1).
- Interview rate is literal: a card that went from Applied straight to Offer has `offered` but not `interviewed`.
- Migration `<next>_application-milestones-view.mjs`, `CREATE OR REPLACE VIEW`. It reads `applications.id`; `stages.id` and `.kind`; the transitions' `id`, `application_id`, `to_stage_id` and `transitioned_at`; and both views named above. Record that in `docs/ARCHITECTURE.md`; dropping either view now needs this one dropped first.

**Scope**

- M-1: four tiles, each a share of the cards with `applied_at IS NOT NULL`: response, interview, offer, ghosted. Ghosted is "currently in a lane of kind `closed`". Each tile's hint gives the counts ("7 of 30"). With no applied cards the value is "—".
- R-4: remove the tiles "Stage Transitions" and "Avg Days Since Created", and with them `totals.transitions`, `totals.avgDaysSinceCreated` and their two queries.
- R-3: remove the chart "Daily Stage Transitions", `transitionsByDay` and its query.
- "Avg Days to Interview" reads `first_interview_at - applied_at` from the view instead of its own lateral subquery. The number must not change.
- The tile row becomes eight tiles: total, the four rates, average days in current stage, average days to interview, stale. Lay them out as two rows of four on wide screens.

**Files**

- New: the migration, `src/lib/stats-statements.ts` (the rates statement; no runtime imports), `tests/milestones.test.mjs`, `tests/stats-statements.test.mjs`.
- Changed: `src/lib/db/schema-version.ts`, `src/lib/db/stats.ts`, `src/lib/types.ts` (`StatsPayload.rates`), `src/components/stats-charts.tsx`, `package.json` (`verify:milestones`, `verify:stats-statements`).
- Docs: `AGENTS.md` (Commands; Domain rules: one line, "whether and when an application got a reply, an interview or an offer comes from the view `application_milestones`"), `docs/ARCHITECTURE.md` (Tables, migration notes, Derived values, Verification), `README.md`.

**Domain rules touched**

- Lane kinds carry the meaning; the kind literals in the view are the same exception the existing views make, and the app code uses the named constants.
- The applied date comes from `application_applied_at`.
- History is joined by lane id.
- The path is the current path: a card rewound out of an interview lane no longer counts as interviewed. State this in the tile hint or a footnote.

**Guest and notes:** the stats page shows the guest the same aggregates as the owner. No notes are read.

**CSP:** none.

**Tests**

- `milestones.test.mjs` (PGlite, moves made with `stageMoveStatement()`, explicit timestamps where needed):
  - created in an `active` lane, never moved: applied, not responded;
  - moved to a second `active` lane: responded at that edge;
  - moved straight to `rejected`: responded, `rejected_at` set;
  - moved to `closed`: not responded, and counted as ghosted by the rates statement;
  - entry in `intake`, not moved: `applied_at` is `NULL` and the card is in no denominator;
  - entry in `intake`, then a pipeline lane, then an interview lane: the response is the second edge, not the first;
  - entry in `intake`, then straight to `rejected`: not applied, not counted;
  - created directly in an interview lane: `interviewed` and `responded` true, both timestamps `NULL`;
  - a rewind out of the interview lane clears `interviewed`;
  - the lane of the response edge deleted afterwards: still responded;
  - a lane's kind changed from `active` to `interview`: the card now counts as interviewed.
- `stats-statements.test.mjs`: the rates over a mixed set, and over an empty database (no division by zero).
- `schema.test.mjs`: the migration re-runs safely.

**Acceptance**

- On `dev`, before and after: every number that stays on the page is identical, "Avg Days to Interview" included.
- The four rates on `dev` match a hand count made with read-only queries.
- The stats page still makes one database request.
- `src/lib/db/stats.ts` stays under about 300 lines.

Done in PR #32:

- Migrations `1730000017000` and `1730000018000` add the view `application_milestones` as planned (18 keeps the three flags from being `NULL` when the entry lane was deleted), with one addition: an interview or an offer also counts as a reply, so a card sent from a wishlist straight into an interview lane (whose only edge is the one that sent it) is not "interviewed but no reply". Its `responded_at` stays `NULL`.
- `milestoneStatsStatement()` in the new `src/lib/stats-statements.ts` returns the counts and the average days to an interview in one row, inside the page's snapshot (`tx.query()`). `StatsPayload.rates` carries the counts; the page computes the percentages.
- Tiles: total, response, interview, offer, ghosted, average days in current stage, average days to interview, stale; two rows of four. Each rate shows "N of M sent", and a line under the tiles says the rates describe the current path. "Stage Transitions", "Avg Days Since Created" and the "Daily Stage Transitions" chart are gone with their queries; the funnel now spans the row.
- `CLOSED_KIND` joins the named kinds in `stage-kinds.ts`.
- On `dev`, before and after: every number that stays is identical ("Avg Days to Interview" 17.6 on 3 applications), and the rates (30 sent, 14 replied, 3 interviewed, 0 offers, 11 ghosted) match a hand count made without the view.
- `tests/milestones.test.mjs` covers the plan's scenarios plus: wishlist to interview and to offer, cards created in offer and rejected lanes, two interview lanes, a move into an intake lane placed after the pipeline, two edges with the same time, and a deleted entry lane (flags strictly `false`). Thirteen deliberate breaks of the view and the rates statement each fail it. It also holds the rates statement's tests; later steps add their statement tests there or start `tests/stats-statements.test.mjs`.

### 2.2 One funnel chart (R-1)

**Goal:** answer "how far do applications get?" once.

**Scope**

- Remove "Pipeline Drop-off" and "Stage-to-Stage Conversion", `stagePairs` and its query.
- Keep "Funnel: Stages Visited" and add, between neighbouring pipeline lanes, the share that advanced (`reached(next) / reached(this)`).
- Keep the rules of the current drop-off code: lanes ranked with `compareStageRank()`, terminal lanes excluded from the advance rate, and no rate where the next lane was reached by more cards than this one (cards that entered later in the pipeline).
- Outcome lanes stay in the chart as bars, after the pipeline lanes, without a rate between them.
- Keep "Applications by Stage"; it is the only view of where things stand today. Per-pair detail stays on `/sankey`.
- Move the rate computation out of the component into a pure function so it can be tested.

**Files**

- New: `src/lib/funnel.ts`, `tests/funnel.test.mjs`.
- Changed: `src/lib/db/stats.ts`, `src/lib/types.ts`, `src/components/stats-charts.tsx`, `package.json` (`verify:funnel`).
- Docs: `AGENTS.md` (Commands, Key modules), `docs/ARCHITECTURE.md` (Source layout, Verification), `README.md` (Features names funnel, conversion and drop-off).

**Domain rules touched:** pipeline rank is `(is terminal, sort_order)`. This step adds no third copy of the rule: `funnel.ts` imports `compareStageRank()` and `isTerminalKind()`.

**Guest, CSP:** no change.

**Tests:** an outcome lane placed early on the board ranks last; the rate between two pipeline lanes; no rate into or out of a terminal lane; no rate when the next lane has more cards; no division by zero.

**Acceptance**

- The advance rates equal 100 minus the old drop-off percentages, for every pair the old chart showed on `dev`.
- The page has two fewer charts and the reached counts are unchanged.

Done in PR #33:

- Changed from the plan after Fable's review: the plan's `reached(next) / reached(this)` is the share that went on only when every card passes every lane; a card added mid-pipeline or a skipped lane inflates it (in the review's data, "66.7% on" from a lane where no card went on). `buildFunnel()` in the new `src/lib/funnel.ts` instead counts, per lane, the cards that reached it and also reached any pipeline lane ranked after it. It runs on the server over each application's visited lanes (the reached query now returns the visits), ranks with `compareStageRank()`, and gives no share for outcome lanes, the last pipeline lane or a lane nobody reached. Tested in `tests/funnel.test.mjs`, including the mid-pipeline and skipped-lane cases.
- One chart, "How Far Applications Got": a bar per lane with "30 · 13.3% further" beside it and the full sentence in the tooltip. It sits next to "Applications by Stage". "Pipeline Drop-off" and "Stage-to-Stage Conversion" are gone, with `stagePairs` and its query; per-pair detail stays on `/sankey`.
- On `dev` the reached counts are unchanged and each share matches a hand count in SQL. Every card there started in "Applied", so the shares also equal 100 minus the old drop-off; the plan's acceptance check no longer holds in general, by design.

### 2.3 Applications over time, by week (R-2)

**Goal:** a chart that stays readable once the total grows.

**Scope**

- Weekly bars for applications sent, with the cumulative total as a line on a second axis.
- Bucket by the applied date instead of `created_at` (decision 7). Cards not sent yet are not counted. The fix plan left this chart on `created_at`; with the rates counted from the applied date, the two should agree.
- Weeks start on Monday (decision 8), in the viewer's time zone: `date_trunc('week', applied_at AT TIME ZONE zone)::date`.
- Weeks without applications appear as empty bars. Fill the gaps in TypeScript with date-only arithmetic on `YYYY-MM-DD` strings.
- Payload: `applicationsOverTime: { weekStart, sent, cumulative }[]` replaces the daily rows.

**Files**

- New: `src/lib/weeks.ts` (gap filling and week arithmetic on date strings; no runtime imports), `tests/weeks.test.mjs`.
- Changed: `src/lib/stats-statements.ts`, `src/lib/db/stats.ts`, `src/lib/types.ts`, `src/components/stats-charts.tsx`, `tests/stats-statements.test.mjs`, `package.json` (`verify:weeks`).
- Docs: `AGENTS.md` (Commands, Key modules), `docs/ARCHITECTURE.md` (Source layout, Time zones, Verification).

**Domain rules touched**

- The applied date comes from `application_applied_at`.
- Dates and zones: the week start is a `YYYY-MM-DD` string from SQL (`to_char`), never parsed with `new Date(string)`; labels pin locale and zone.

**Tests**

- Statement on PGlite: an application sent on a Sunday at 23:30 UTC falls in the following week for a zone east of UTC and in the same week for UTC; a week boundary across a daylight-saving change.
- `weeks.test.mjs`: gap filling across a month end and a year end; one week; no weeks.

**Acceptance**

- The cumulative line ends at the number of sent applications.
- The production data has no intake lane, so the total equals the old chart's total there.
- Changing the `tz` cookie moves an application sent near midnight on Sunday to the other week.

Done in PR #34:

- `weeklySentStatement(zone)` in `src/lib/stats-statements.ts` counts applications by the week of their applied date, `date_trunc('week', applied_at AT TIME ZONE zone)`, returned as a `YYYY-MM-DD` Monday. It replaces the daily `created_at` buckets; `applicationsOverTime` is now `{ weekStart, sent }[]`.
- `fillWeeks()` in the new `src/lib/weeks.ts` fills the gaps on the page, where `now` is known, and runs on to the current week, so a quiet stretch shows as empty weeks (an addition to the plan).
- "Applications Sent per Week": bars per week and a "Total sent" line on a second axis; the tooltip reads "Week of Sep 28".
- Tests: `tests/weeks.test.mjs` (Monday starts, month and year ends, gap filling, the current week, one and no weeks), and in `tests/milestones.test.mjs` the statement for a Sunday-night application east of UTC, across Berlin's clock change, and a card not sent yet.
- On `dev` the running total ends at 30, the number of sent applications, over 13 weeks with applications between February and September.

---

## Phase 3: new metrics

All of them read `application_milestones` and count from `applied_at`. All of them describe where applications stand on their current path.

### 3.1 Time to hear back (M-2)

**Goal:** how long a reply takes, as a median.

**Scope**

- Two figures: median days from applying to the first response (`responded_at - applied_at`), and median days from applying to a rejection (`rejected_at - applied_at`).
- `percentile_cont(0.5) WITHIN GROUP (ORDER BY ...)` over cards where both timestamps exist.
- Each figure shows its sample size. Below 5 cards it shows "—" and "not enough data yet" (decision 9).
- Shown as two tiles or one small card next to the rate tiles; the implementer chooses what fits the layout from 2.1.
- `STALE_THRESHOLD_DAYS` stays a fixed 14. The audit's idea of deriving it from this median is not part of this step (see "Out of scope").

**Files**

- Changed: `src/lib/stats-statements.ts`, `src/lib/db/stats.ts`, `src/lib/types.ts` (`StatsPayload.timeToHearBack`), `src/components/stats-charts.tsx`, `tests/stats-statements.test.mjs`.
- Docs: `docs/ARCHITECTURE.md` (Derived values).

**Domain rules touched:** the applied date; the current path. The driver returns `double precision` as a number and `numeric` as a string; cast the median to `double precision` and say so in the row type.

**Tests:** an odd and an even number of cards; cards with `responded` true but no timestamp are left out; no cards gives `NULL`, not zero; an outlier of 120 days does not move the median of the rest.

**Acceptance:** the medians on `dev` match a hand calculation from a read-only query.

Done in PR #35:

- `timeToHearBackStatement()` in `src/lib/stats-statements.ts`: `percentile_cont(0.5)` of `responded_at - applied_at` and of `rejected_at - applied_at` in days, cast to `double precision`, with the count of each; cards whose reply time is unknown are left out, and so is a rejection dated before the sending (possible after a lane the card passed becomes a rejected lane; found in Fable's review).
- Two tiles, "Days to First Reply" and "Days to Rejection", with "Median of N"; below 5 applications (`MEDIAN_MIN_SAMPLE` in `constants.ts`, decision 9) they show "—" and "Not enough data yet (N of 5)". The tiles are now two rows of five.
- The statement tests moved to their own file, `tests/stats-statements.test.mjs` (`verify:stats-statements`), sharing the PGlite board with `tests/milestones.test.mjs` through `tests/helpers/pglite-board.mjs`. New: odd and even counts, an outlier, rejections as their own median and as replies, an unknown reply time, no data giving `NULL`, and after Fable's review: days counted from the sending of a wishlist card, a median of three rejections, a reply before the rejection, a card never sent, and a rejection dated before the sending.
- On `dev` both medians are 59.8 days over 14 applications (every reply there so far is a rejection), matching a hand calculation from the raw rows.

### 3.2 Results by application week (M-3)

**Goal:** see whether a change of CV, target roles or approach made a difference.

**Scope**

- One row per week of `applied_at` (same week rule as 2.3): applications sent, and the share that got a response, reached an interview and got an offer.
- A grouped bar chart or a table with bars; a table reads better with few applications per week. Show the counts, not only percentages: a week with two applications is 0, 50 or 100 percent.
- A week is marked "still open" while its last day is less than N days ago, where N is the median days to a response from 3.1, rounded up, or `STALE_THRESHOLD_DAYS` while that median has too small a sample. Open weeks are drawn lighter and labelled.
- The mark is computed by a pure function from the week start, N and the `now` prop.

**Files**

- Changed: `src/lib/stats-statements.ts`, `src/lib/db/stats.ts`, `src/lib/types.ts` (`StatsPayload.cohorts`), `src/lib/weeks.ts` (`isWeekOpen()`), `src/components/stats-charts.tsx`, `tests/stats-statements.test.mjs`, `tests/weeks.test.mjs`.
- Docs: `docs/ARCHITECTURE.md` (Derived values).

**Domain rules touched:** the applied date; dates and zones (week starts are strings; "today" comes from `todayInTimeZone()` with the page's `now`).

**Tests:** cohort counts over three weeks with mixed outcomes; a card not sent yet is in no week; `isWeekOpen()` on the boundary day, for a fixed `now` and zone.

**Acceptance**

- The sum of "sent" over all weeks equals the denominator of the rate tiles.
- The weekly rates, weighted by their counts, reproduce the rate tiles.
- The newest week is marked open.

Done in PR #36:

- The weekly statement from 2.3 now also counts, per week, the applications that replied, reached an interview and got an offer (`weeklyStatement()`, over `application_milestones`), so one query serves the chart and the table. The payload field is `weeks` (was `applicationsOverTime`).
- "Results by Week Sent": a table, newest week first, with "N (P%)" and a small bar per figure. `isWeekOpen()` in `weeks.ts` marks a week "still open" while fewer than N days have passed since its Sunday, with N the median days to a first reply rounded up, or `STALE_THRESHOLD_DAYS` below `MEDIAN_MIN_SAMPLE`; open weeks are dimmed, and the subtitle says which N applies.
- On `dev` the weeks add up to the tiles exactly (30 sent, 14 replied, 3 interviewed, 0 offers). With a 59.8-day median, N is 60 and the five newest weeks are open.
- Tests: the per-week counts over three weeks (a closed card is not a reply; an unsent card is in no week) and `isWeekOpen()` on its boundary day.

### 3.3 Results by source (M-4)

**Goal:** see which channels lead to replies.

**Scope**

- Group sent applications by the host of `source_url` and show, per group, the count and the response, interview and offer rates.
- The host is taken with `new URL()` in TypeScript on the server, lower-cased, without a leading `www.`. The grouping runs in `getStatsData()`, so the page receives aggregates only.
- Hosts with fewer than 3 applications are summed into "Other" (decision 10). Applications without a link, or with one that does not parse, go into "Unknown".
- Sorted by count, "Other" and "Unknown" last.
- Known limit: sub-domains are separate hosts (a country sub-domain of a job board is its own row). Folding them needs a public-suffix list, which is not worth a dependency here.

**Data:** one statement returning, per sent application, `source_url` and the three booleans from the view. No migration.

**Files**

- New: `src/lib/sources.ts` (host extraction and grouping; no runtime imports), `tests/sources.test.mjs`.
- Changed: `src/lib/stats-statements.ts`, `src/lib/db/stats.ts`, `src/lib/types.ts` (`StatsPayload.sources`), `src/components/stats-charts.tsx`, `package.json` (`verify:sources`).
- Docs: `AGENTS.md` (Commands, Key modules), `docs/ARCHITECTURE.md` (Source layout, Verification).

**Guest and notes:** a host can name a company's careers site. The guest already sees every company name and link on the board, so this shows nothing new. No notes are read.

**CSP:** none. Hosts are rendered as text, not as links or images.

**Analytics:** no event carries a host.

**Tests:** `www.` removed; upper case; a port; a link without a host; an unparsable value; the "Other" threshold on its boundary; rates per group; an empty input.

**Acceptance:** the group counts add up to the number of sent applications, and the rows match a hand count on `dev`.

Done in PR #37:

- `sourceApplicationsStatement()` returns each sent application's link and flags; `groupBySource()` in the new `src/lib/sources.ts` turns them into per-host counts in `getStatsData()`, so the page receives totals only (`StatsPayload.sources`).
- "Results by Source": the same table as results by week (source, sent, replied, interview, offer), hosts as plain text.
- Neither `dev` nor production has a job link on any application yet, so on the owner's data every card is "Unknown"; the card then says so and asks for links instead of showing one "Unknown" row. With four temporary cards on `dev` the table showed a host group of 3 and "Other", then the cards were removed.
- Tests: `tests/sources.test.mjs` (host rules, the threshold on its boundary, ordering, totals, empty) and a statement test (unsent cards left out).

### 3.4 Date range filter (M-5)

**Goal:** look at the last 30 or 90 days only.

**Scope**

- A control on the stats page: 30 days, 90 days, all time (decision 11). The choice lives in the URL (`/?range=30`), so a reload and a shared link keep it; "all time" is the default and has no parameter.
- The page reads `searchParams` and maps the value through an allowlist; anything else means "all time". Read the guide for page `searchParams` in `node_modules/next/dist/docs/` first: in this Next version it is a promise.
- A range means "applications sent in this period": `applied_at >= now - N days`. Cards not sent yet appear only under "all time".
- `getStatsData(timeZone, { now, rangeDays })`; every ranged statement takes the start as a parameter (`NULL` for all time).

| Follows the range | Always shows the present |
|---|---|
| Total applications (label becomes "Sent in the last N days") | Applications by stage |
| Rate tiles, time to hear back | Upcoming interviews |
| Funnel, where applications ended | Stale applications, stale count |
| Applications over time, results by week (the weeks inside the range) | Average days in current stage |
| Results by source, companies with multiple applications | |
| Average days to interview | |

- The cards that always show the present say so in their hint while a range is active.

**Files**

- Changed: `src/app/page.tsx`, `src/lib/db/stats.ts`, `src/lib/stats-statements.ts` (the ranged queries that are still inline in `stats.ts` move here), `src/lib/types.ts`, `src/components/stats-charts.tsx`, `tests/stats-statements.test.mjs`.
- New: `src/lib/stats-range.ts` (the allowlist and labels), and a test for it in `tests/stats-statements.test.mjs` or its own file.
- Docs: `docs/ARCHITECTURE.md` (Routes: the page's parameter).

**Domain rules touched:** the applied date; the funnel keeps reading `application_entry_stage` and lane ids and only gains a filter on the application.

**Guest:** the control works for the guest.

**CSP:** none. The control is a set of links or a router push to the same page.

**Tests:** each ranged statement with a start of `NULL`, 30 and 90 days over cards sent 10, 60 and 200 days before a fixed `now`; an unsent card appears only without a range; the allowlist rejects `range=7`, `range=-1`, `range=all%20` and an array value.

**Acceptance**

- "All time" shows exactly the numbers from before this step.
- The denominators under "30 days" equal a hand count.
- The stats page still makes one database request for any range.

Done in PR #38:

- `src/lib/stats-range.ts`: `parseStatsRange()` accepts exactly `"30"` and `"90"`; anything else, an array included, is all time. `rangeStart()` gives the instant `range` days before the page's `now`. The page reads `searchParams` (a promise in this Next version).
- Every ranged statement takes `start` (`NULL` for all time) through one `sentSince()` fragment. The three queries still inline in `stats.ts` (visits, repeat companies, outcomes) moved to `stats-statements.ts` with it. Under all time they keep counting cards not sent yet, as before; under a range such a card drops out.
- A second, all-time run of the median statement sets how long a week stays open (as Fable advised: a 30-day range rarely holds five replies), sent as `openWeeks`. `scopeTotal` is the number of applications the ranged figures cover, used by the first tile ("Sent in the Last 30 Days") and the outcome chips.
- The control is three links above the tiles, with `aria-current` on the active one; while a range is on, a line explains it and the lane, upcoming and stale cards and tiles say "now, whatever the date range". The weekly chart starts at the range's first week.
- On `dev`: all time is identical to before this step; the last 30 and 90 days hold 11 and 18 sent applications, matching a hand count; lane counts and stale applications are the same under every range; `?range=7` shows all time. The stats page still makes one request.

---

## Phase 4: acting on what the stats show

### 4.1 Actions on stale applications (F-1)

**Goal:** deal with a stale application from the list that reports it.

**Scope**

- Each row of the stale list on the stats page gets, for the owner:
  - **Followed up**: records the moment and restarts the stale clock.
  - **Snooze 7 days**: hides the row and the card's stale marker until then.
  - **Close**: moves the card to the first lane of kind `closed` by board order, through `PATCH /api/applications/:id/status` with `expectedStageId`. Hidden when the board has no such lane.
- After an action the page reloads its data with `router.refresh()`; a 409 shows the usual "moved elsewhere" message.
- The board uses the same rule for its stale marker and shows "Followed up 3d ago" on the card. The actions themselves are on the stats page only in this step (decision 12).

**Data**

Two nullable columns on `applications` and one view. Columns, because a follow-up and a snooze are new facts that nothing else records.

```sql
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS followed_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snoozed_until  TIMESTAMPTZ;

CREATE OR REPLACE VIEW application_stale_clock AS
SELECT a.id AS application_id,
       GREATEST(e.entered_at, a.followed_up_at) AS clock_started_at,
       a.followed_up_at,
       a.snoozed_until
FROM applications a
JOIN application_stage_entry e ON e.application_id = a.id;
```

This differs from the audit, which proposed one `next_action_date DATE`:

- One date cannot hold both "when did I follow up" and "hide until". The first is worth showing on the card.
- A date column would have to be cleared by every move, in both `updateSet` fragments of the move. With `GREATEST(entered_at, followed_up_at)`, a follow-up made in an earlier lane is ignored once the card enters a new one, and the move statement does not change. A snooze lasts 7 days and a lane needs 14 to go stale, so an old snooze cannot hide a new lane's staleness.
- Both values are instants set by the server, so there is no "today in which zone" question. `interview_date` stays the only `DATE`.

`GREATEST` ignores `NULL` in Postgres, which the view relies on; the test pins it.

**Rule**

- Stale: the lane's kind can go stale, `now - clock_started_at >= STALE_THRESHOLD_DAYS`, and `snoozed_until` is `NULL` or not after `now`.
- The rule exists in SQL (the stale list) and in `isApplicationStale()` (the board). Both read the view's values; `Application` gains `staleClockAt`, `followedUpAt` and `snoozedUntil`.
- "Average days in current stage" keeps reading `application_stage_entry`: a follow-up does not change how long the card has been in the lane.

**API**

- `PATCH /api/applications/:id/follow-up` with `{ action: "followed_up" | "snooze" | "clear" }` (`requiredEnum`). The server sets the times: `followed_up_at = now`, `snoozed_until = now + 7 days`; `clear` sets both to `NULL`.
- Returns the application. 404 for an unknown card.
- It does not touch `updated_at`, which orders the board: recording a follow-up must not move the card to the top of its lane.
- The stale list rows gain `id` and `stageId`, and the payload gains `closeStageId` (or `null`).

**Files**

- New: the migration `<next>_stale-actions.mjs`, `src/app/api/applications/[id]/follow-up/route.ts`, `src/components/stale-actions.tsx`, `tests/stale-clock.test.mjs`.
- Changed: `src/lib/db/schema-version.ts`, `src/lib/db/applications.ts` (both copies of the select, and the new write), `src/lib/db/rows.ts`, `src/lib/db/stats.ts`, `src/lib/application-statements.ts`, `src/lib/types.ts`, `src/lib/constants.ts`, `src/app/page.tsx` (passes `readOnly`), `src/components/stats-charts.tsx`, `src/components/kanban-board.tsx`, `src/lib/analytics.ts` (`stale_action` with the action name), `tests/rows.test.mjs`, `tests/schema.test.mjs`, `package.json` (`verify:stale-clock`).
- Docs: `AGENTS.md` (Commands; Domain rules: "the stale clock comes from the view `application_stale_clock`", and adjust the line about `application_stage_entry`, which stays the source for time in lane), `docs/ARCHITECTURE.md` (Tables, migration notes, Derived values: Stale, Routes, Verification), `README.md`, `ROADMAP.md`.

**Domain rules touched**

- When a card entered its lane comes from `application_stage_entry`; the new view builds on it instead of repeating it.
- Staleness excludes `STALE_EXCLUDED_KINDS`, by name of the constant.
- Stage moves need `expectedStageId`; Close uses the normal move, so a terminal target is a forward move and history is appended.
- After a rewind `entered_at` goes back to the kept edge's time. A follow-up made since then is later than it, so it still counts.
- Relative ages take the `now` prop.

**Guest and notes**

- The guest sees the same stale list and markers as the owner, computed with the same clock, and none of the actions.
- `followedUpAt` and `snoozedUntil` are not redacted: they are needed to compute the marker and say nothing the stale state does not.
- The route calls `requireSession({ write: true })`; the proxy blocks the `PATCH` as well.

**CSP:** none.

**Tests**

- `stale-clock.test.mjs` (PGlite): no follow-up gives the lane entry time; a follow-up after entry gives the follow-up time; a follow-up before the latest lane entry is ignored; a rewind keeps a later follow-up; the stale statement leaves out a snoozed card and includes it again once `now` passes the snooze; terminal and intake lanes never appear.
- The twin: `isApplicationStale()` and the SQL agree on each scenario above for a fixed `now`.
- `rows.test.mjs`: the three new fields map, and are present for a guest.
- `schema.test.mjs`: the migration re-runs safely.

**Acceptance**

- "Followed up" removes the row, the stale tile drops by one, and the card on the board loses its marker and shows the follow-up age.
- "Snooze" removes the row; with the clock moved 8 days forward in a test the card is stale again.
- "Close" moves the card, the Sankey shows the new edge, and the card's timeline (1.1) ends in the closed lane.
- With no `closed` lane on the board the Close button is absent.
- On `dev`, before any action is used, the stale list equals the list from before this step.

Done in PR #39:

- Migration `1730000019000`: `followed_up_at`, `snoozed_until` and the view `application_stale_clock`, as planned.
- The stale rule moved to the new `src/lib/stale.ts` (loadable from Node; `constants.ts` re-exports it) and reads the clock and the snooze; its SQL twin is `staleApplicationsStatement(now, threshold)` in `stats-statements.ts`, which takes the page's `now` instead of `NOW()`. The stale list rows carry `id`, `stageId` and `followedUpAt`; the payload carries `closeStageId`.
- `PATCH /api/applications/:id/follow-up` with `followed_up`, `snooze`, `unsnooze` or `unfollow`; the write is `staleActionStatement()` in `application-statements.ts`. A follow-up also ends a snooze (a fresh start); a snooze keeps the follow-up.
- The stale list's rows get "Followed up", "Snooze 7 days" and "Close" for the owner (`StaleActions`); Close is the normal stage move into the first closed lane, with the row's lane as `expectedStageId`. Board cards show "Followed up today / Nd ago" while that follow-up drives the clock.
- Checked on `dev` with three backdated temporary cards: the tile went 3, 2, 1, 0 as each was followed up, snoozed and closed; the closed card's timeline ends in the closed lane; neither card keeps a stale marker; the guest sees the list without buttons; the API answers 404, 400, 403 and 401 where it should. The cards were removed.
- `tests/stale-clock.test.mjs`: every scenario of the plan, the SQL and TypeScript rules compared on each, the inclusive threshold, and the follow-up statement (including `updated_at` untouched).
- After Fable's review: the buttons' accessible names include the company; focus moves to the list's heading after an action; a 404 (card deleted meanwhile) refreshes like a 409; a follow-up or a snooze can be undone from the toast; a snoozed card shows "Snoozed until <date>" on the board; the card's follow-up and snooze lines use `isStaleEligibleStage()`; Close's message names the lane (`closeStage` in the payload).
- The planned `clear` (both fields) became two undos that touch one field each, after Fable's re-check found that undoing a snooze erased an earlier follow-up: `unsnooze` keeps the follow-up, and `unfollow` is offered only when the row had no follow-up before, since it cannot bring an older one back.

### 4.2 Close ghosted applications in bulk (F-2)

**Goal:** clear out applications that will never get a reply, in one confirmed action.

**Scope**

- A button on the stats page near the stale list, owner only: "Close ghosted applications…". Hidden when the board has no `closed` lane.
- A dialog with a number field "No reply after N days", default 21 (decision 13); the median from 3.1 is shown next to it as a hint. The list below updates as N changes.
- Candidates: sent, `responded` false, currently in a lane whose kind can go stale, sent at least N days ago, and not snoozed.
- Every row has a checkbox, ticked by default. One confirmation moves the ticked cards.
- The browser sends the existing `PATCH /api/applications/:id/status` once per card, one after another, each with the card's `expectedStageId`. A 409 or 404 on one card is reported and does not stop the rest. At most 50 cards per run.
- The result toast gives the number moved and the number skipped; then `router.refresh()`.

**Why no bulk endpoint:** Neon's HTTP transaction takes a fixed list of statements and cannot roll back on a statement's result, so a bulk endpoint could not be atomic on a conflict either. Reusing the single move keeps one write path, the rewind rule untouched and the history correct by construction. Fifty sequential requests take a few seconds.

**Data:** no migration. The payload gains `ghostCandidates: { id, stageId, company, role, stageName, daysSinceApplied }[]`, from a statement over `application_milestones` and `application_stale_clock`. The list holds every candidate from 14 days up; the dialog filters by N.

**Files**

- New: `src/components/close-ghosted-dialog.tsx`.
- Changed: `src/lib/stats-statements.ts`, `src/lib/db/stats.ts`, `src/lib/types.ts`, `src/components/stats-charts.tsx`, `src/lib/analytics.ts` (`ghosted_closed` with `count` and `days`), `tests/stats-statements.test.mjs`.
- Docs: `docs/ARCHITECTURE.md` (Derived values), `README.md`, `ROADMAP.md`.

**Domain rules touched**

- Moves need `expectedStageId`; a mismatch is a 409, reported per card.
- A move into a `closed` lane is a forward move and never truncates history.
- The target lane is chosen by kind.

**Guest and notes:** the candidates hold no notes. The guest receives the list (it is part of the stats payload) but no button; if that is unwanted, leave the field out for a guest in `getStatsData()`, which then needs the viewer's role.

**CSP:** none.

**Tests:** the candidate statement over cards sent 10, 20 and 40 days ago; a card that got a reply, a snoozed card, a card in an intake lane and a card already in an outcome lane are never candidates; a card followed up yesterday is still a candidate (a follow-up is not a reply) but its row shows the follow-up.

**Acceptance**

- The dialog's list for N = 21 equals a hand count on `dev`.
- After confirming, every moved card has one new edge into the closed lane, the ghosted rate rises accordingly, and the stale list no longer shows them.
- Moving one of the cards in another tab before confirming reports that card as skipped and moves the others.

Done in PR #40:

- `ghostCandidatesStatement(now, 14)` in `stats-statements.ts`: sent, `NOT responded`, in a lane that can go stale, not snoozed past the page's `now`, longest wait first; a followed-up card stays a candidate and its row says so. `StatsPayload.ghostCandidates` is empty for the guest (`getStatsData()` now takes the viewer's role).
- `CloseGhostedDialog`, opened from "Close ghosted applications…" next to the stale list's heading; the button is there for the owner when the board has a closed lane and there is at least one candidate. The field "No reply after this many days" starts at 21 (decision 13), cannot go below 14, and keeps what is typed until it loses focus; the all-time median to a first reply is shown as the hint when it rests on enough replies. Every row is ticked, with the company in its checkbox's name. One click moves the ticked cards one by one through `PATCH .../status`, at most 50 per run, with a progress line; a card that was moved or deleted meanwhile is skipped and named in the result.
- Checked on `dev`: there are no candidates there (hand count 0), so the button is hidden. With three temporary cards sent 400 days ago and N = 365: one unticked, one moved in another tab before the confirmation; the result was "1 application moved to Ghosting. Skipped …: <the moved one>", the moved card's path reads Applied → Ghosting, and the unticked one stayed. The guest has no button. The cards were removed.
- Tests: the candidate statement in `tests/stale-clock.test.mjs` (too recent, replied, snoozed, never sent and already closed cards left out; a followed-up card kept with its follow-up).

---

## Phase 5: more fields, calendar, optional CSV

5.1 and 5.2 are built last (decisions 14 and 16). 5.3 and 5.4 are optional (decision 19).

### 5.1 Optional fields: referral, location, salary (F-6)

**Goal:** record three more facts and split the rates by two of them.

**Data**

```sql
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS referral  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS work_mode TEXT,
  ADD COLUMN IF NOT EXISTS location  TEXT,
  ADD COLUMN IF NOT EXISTS salary    TEXT;
-- guarded, as in 1730000009000:
--   work_mode IN ('remote', 'hybrid', 'onsite')
--   btrim(location) <> ''   and   btrim(salary) <> ''   when set
```

- Columns, since these are facts the owner types.
- `salary` is free text, at most 100 characters (decision 15). Ranges, currencies, gross or net and per month or per year differ between postings, and the plan has no chart that needs a number.
- `work_mode` values live in one constant next to the limits, used by the form, the API (`optionalEnum`) and the test that compares it with the check constraint.

**Scope**

- The three inputs in the add and edit dialogs, all optional.
- `POST` and `PUT /api/applications` accept `referral`, `workMode`, `location`, `salary`. `PUT` is a full replacement, so a body without them clears them; the edit dialog always sends them.
- The card shows a small referral mark and the work mode. Salary appears in the edit dialog only.
- Stats: one table "Results by referral and work mode" with the count and the three rates per group, built like 3.3.
- If 5.4 or 5.3 is built, the export gains the four columns at the end and the import accepts them as optional columns; whichever step comes later adds them.

**Guest and notes**

- **Salary is owner-only, like notes.** `mapApplication()` returns `salary: null` for a guest. That function stays the only place where an application is built for a viewer.
- Salary never enters the stats payload, the timeline, an analytics event or a log line.
- Referral, work mode and location are visible to the guest (decision 15 covers salary only).
- The guest details dialog from 1.1 shows no salary field.

**Files**

- New: the migration `<next>_application-optional-fields.mjs`.
- Changed: `src/lib/db/schema-version.ts`, `src/lib/db/applications.ts` (both selects, the insert, the update's `updateSet`), `src/lib/db/rows.ts`, `src/lib/application-statements.ts`, `src/lib/types.ts`, `src/lib/limits.ts`, `src/lib/api-validation.ts` (`optionalBoolean`), both application routes, both dialogs, `src/components/kanban-board.tsx`, `src/lib/stats-statements.ts`, `src/lib/db/stats.ts`, `src/components/stats-charts.tsx`, `tests/rows.test.mjs`, `tests/schema.test.mjs`, `tests/stats-statements.test.mjs`. If 5.3 or 5.4 exists: `src/lib/import-rows.ts`, `src/lib/export-rows.ts` and their tests.
- Docs: `AGENTS.md` (Domain rules: extend "Notes are owner-only" to salary), `docs/ARCHITECTURE.md` (Tables, Routes, What the app does: "except notes and salary"), `README.md` (the guest paragraph).

**Domain rules touched:** notes visibility, now with a second field; snake_case columns cast once and mapped in `rows.ts`.

**CSP:** none.

**Tests**

- `rows.test.mjs`: the owner sees the salary, a guest never does; the other three fields map for both.
- `schema.test.mjs`: the check constraints; the migration re-runs safely; existing rows get `referral = false`.
- The move statement with the extended `updateSet` still passes every scenario in `stage-statements.test.mjs`.
- Stats: rates per referral and per work mode; cards without a work mode form their own group.

**Acceptance**

- Signed in as guest, the response of `GET /api/applications` and the board page's HTML contain no salary text (search both for a marker value set on `dev`).
- An edit that changes only the salary does not change the lane, the history or the logo.
- If 5.3 and 5.4 are both built: an export followed by an import into an empty `dev` database keeps the four fields.

### 5.2 Calendar export for interviews (F-7)

**Goal:** put an interview into a calendar with one click.

**Data**

```sql
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS interview_time      TIME,
  ADD COLUMN IF NOT EXISTS interview_time_zone TEXT;
-- guarded checks:
--   (interview_time IS NULL) = (interview_time_zone IS NULL)
--   interview_time IS NULL OR interview_date IS NOT NULL
```

- `interview_date` stays a `DATE` and keeps driving "upcoming interviews" and the card label. The time and its zone are separate, as the audit asks.
- The zone is an IANA name. The form fills it with the viewer's zone and lets the owner change it.
- The instant is computed by Postgres, `(interview_date + interview_time) AT TIME ZONE interview_time_zone`, so daylight saving is handled by the database and tested on PGlite. No date library and no `new Date(string)`.

**Scope**

- An optional time input next to the interview date in both dialogs. `interviewTime` is `HH:MM`, validated by a new `optionalTime()`; the zone goes through `isValidTimeZone()`. A zone Postgres does not know is answered with 400.
- `GET /api/applications/:id/interview.ics`, owner only (`requireSession({ owner: true })`; add that option to `requireSession()` here if 5.4 has not, as described under 5.4 **Auth**). 404 when the card has no interview date.
- Without a time: an all-day event (`DTSTART;VALUE=DATE`). With a time: `DTSTART` in UTC and a duration of 60 minutes (decision 17).
- `SUMMARY` is "Interview: company, role". `URL` is the job link when there is one. **No notes** in the file: a calendar is often shared or synced to other services.
- A pure `src/lib/ics.ts` writes the file: CRLF, lines folded at 75 octets, commas, semicolons, backslashes and line breaks escaped, a stable `UID` from the application id and the request's host, `DTSTAMP` from `now`.
- An "Add to calendar" link on the card and in the upcoming interviews list, owner only.
- Headers: `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment`, `Cache-Control: no-store`.

**Files**

- New: the migration `<next>_interview-time.mjs`, `src/lib/ics.ts`, `src/app/api/applications/[id]/interview.ics/route.ts`, `tests/ics.test.mjs`.
- Changed: `src/lib/db/schema-version.ts`, `src/lib/db/applications.ts`, `src/lib/db/rows.ts`, `src/lib/application-statements.ts`, `src/lib/types.ts`, `src/lib/api-validation.ts`, both application routes, both dialogs, `src/components/kanban-board.tsx`, `src/components/stats-charts.tsx`, `src/lib/db/stats.ts` (the upcoming rows need the id), `src/lib/auth.ts` (the `owner` option, if not there yet), `tests/schema.test.mjs`, `package.json` (`verify:ics`).
- Docs: `AGENTS.md` (Commands; Domain rules: extend "Dates and zones" with the time and its zone; Request pipeline: the `owner` option, if added here), `docs/ARCHITECTURE.md` (Tables, Routes, Time zones, Verification; Authentication, if the option is added here), `README.md`.

**Domain rules touched:** `interview_date` is handled as a `YYYY-MM-DD` string; `interview_time` likewise as a string from the database to the form.

**Guest and notes:** the guest sees the interview time on the card, as the date today, and no calendar link. The file never holds notes or salary.

**CSP:** none. A same-origin download; check the Vercel preview.

**Tests**

- `ics.test.mjs`: an all-day event; a timed event; folding of a long summary with multi-byte characters (fold on octets, not characters, and never inside a character); escaping; CRLF everywhere.
- PGlite: the instant for a time in a zone on both sides of a daylight-saving change; the two check constraints; the migration re-runs safely.

**Acceptance**

- The file imports into two different calendar applications at the right local time.
- An interview on the day of a daylight-saving change lands at the entered wall-clock time.
- A card without a time gives an all-day event on the interview date.
- Signed in as guest, the URL answers 403.

### 5.3 Bulk import from CSV (IMP, optional)

**Goal:** add many applications in one go, with a preview before anything is saved.

**Scope**

- An "Import CSV" button next to "Add Application" on the board, owner only.
- The browser reads the file (`File.text()`), parses it and shows a preview table. Nothing is sent until the owner confirms.
- Columns `company, role, source_url, notes`. A header row is required; names are matched after trimming and lower-casing; unknown columns are ignored and listed in the preview as ignored. `company` and `role` are required.
- The delimiter is detected from the header line: comma, semicolon or tab (decision 1). Quoted fields, doubled quotes, line breaks inside quotes, CRLF and a leading byte-order mark are handled.
- Each row is validated in the browser with the same rules as the API: required fields, `TEXT_LIMITS`, `source_url` must be http or https. Invalid rows are shown with the reason and are not sent.
- Duplicate check per row, with the rule of `applicationsForCompany()` (trimmed, any case): against the cards on the board and against earlier rows of the same file. Duplicates are marked in the preview and unticked by default; the owner can tick them (decision 2).
- Limits: 200 rows per file and 1 MB per file (decision 3), in `src/lib/limits.ts` as `IMPORT_LIMITS`.
- `POST /api/applications/import` with `{ rows: [{ company, role, sourceUrl?, notes? }] }`. It validates every row again. If any row is invalid it inserts nothing and answers 400 with `{ message, errors: [{ row, message }] }`; the browser has already filtered, so this only happens when the two disagree. On success: 201 with `{ applications: Application[] }`.
- Every card lands in the default lane (`getDefaultCreateStage()`, which follows `DEFAULT_CREATE_KIND`). No lane column in the file.
- The result toast says how many were added and how many rows were skipped; the preview keeps the reason for each skipped row until the dialog is closed.

**Data**

- No migration.
- One `INSERT ... SELECT ... FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) WITH ORDINALITY` statement, so the import is atomic without a multi-statement transaction, and `RETURNING id` in file order. Built as `importApplicationsStatement(rows, stageId)` in `src/lib/application-statements.ts` (created in 1.1).
- The cards are then read back with the same select as `listApplications` uses, restricted to the new ids, so `stageEnteredAt` and `appliedAt` come from the views and not from a second derivation.
- A lane deleted between the lookup and the insert fails the foreign key; map it with `isStageForeignKeyViolation()` to 400, as `createApplication()` does.

**Logos**

- `scheduleLogoLookups()` in `src/lib/logo-lookup.ts`: one lookup per distinct company (trimmed, lower-cased), not per row, run inside one `after()` with at most 5 lookups at a time.
- A company that already has a card with a logo gets that logo copied in the insert statement and no lookup.
- A new `setCompanyLogo(company, logoUrl)` in `db/applications.ts` writes to every card of that company that still has no logo, without touching `updated_at`.
- A lookup that fails leaves the initial letter; the existing retry on edit still applies.

**Files**

- New: `src/lib/csv.ts` (parser and writer, no runtime imports; the writer may already exist from 5.4), `src/lib/import-rows.ts` (header mapping, row validation and duplicate marking as pure functions shared by the dialog and the route), `src/components/import-applications-dialog.tsx`, `src/app/api/applications/import/route.ts`, `tests/csv.test.mjs`, `tests/import.test.mjs`.
- Changed: `src/lib/application-statements.ts`, `src/lib/limits.ts`, `src/lib/db/applications.ts`, `src/lib/db/index.ts`, `src/lib/logo-lookup.ts`, `src/lib/analytics.ts` (`applications_imported` with `count` and `skipped`), `src/components/kanban-board.tsx`, `package.json` (`verify:csv`, `verify:import`).
- Docs: `AGENTS.md` (Commands: the two verify names; Key modules), `docs/ARCHITECTURE.md` (Routes, Source layout, Logo lookup, Verification), `README.md` (Features), `ROADMAP.md` (move to Shipped).

**Domain rules touched**

- The default lane comes from `DEFAULT_CREATE_KIND`, never from a lane name or index.
- A card created in the default lane has no transition row; its entry lane and applied date come from the views. The import must not write to `application_transitions`.
- Notes are owner-only: the route is owner-only and its response is built with viewer `"user"`.

**Guest and notes:** the button is not rendered for a guest, the proxy blocks the `POST`, and the route calls `requireSession({ write: true })`.

**CSP:** none. The file is read in the browser and sent to the same origin.

**Tests**

- `csv.test.mjs`: quoted fields, doubled quotes, line breaks in quotes, CRLF and LF, byte-order mark, each delimiter, an unclosed quote (error with the line number), an empty file, a header only.
- `import.test.mjs`, pure part: header matching, missing required column, over-long values, a bad URL, duplicates inside the file, the row limit.
- `import.test.mjs`, PGlite part: the statement inserts N rows in file order in the given lane; `NULL` for empty optional values; a blank company fails the check constraint and inserts nothing; an unknown lane fails the foreign key; a company with an existing logo copies it; no row appears in `application_transitions`; `application_applied_at` gives every new card its `created_at`.

**Acceptance**

- A file of 50 valid rows adds 50 cards to the default lane with one request, and the board shows them without a reload.
- A file with 3 invalid rows and 2 duplicates shows all 5 with reasons; confirming adds the rest and the toast reports the numbers.
- A file over the limits is refused in the browser with a message; a request over the limits is refused by the route.
- A semicolon-separated file exported by a spreadsheet loads.
- Signed in as guest: no button, and a hand-made `POST` gets 403.
- 20 rows for 4 companies cause 4 logo lookups at most (count the calls to `findCompanyLogo()` in a test with the function injected, or log them once during the manual check).

### 5.4 CSV export (F-5, optional)

**Goal:** one file with every application, for a spreadsheet or as a personal backup.

**Scope**

- `GET /api/applications/export`, owner only, since it contains notes.
- Columns, in this order: `company, role, source_url, notes, stage, stage_kind, applied_at, interview_date, created_at, updated_at`. The first four are the import's columns, so if 5.3 is built an export loads back through it.
- Timestamps are ISO 8601 in UTC; `interview_date` is `YYYY-MM-DD`; `applied_at` is empty for a card not sent yet.
- Comma-separated, CRLF line ends, a byte-order mark so that spreadsheets read UTF-8 (decision 5).
- Cells are written exactly as stored (decision 6).
- Headers: `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="applications-YYYY-MM-DD.csv"` with today's date in the viewer's zone, `Cache-Control: no-store`.
- An "Export CSV" link in the board toolbar, owner only.

**Data:** no migration. The rows come from `listApplications("user")`.

**Auth**

- The proxy only blocks a guest's non-GET requests, so the route is the authority here.
- Add an `owner` option to `requireSession()`, if 5.2 has not added it, that throws the same 403 for a guest, and use `requireSession({ owner: true })`. `{ write: true }` would work but would mislabel a read; the two options share one check.

**Files**

- New: `src/app/api/applications/export/route.ts`, `src/lib/export-rows.ts` (maps `Application[]` to rows; no runtime imports), `tests/export.test.mjs`.
- Changed or new: `src/lib/csv.ts` (the writer; created here if 5.3 is not built), `src/lib/auth.ts` (if 5.2 has not added the `owner` option), `src/components/kanban-board.tsx`, `src/lib/analytics.ts` (`applications_exported` with `count`), `tests/auth.test.mjs` only if the pure helpers change, `package.json` (`verify:export`).
- Docs: `AGENTS.md` (Commands; Request pipeline: the `owner` option), `docs/ARCHITECTURE.md` (Routes, Authentication, Verification), `README.md`, `ROADMAP.md`.

**Domain rules touched**

- Notes are owner-only.
- The applied date comes from `application_applied_at` (already on `Application` as `appliedAt`), not from `created_at`.
- `interview_date` stays a string from the database to the file.

**CSP:** none. The download is a same-origin navigation, and API responses carry no policy. Confirm on the Vercel preview that the download starts and the console stays clean.

**Tests**

- Writer, in `tests/csv.test.mjs` (`verify:csv`; created here if 5.3 is not built): a cell with a comma, a quote, a line break; an empty and a `null` cell; the byte-order mark; CRLF.
- Round trip, once the parser from 5.3 exists: `parse(write(rows))` returns the rows, for cells that start with `=`, `+`, `-` and `@` as well.
- `export-rows`: column order, a card without an applied date, the date-only column untouched.

**Acceptance**

- The file opens in a spreadsheet with diacritics intact and one row per card.
- If 5.3 is built: importing the exported file into an empty `dev` database (after `reset:db`, which only the owner runs) recreates every company, role, link and note.
- Signed in as guest: no link, and the URL answers 403.

---

## Out of scope or dropped

| Item | Why |
|---|---|
| Deriving `STALE_THRESHOLD_DAYS` from the M-2 median | The median moves with every reply, so the stale list would change without any card changing. Revisit once 3.1 has run on a few months of data. |
| An append-only record of undone moves | Owner decision 3 of the fix plan. The metrics here are defined on the current path, and the audit confirms that is enough. |
| A lane, a date or an "applied on" column in the import | 5.3 puts imported cards in the default lane. Setting `created_at` from a file would make the applied date editable history; if the owner wants to load past applications with their real dates, that is its own step with its own rules. |
| Import of the export's read-only columns (`stage`, `applied_at`, timestamps) | They are derived or set by the server. The export is a backup of the cards' content, not of the history. |
| A full backup including transitions | Neon branches and point-in-time restore cover the database. The CSV covers "my list of applications" outside it. |
| A bulk move endpoint | See 4.2. |
| Follow-up and snooze actions on board cards | Decision 12: stats page first. The card's menu is a Radix Select made for lanes; actions there need a different control. |
| Folding sub-domains into one source | Needs a public-suffix list. See 3.3. |
| Salary as numbers, salary statistics | Decision 15. |
| Several interviews per application, reminders, calendar subscriptions (a feed URL) | One `interview_date` per card today. A feed would need a token in a URL that works without a session, which is a new authentication path. |
| A stats API endpoint | The page is server-rendered and the range lives in the URL. |
| Touch drag and drop | Owner decision 4 of the fix plan. |
| Changes to Vercel settings, the firewall rule or environment variables | None needed by any step. |

## Decisions

Answered by the owner on 2026-09-29. Every recommendation was accepted except 13 (21 days instead of 30). Decisions 1, 2, 3, 5 and 6 stay open: they concern the optional CSV steps and are asked when those are built.

| # | Question | Recommended default | Decision |
|---|---|---|---|
| 1 | Import: comma only, or detect comma, semicolon and tab? (5.3) | Detect all three; spreadsheets in many locales write semicolons | Open (optional step) |
| 2 | Import: rows for a company that already has a card? (5.3) | Marked and unticked; the owner can tick them | Open (optional step) |
| 3 | Import limits? (5.3) | 200 rows and 1 MB per file | Open (optional step) |
| 4 | Timeline for the guest: a read-only details dialog, or owner only for now? (1.1) | Read-only details dialog, as the roadmap says "owner and guest alike" | Default |
| 5 | Export: byte-order mark for spreadsheets? (5.4) | Yes | Open (optional step) |
| 6 | Export: write cells exactly, or prefix cells that start with `=`, `+`, `-`, `@` so a spreadsheet does not read them as formulas? (5.4) | Exactly. Every cell is text the owner typed, and the file must load back unchanged | Open (optional step) |
| 7 | Applications over time: count by applied date or by creation date? (2.3) | Applied date, like every other metric | Default |
| 8 | First day of the week? (2.3, 3.2) | Monday | Default |
| 9 | Smallest sample for a median? (3.1) | 5 applications; below that the tile shows "—" | Default |
| 10 | Results by source: smallest group shown on its own? (3.3) | 3 applications; smaller hosts go to "Other" | Default |
| 11 | Date ranges? (3.4) | 30 days, 90 days, all time; all time by default | Default |
| 12 | Stale actions on the board cards too? (4.1) | No; stats page only, board later if missed | Default |
| 13 | Bulk close: default for "no reply after N days"? (4.2) | 30, with the median shown as a hint. The audit's default (the median itself) would close half of all eventual replies too early | **21 days** |
| 14 | Build the optional fields at all? (5.1) | Yes, after phases 1 to 4 | Default |
| 15 | Salary: free text or numbers? Visible to the guest? (5.1) | Free text, owner only. Referral, work mode and location visible to the guest | Default |
| 16 | Build the calendar export at all? (5.2) | Yes, last; skip it if interviews arrive as calendar invitations anyway | Default |
| 17 | Calendar: default length of a timed interview? Owner only? (5.2) | 60 minutes; owner only | Default |
| 18 | One PR per step, or R-1 and R-2 together with 2.1? (phase 2) | One PR per step; each is small and reviewed faster alone | Default |
| 19 | CSV import and export? (5.3, 5.4) | **Decided 2026-09-29:** not needed now, kept as optional steps. Decisions 1, 2, 3, 5 and 6 apply only if they are built | Optional |
