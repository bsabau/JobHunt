# Fix plan

Plan for the findings in `docs/AUDIT-2026-09-29.md`. IDs match that file. Phases 1 and 2 are implemented; each phase's section ends with what was actually done.

## Order and reasoning

| Phase | Goal | Findings | Size |
|---|---|---|---|
| 1 | Safety net before touching SQL | OPS-1, DB-3, TOOL-1, TEST-1 | 1 day |
| 2 | Schema fixes with no behaviour change | DB-2, DB-4, DB-5, DB-6, SQL-2, DB-8 | half a day |
| 3 | Reference lanes by id | DB-1, DB-7 | 1 to 2 days |
| 4 | Restructure the data layer | SQL-1, SQL-3 to SQL-9, ARCH-1, ARCH-2, API-1 | 1 to 2 days |
| 5 | API and UI polish | API-2, UI-1 to UI-5 | 1 day |
| 6 | Hardening and housekeeping | SEC-1 to SEC-3, DOC-1, TOOL-2 | half a day |

Phase 1 comes first because phases 2 to 4 all change queries, and today nothing would catch a regression in the stage-move statement. Phase 3 comes before phase 4 because it changes the joins that phase 4 would otherwise consolidate twice.

Each phase should be its own branch and pull request. Run `npm run check` (added in phase 1) before every commit.

---

## Phase 1: safety net

### 1.0 Separate development database (OPS-1)

Needs the owner, because it is done in the Neon console or CLI.

- Create a Neon branch `dev` from the production branch. It starts as a copy-on-write copy of the current data.
- Point `DATABASE_URL` in `.env.local` at the `dev` branch. Keep the production string only as `PRODUCTION_DATABASE_URL`, which nothing but `npm run migrate:prod` connects to.
- `migrate:prod` prints the target and requires its endpoint id, typed or as `--confirm=<id>`. `migrate:up` targets `DATABASE_URL` and refuses production.
- Guards recognise production by Neon endpoint id (the `ep-…` part of the host, without `-pooler`), derived from `PRODUCTION_DATABASE_URL`, so pooled and direct URLs both match.

Status: done in phase 1. Neon project `jobhunt` has a `dev` branch (endpoint `ep-misty-art-al79xv5z`) copied from `production` (`ep-nameless-pine-alwsccfk`) on 2026-09-29; the local `DATABASE_URL` points at it. A branch is a snapshot: refresh it from production in the Neon console when fresher data is needed.

Vercel was split the same day: `DATABASE_URL` for Production is the `production` branch; Preview and Development use the `dev` branch, so preview deployments and `vercel env pull` never reach live data. Deployments built before the split keep the old value until redeployed.

### 1.1 Guard `reset:db` (DB-3)

Do this first if 1.0 has to wait; it is ten minutes of work and removes the only way to lose data by accident.

- Refuse to run unless `--yes` is passed, and print the database host before doing anything.
- Refuse when the target's Neon endpoint id equals production's, and refuse when `PRODUCTION_DATABASE_URL` is unset and production therefore cannot be recognised. Checking `NODE_ENV` or `VERCEL_ENV` is not enough: locally neither says production, yet today the local connection string is production.
- Delete the copied table definitions. After truncating, run the migration runner so there is one source of schema truth.
- Take the seed lanes from one shared constant.

### 1.2 One command for all checks (TOOL-1)

Add to `package.json`:

```json
"typecheck": "tsc --noEmit --incremental false",
"test": "node --test \"tests/**/*.test.mjs\"",
"check": "npm run lint && npm run typecheck && npm test"
```

Turn on `@typescript-eslint/no-explicit-any` as a warning and type the Recharts callbacks in `sankey-chart.tsx`.

### 1.3 Test the stage-move SQL against real Postgres (TEST-1)

Goal: the SQL and `rewindTransitionPath()` are run on the same scenarios and must agree.

Tests must never run against production, not even inside a transaction that is rolled back. PGlite needs no connection string; if a Neon-branch fallback is ever added, its setup must refuse production by endpoint id. Compare endpoint ids, not whole connection strings: the pooled and direct URLs of one database differ (`ep-…-pooler` vs `ep-…`).

1. Add a seam in `db.ts`: build the statement in a function that returns text and parameters, and let the executor be injected. The Neon driver is then one executor among others.
2. Run the statement in tests against an in-process Postgres. PGlite (`@electric-sql/pglite`) is the first choice because it needs no network and no container. The statement text and parameters can be taken out of `db.ts` and run as a plain parameterized query; this has been done by hand once. Verified in phase 1: PGlite runs all migrations and the statement unchanged, including the `text[]` parameter.
3. Load the schema by running the real migrations against the test database, so the migrations are tested as well.
4. Scenarios, each asserted against both implementations:
   - forward move appends one edge;
   - rewind onto a lane already visited keeps the original edge and timestamp;
   - rewind onto a lane that was skipped inserts a reconnect edge;
   - rewind to the entry lane leaves no edges;
   - rewind below the entry lane clears the path;
   - move into a terminal lane positioned early on the board is a forward move;
   - move out of a terminal lane into a pipeline lane is a rewind;
   - a stale `expectedStageId` changes nothing and reports a conflict;
   - an unknown application reports missing;
   - history that names a deleted lane is skipped when finding the boundary.
5. Use Node's built-in runner (`node --test`), which fits the existing assert-based scripts. Move `scripts/verify-*.mjs` under `tests/` and keep the npm script names as aliases.

### 1.4 CI

Add a GitHub Actions workflow that runs on push and pull request with Node 24: `npm ci`, `npm run check` (which includes the tests), `npm audit --omit=dev`, `npm run build`.

**Done when:** a deliberate bug in the move statement fails CI.

Phase 1 result: seven mutations were tried. Six change behaviour and all six fail the suite. The original example here, `>=` to `>` in `rewind_boundary`, only differs on a history that is out of rank order, which a lane reorder produces; it is caught by the reorder scenario. The seventh, `<` to `<=` in `clear_history`, is equivalent: both branches leave an empty path when the target is the entry lane.

---

## Phase 2: schema fixes

One migration per item so each can be reasoned about alone. All are safe on the current data, which the audit confirmed is clean.

### 2.1 Indexes (DB-2)

```sql
CREATE INDEX IF NOT EXISTS application_transitions_app_time_idx
  ON application_transitions (application_id, transitioned_at, id);
CREATE INDEX IF NOT EXISTS applications_stage_id_idx
  ON applications (stage_id);
```

The three-column index matches both sort directions used by the "latest transition" and "first transition" subqueries.

### 2.2 Drop unused tables (DB-4)

```sql
DROP TABLE IF EXISTS application_transitions_backup;
DROP TABLE IF EXISTS pgmigrations;
```

`application_transitions_backup` holds 9 rows and `pgmigrations` holds 1, so export both to a file before dropping. This step is irreversible and should be confirmed by the owner before it runs.

### 2.3 Case-insensitive lane names (DB-5)

```sql
CREATE UNIQUE INDEX stages_name_lower_key ON stages (LOWER(name));
```

Keep the existing constraint. Map the new index name to the same 409 in `addStage`.

### 2.4 Database-level checks (DB-6)

```sql
ALTER TABLE applications
  ADD CONSTRAINT applications_company_not_blank CHECK (btrim(company) <> ''),
  ADD CONSTRAINT applications_role_not_blank CHECK (btrim(role) <> '');
ALTER TABLE stages
  ADD CONSTRAINT stages_name_not_blank CHECK (btrim(name) <> ''),
  ADD CONSTRAINT stages_sort_order_non_negative CHECK (sort_order >= 0);
ALTER TABLE application_transitions
  ADD CONSTRAINT application_transitions_no_self_loop CHECK (from_status <> to_status);
```

Leave `SERIAL` alone. Converting to identity columns has no practical benefit here.

### 2.5 Remove the legacy `created` handling (SQL-2)

- Migration: delete any row where either status is `created`, case-insensitively. It is a no-op on the live database and makes the guarantee explicit for any other copy.
- Remove the seven predicates from `db.ts`, the `LEGACY_CREATED_STAGE` constant, `scripts/cleanup-created-transitions.mjs` and the `cleanup:created` script.
- Keep `created` in `RESERVED_STAGE_NAMES`.

### 2.6 Migration runner (DB-8)

- Take `pg_advisory_lock` for the duration of a run.
- Add a header comment to the first migration noting that `interview_date` was folded in later and that migration `1730000001000` is a no-op on fresh databases.
- State in `AGENTS.md` that migrations are forward-only and that applied files must not be edited. (Done in this pass.)

**Done when:** `npm run migrate:up` on a fresh database and on a copy of production produce the same catalog, and phase 1 tests pass.

Phase 2 result:

- Migrations `1730000006000` to `1730000010000`, one per item; `tests/schema.test.mjs` checks each guarantee on PGlite.
- 2.6 changed from the plan: a session-level `pg_advisory_lock` did not stop a concurrent run through Neon's pooler (tested; the second run failed on a duplicate index and rolled back). The runner now takes `pg_advisory_xact_lock` inside each migration's transaction and re-checks the file. Three concurrent runs on a copy of production then applied each file exactly once.
- The header comment for the first migration went to `docs/ARCHITECTURE.md` instead, because `AGENTS.md` forbids editing applied migrations.
- Catalog check on a copy of production against a fresh database: columns, constraints and indexes identical. The only difference is that PGlite runs Postgres 18, which records `NOT NULL` as constraint rows; Neon runs 17.
- Review by Fable (PR #10) led to: constraint guards scoped to their table; the no-self-loop check moved from `1730000009000` into `1730000010000`, after the rows that would violate it (including legacy `created -> created`) are deleted; a failing `ROLLBACK` no longer hides the original error; tests for re-running the migrations and for the lock's re-check. Both migration files were edited before merge while applied only to `dev`, where the result is identical.
- Applied to `dev`, then to production with `npm run migrate:prod` on 2026-09-29 after PR #10 merged. Before: no rows violated the new constraints. After: data unchanged (9 lanes, 30 applications, 35 transitions), only the four app tables remain, and the schema matches `dev` exactly.

---

## Phase 3: reference lanes by id

Fixes DB-1. This is the change with the most value and the most risk, so it is split into steps that can each be deployed and rolled back.

### 3.1 Expand

```sql
ALTER TABLE application_transitions
  ADD COLUMN from_stage_id INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  ADD COLUMN to_stage_id   INTEGER REFERENCES stages(id) ON DELETE SET NULL;

UPDATE application_transitions t SET
  from_stage_id = (SELECT id FROM stages s WHERE s.name = t.from_status),
  to_stage_id   = (SELECT id FROM stages s WHERE s.name = t.to_status);

CREATE INDEX application_transitions_to_stage_idx ON application_transitions (to_stage_id);
```

Keep `from_status` and `to_status` as a snapshot of the name at the time of the move. With `ON DELETE SET NULL`, a deleted lane leaves rows with a null id and a readable name, which is what the charts already handle as "history-only".

### 3.2 Dual write

`stageMoveStatement` writes both the ids and the names. Reads are unchanged. Deploy and let it run.

### 3.3 Switch reads

Change every join from `s.name = t.to_status` to `s.id = t.to_stage_id`, and have the charts label by the current lane name, falling back to the stored name when the id is null. Extend the phase 1 tests with a rename scenario.

### 3.4 Allow renaming

- `PATCH /api/stages/:id` accepts `name` as well as `kind`.
- Decide with the owner whether a rename also rewrites the stored names. Recommended: yes, in the same statement, so the snapshot columns never disagree with the live lane while it exists.
- Add the name field to the edit mode of `StageDialog` and drop the comments that explain why renaming is impossible.

### 3.5 Optional: record creation and keep rewinds (DB-7)

Only if the owner wants to answer questions about undone moves. Two separate options:

- **Entry event.** Store the entry lane on `applications` as `entry_stage_id`, set on insert and updated only when a rewind goes below it. Removes the three derived "entry lane" subqueries.
- **Append-only log.** Add `superseded_at` to transitions and mark rows instead of deleting them; every read filters on `superseded_at IS NULL`. Keeps the full record at the cost of a filter in every query.

The entry event is cheap and recommended. The append-only log is a product decision; leave it out unless there is a concrete question it would answer.

Done differently, with the owner's agreement: an `entry_stage_id` column would lose the lane's name when the lane is deleted, which phase 3 keeps, and would need updating on every move and rename. Migration `1730000013000` instead adds the view `application_entry_stage` (4.2's second view), and the move statement, the Sankey and the funnel read it instead of three copies of the derivation. On `dev` it matches the old derivation for all 30 applications. The append-only log stays out (decision 3). Applied to production on 2026-09-29 (`migrate:prod`, then PR #14 merged); there too the view matched the old derivation for all 30 applications.

**Done when:** a lane can be renamed from the board and the stats, Sankey and staleness figures are unchanged by the rename.

Phase 3 result (3.1 to 3.4; 3.5 is left for its own PR):

- Migration `1730000011000` adds the id columns (`ON DELETE SET NULL`), fills them by name and indexes both. Dual write and switched reads ship together rather than in three deploys: this app has one writer, and the migration runs right before the merge.
- `stageMoveStatement()` (moved with the new `stageUpdateStatement()` to `src/lib/stage-statements.ts`) writes both ids and names and finds the entry lane, the boundary and the last kept lane by id. `rewindTransitionPath()` matches by id when a record has one; the tests compare ids as well as names.
- Reads that join history to lanes use ids. Labels keep the stored names, which a rename rewrites. The Sankey query now has a fixed order, since a rename's `UPDATE` reordered its links.
- Rename (decision 2: rewrites stored names) is one statement. 409 on a case-insensitive duplicate.
- Verified on `dev`: all 35 edges backfilled with matching names; renaming a lane rewrote its 8 edges and left the Sankey payload identical apart from the name.
- Review by Fable (PR #12) led to: charts (Sankey, funnel, conversion pairs, outcomes) grouped by lane id with labels from the live lane, deleted lanes shown as "(deleted)"; the no-self-loop check compares ids (`1730000012000`), so a rewind onto a re-created lane keeps an edge into it; a rewind without a resolvable boundary adds no edge, as in the twin; the backfill's re-run caveat documented. On `dev`, the id-based funnel and pairs equal the old name-based ones.
- Production runbook: move no cards from step 1 to step 3. (1) `npm run migrate:prod`; the previous code keeps working, but any card it moves gets edges without ids. (2) Merge, and wait for the deploy. (3) Read-only check that no edge has a NULL id while its name matches a live lane. If some do, add a migration that repeats the backfill and apply it at once. That migration must first delete edges with `from_stage_id IS NULL`, a set `to_stage_id`, and a `from_status` equal to that lane's name: a rewind of such a card before the backfill writes `X (no id) -> X`, which the backfill would turn into `X -> X` and the distinct-lanes check would reject. A backfill migration in this PR would not help: `migrate:prod` applies all pending files together, before the deploy.
- Applied to production on 2026-09-29 in runbook order: `migrate:prod` (16:28:24 UTC) applied `1730000011000` and `1730000012000`, and all 35 edges got lane ids with matching names; PR #12 merged at 16:28:36 and was live about a minute later; the post-deploy check found no edge with a missing id and no card moved in between. Data unchanged: 9 lanes, 30 applications, 35 transitions.

---

## Phase 4: restructure the data layer

### 4.1 Split `db.ts` (ARCH-2)

```
src/lib/db/
  client.ts         connection, sql, transaction, error helpers
  rows.ts           row types and mappers
  stages.ts         list, add, update, reorder, delete
  applications.ts   list, create, update, delete
  stats.ts          getStatsData
  sankey.ts         getSankeyData
  index.ts          re-exports, so existing imports keep working
```

Move only; no behaviour change in this step.

Done in PR #15: `src/lib/db/` holds `client.ts`, `rows.ts`, `stages.ts`, `applications.ts`, `sankey.ts`, `stats.ts` and `index.ts`, all under 300 lines. The move helper (`applyStageMove`) stayed in `applications.ts`; the statement itself already lives in `src/lib/stage-statements.ts`.

### 4.2 Define derived values once (SQL-3)

Create two views in a migration and use them everywhere:

- `application_stage_entry (application_id, entered_at)` for "latest transition into the current lane, else `created_at`";
- `application_entry_stage (application_id, stage_id, stage_name)` for the entry lane. Done in 3.5 (`1730000013000`).

### 4.3 Typed rows and explicit aliases (SQL-5)

Alias in snake_case, declare a row interface per query, and map in `rows.ts`. Remove the reliance on case folding. Drop the `as Record<string, unknown>[]` casts in favour of the driver's generic parameter.

### 4.4 One snapshot for stats (SQL-1)

Send the stats queries through `sql.transaction([...], { readOnly: true, isolationLevel: "RepeatableRead" })`. Drop the separate `listStages()` call and derive lanes from the stage count rows. Do the same for the four Sankey queries.

### 4.5 Fewer round trips on writes (SQL-4, SQL-8)

- Remove the lane existence checks before moves; the foreign key error is already mapped.
- Return the full application row from the move statement instead of selecting it again.
- Replace `ensureSchema()` with a comparison between the newest file in `migrations/` (captured at build time) and the newest row in `schema_migrations`, or remove it and let a missing relation surface as a clear 500 in the logs.

### 4.6 Name the lane-kind sets (SQL-6)

Add `RESOLVED_KINDS = ["offer", "rejected", "closed"]` and `INTERVIEW_KIND`, `DEFAULT_CREATE_KIND` to `stage-kinds.ts`. Pass them as parameters to the queries that currently hard-code them, and import `RESOLVED_KINDS` in `stats-charts.tsx` in place of `OUTCOME_KINDS`.

### 4.7 Small query fixes (SQL-7, SQL-9)

- Upcoming interviews: exclude applications in terminal lanes.
- `listApplications`: order by `updated_at DESC, id DESC`.
- Top companies: group by `LOWER(btrim(company))` and display the most common spelling.

Done in PR #16 (4.2, 4.4 to 4.7):

- 4.2: migration `1730000014000` adds the view `application_stage_entry`; the applications query (both copies), the average time in lane and the stale list read it. With 3.5 both planned views exist.
- 4.4: the stats page and the Sankey each send one read-only `RepeatableRead` transaction; the lanes come from the same snapshot instead of a separate `listStages()`. On `dev` the stats payload, the applications list and the Sankey are identical before and after.
- 4.5: the lane existence checks before moves are gone; an unknown lane still returns 400 through the foreign key. Two status changes follow from dropping the check: a card that no longer exists gets 404 first, and an unknown lane together with a stale `expectedStageId` gets 409 (the guarded update matches no row, so the foreign key never fires). Both are pinned by tests. `ensureSchema()` compares `LATEST_MIGRATION` (in code, kept in step by a test) with the newest `schema_migrations` row in one query, instead of listing tables. Not done: returning the full application from the move statement. Its post-move "entered lane at" depends on which rewind branch ran and would duplicate the new view in a harder-to-test place; the follow-up select stays.
- 4.6: `RESOLVED_KINDS`, `INTERVIEW_KIND`, `DEFAULT_CREATE_KIND` and `INTAKE_KIND` in `stage-kinds.ts`, used by the queries, the stats chart, the board and the dialogs. The only lane-kind literals left outside `stage-kinds.ts` are the lane picker's list of every kind. The lane row mapping is one `mapStage()` in `db/rows.ts`, and the unreachable `?? "active"` fallbacks are gone (`kind` is `NOT NULL`).
- 4.7: all three query fixes.

### 4.8 Redact in the data layer (ARCH-1)

Give `listApplications` a required `viewer: Role` argument and strip notes inside it. Remove the two call-site redactions. A caller can then no longer forget.

### 4.9 Consistent errors (API-1)

- `deleteStage` throws `NotFoundError` or `ConflictError` and returns nothing.
- `ApiValidationError` extends `ApiError`; `errorResponse` keeps one branch.
- All success bodies without a payload use `{ ok: true }`.
- `expectedStageId` becomes required in the `db` function signatures.
- Either rename the full update to `PUT` or make `PATCH` accept partial bodies. `PUT` is the smaller change.

Done in PR #17 (4.3, 4.8, 4.9):

- 4.3: queries return snake_case columns; `ApplicationRow` and `StageRow` (and inline types for the one-off queries) are cast once per query, and the mappers in `db/rows.ts` are typed against them. The driver has no row type parameter, so a typed cast replaces `as Record<string, unknown>[]`. The only conversions left are for `numeric` averages, which arrive as strings.
- 4.8: `listApplications(viewer)` redacts notes for a guest through `mapApplication()`; the board page and `GET /api/applications` no longer redact themselves. `tests/rows.test.mjs` covers it.
- 4.9: `deleteStage` throws `NotFoundError` / `ConflictError`; `ApiValidationError` extends `ApiError`, which also removes the import cycle between `api-errors.ts` and `api-validation.ts`; bodies without a payload are `{ ok: true }`; `expectedStageId` is required in the db signatures; the full update is `PUT /api/applications/:id` (the edit dialog sends `PUT`; `PATCH` there now answers 405).
- On `dev`, stats, applications and Sankey are identical to the baseline taken before 4B.

**Done when:** no file in `src/lib/db/` exceeds about 300 lines, the stats page makes one database request, and the phase 1 tests still pass.

---

## Phase 5: API and UI polish

### 5.1 Logo lookup out of the request path (API-2)

Insert the application first and return it. Resolve the logo afterwards with `after()` from `next/server` and update the row; the card shows the initial letter until the next load. Re-run the lookup when `company` changes in an update.

### 5.2 Error boundaries (UI-1)

Add `src/app/error.tsx`, `src/app/global-error.tsx` and `src/app/not-found.tsx` with the page header and a retry button.

Done in PR #18 (5.1 and 5.2):

- 5.1: `POST /api/applications` inserts and answers at once (68 ms on `dev`, previously up to 3 s); `scheduleLogoLookup()` runs the lookup with `after()` and writes through `setApplicationLogo()`, guarded by the company name and without touching `updated_at`. The update clears `logo_url` when the company changes (ignoring case and spacing), and `PUT` schedules a lookup whenever the card comes back without a logo, which also retries failed lookups.
- 5.2: the three pages exist; `error.tsx` uses this Next version's `retry()`. Checked against a production build with an unreachable database: the error page renders inside the normal header with its digest, and an unknown URL returns 404 with the not-found page.
- 5.6 moves to the next PR, which adds the toast it needs.

### 5.3 Moving cards without a mouse (UI-2)

- Make cards focusable, open the edit dialog on Enter, and add a "Move to" menu on each card.
- Replace `alert()` and `confirm()` with a toast and a Radix alert dialog.
- Touch drag is a larger piece of work (a library such as dnd-kit). Treat it as a separate feature and decide with the owner.

### 5.4 Applied date (UI-3)

Show the date the card first left an `intake` lane, falling back to `created_at` when it never sat in one. Count "days to interview" from the same moment. Phase 3.5's entry column makes this a simple comparison.

### 5.5 Hydration-safe ages (UI-4)

Compute `daysSince` on the server with a single `now` passed down as a prop, or render relative ages only after mount.

### 5.6 Report refresh failures (UI-5)

Show a message when `refreshBoard()` fails and offer a reload.

---

## Phase 6: hardening and housekeeping

### 6.1 Login throttle (SEC-1)

Pick one:

- a Vercel Firewall rate-limit rule on `/api/auth/login` (no code, recommended);
- a `login_attempts` table keyed by IP and window, checked in the route.

Keep the in-memory map as a first line either way.

### 6.2 Response headers (SEC-2)

Add `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Introduce a full Content Security Policy in report-only mode first; Next's inline scripts need a nonce, which is set up in `proxy.ts`. Allow `img-src` for `www.google.com` and `logo.clearbit.com` only.

### 6.3 Analytics payloads (SEC-3)

Send the lane kind instead of the lane name in every `track*` call.

### 6.4 Documents (DOC-1)

- Move the three root-level audit reports to `docs/audits/` with their dates in the filenames.
- Rewrite `ROADMAP.md`: mark search, stats and stale alerts as shipped, and move what remains (CSV import, application timeline) to the top.

### 6.5 Local files (TOOL-2)

Delete `data/` after confirming with the owner that the SQLite file holds nothing that was not migrated.

### 6.6 Dependencies

Apply the pending patch and minor updates in one pull request (`npm update`), then run the full check and a production build. Leave ESLint 10 and TypeScript 7 for separate pull requests.

---

## Decisions from the owner

All seven defaults were accepted on 2026-09-29.

| # | Question | Decision |
|---|---|---|
| 1 | Drop `application_transitions_backup` and `pgmigrations`? (2.2) | Export, then drop |
| 2 | Should a lane rename rewrite names stored in history? (3.4) | Yes |
| 3 | Keep a full record of rewinds? (3.5) | No; add the entry column only |
| 4 | Is touch drag and drop wanted? (5.3) | No; keyboard and menu only |
| 5 | Rate limiting through Vercel Firewall or a table? (6.1) | Vercel Firewall |
| 6 | Delete `data/*.sqlite`? (6.5) | Yes, after a look at its contents |
| 7 | Create a Neon `dev` branch and point `.env.local` at it? (1.0) | Yes |
