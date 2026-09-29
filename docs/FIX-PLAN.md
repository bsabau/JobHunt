# Fix plan

Plan for the findings in `docs/AUDIT-2026-09-29.md`. IDs match that file. Nothing here has been implemented yet.

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
- Applied to the `dev` branch. Production still needs `npm run migrate:prod` after merge.

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

**Done when:** a lane can be renamed from the board and the stats, Sankey and staleness figures are unchanged by the rename.

---

## Phase 4: restructure the data layer

### 4.1 Split `db.ts` (ARCH-2)

```
src/lib/db/
  client.ts         connection, sql, transaction, error helpers
  rows.ts           row types and mappers
  stages.ts         list, add, update, reorder, delete
  applications.ts   list, create, update, delete
  stage-move.ts     the move statement and its outcome mapping
  stats.ts          getStatsData
  sankey.ts         getSankeyData
  index.ts          re-exports, so existing imports keep working
```

Move only; no behaviour change in this step.

### 4.2 Define derived values once (SQL-3)

Create two views in a migration and use them everywhere:

- `application_stage_entry (application_id, entered_at)` for "latest transition into the current lane, else `created_at`";
- `application_entry_stage (application_id, stage_id, stage_name)` for the entry lane, unless 3.5 replaced it with a column.

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

### 4.8 Redact in the data layer (ARCH-1)

Give `listApplications` a required `viewer: Role` argument and strip notes inside it. Remove the two call-site redactions. A caller can then no longer forget.

### 4.9 Consistent errors (API-1)

- `deleteStage` throws `NotFoundError` or `ConflictError` and returns nothing.
- `ApiValidationError` extends `ApiError`; `errorResponse` keeps one branch.
- All success bodies without a payload use `{ ok: true }`.
- `expectedStageId` becomes required in the `db` function signatures.
- Either rename the full update to `PUT` or make `PATCH` accept partial bodies. `PUT` is the smaller change.

**Done when:** no file in `src/lib/db/` exceeds about 300 lines, the stats page makes one database request, and the phase 1 tests still pass.

---

## Phase 5: API and UI polish

### 5.1 Logo lookup out of the request path (API-2)

Insert the application first and return it. Resolve the logo afterwards with `after()` from `next/server` and update the row; the card shows the initial letter until the next load. Re-run the lookup when `company` changes in an update.

### 5.2 Error boundaries (UI-1)

Add `src/app/error.tsx`, `src/app/global-error.tsx` and `src/app/not-found.tsx` with the page header and a retry button.

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
