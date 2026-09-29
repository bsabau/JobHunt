# Architecture

Reference for how the JobHunt app is put together. `AGENTS.md` holds the short rules for working in the repo; this file holds the detail. Last verified against the code and the live schema on 2026-09-29.

## What the app does

A single-owner job application tracker. The owner adds applications, drags them between lanes on a Kanban board, and reads pipeline statistics and a Sankey flow chart. An optional read-only guest account can view everything except notes.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript 6 (strict) |
| Database | Neon serverless Postgres over HTTP (`@neondatabase/serverless`) |
| UI | Tailwind CSS v4, Radix primitives in shadcn/ui style, lucide icons |
| Charts | Recharts 3 |
| Auth | Env-configured credentials, HMAC-signed stateless session cookie |
| Hosting | Vercel (assumed by the timezone header and analytics) |
| Runtime | Node 24 (`.nvmrc`, `engines`) |

## Routes

### Pages (all server components, `force-dynamic`)

| Path | File | Data | Client component |
|---|---|---|---|
| `/` | `src/app/page.tsx` | `getStatsData(timeZone)` | `StatsCharts` |
| `/board` | `src/app/board/page.tsx` | `listApplications()`, `listStages()` | `KanbanBoard` |
| `/sankey` | `src/app/sankey/page.tsx` | `getSankeyData()` | `SankeyChart` |
| `/login` | `src/app/login/page.tsx` | none | client page |

Every page calls `requirePageSession()` before touching the database and redirects to `/login` when there is no valid session.

### API

All bodies are JSON and must be sent with `Content-Type: application/json` (415 otherwise). Errors are `{ "message": string }`.

| Method and path | Body | Notes |
|---|---|---|
| `POST /api/auth/login` | `user`, `pass` | Sets the `session` cookie. 401 on bad credentials, 429 after 5 failures per minute per IP |
| `POST /api/auth/logout` | none | Clears the cookie; works without a session |
| `GET /api/applications` | | Returns `{ applications, stages }`; `notes` is `null` for guests |
| `POST /api/applications` | `company`, `role`, optional `notes`, `interviewDate`, `sourceUrl`, `stageId` | Looks up a logo first. Default lane is the first `active` lane |
| `PATCH /api/applications/:id` | all editable fields, `stageId`, `expectedStageId` | Full replacement, not a partial update. 409 if the card moved |
| `DELETE /api/applications/:id` | | Transitions cascade |
| `PATCH /api/applications/:id/status` | `stageId`, `expectedStageId` | The drag-and-drop move. 409 if the card moved |
| `GET /api/stages` | | |
| `POST /api/stages` | `name`, optional `kind` | 409 on duplicate name. `new` and `created` are reserved |
| `PATCH /api/stages/:id` | `name` and/or `kind` | A rename also rewrites the lane's names in history. 409 on a duplicate name (case-insensitive) |
| `DELETE /api/stages/:id` | | 409 while the lane holds applications |
| `PATCH /api/stages/reorder` | `stageIds` | Must list every lane exactly once |
| `GET /api/sankey` | | |

There is no stats endpoint; the stats page is server-rendered only.

## Request pipeline

1. `src/proxy.ts` (Next 16's name for middleware) runs on every request except static assets.
   - Non-GET requests are rejected when `Origin` or `Sec-Fetch-Site` shows a cross-site caller.
   - Requests without a valid session get a 401 (API) or a redirect to `/login` (pages).
   - Guests are blocked from every non-GET API call.
2. The route handler or page calls `requireSession()` / `requirePageSession()` again. The proxy is an early gate, not the authority.
3. Input goes through the helpers in `src/lib/api-validation.ts`.
4. `src/lib/db.ts` runs the query.
5. `errorResponse()` in `src/lib/api-errors.ts` maps typed errors to status codes and hides everything else behind a generic 500.

## Authentication

Configured entirely by environment variables; there is no users table.

| Variable | Purpose |
|---|---|
| `AUTH_USER`, `AUTH_PASS` | Owner credentials |
| `AUTH_SECRET` | HMAC key for session tokens, at least 32 characters |
| `AUTH_GUEST_ENABLED` | `"true"` enables the guest account |
| `AUTH_GUEST_PASS` | Guest password; the guest username is always `guest` |

The token is `role:expires:version:signature`. `version` is an HMAC over the role's credentials, so changing a password or disabling guest access invalidates every token issued for that role. Sessions last 7 days. Tokens are stateless: logging out clears the cookie but cannot revoke a copied token before it expires.

## Domain model

### Tables

```
stages
  id          SERIAL PK
  name        TEXT NOT NULL UNIQUE          -- also unique on LOWER(name); not blank
  sort_order  INTEGER NOT NULL UNIQUE       -- DEFERRABLE INITIALLY DEFERRED; >= 0
  kind        TEXT NOT NULL DEFAULT 'active'
              CHECK (kind IN ('intake','active','interview','offer','rejected','closed'))

applications
  id              SERIAL PK
  company         TEXT NOT NULL     -- not blank
  role            TEXT NOT NULL     -- not blank
  notes           TEXT
  interview_date  DATE
  source_url      TEXT
  logo_url        TEXT
  stage_id        INTEGER NOT NULL -> stages(id) ON DELETE RESTRICT
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()   -- set by the app, no trigger

application_transitions
  id              SERIAL PK
  application_id  INTEGER NOT NULL -> applications(id) ON DELETE CASCADE
  from_status     TEXT NOT NULL     -- a stage NAME, not an id
  to_status       TEXT NOT NULL     -- the lane's name
  from_stage_id   INTEGER -> stages(id) ON DELETE SET NULL
  to_stage_id     INTEGER -> stages(id) ON DELETE SET NULL   -- <> from_stage_id when both are set
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

schema_migrations
  filename    TEXT PK
  applied_at  TIMESTAMPTZ
```

Indexes beyond the primary keys and unique constraints: `application_transitions (application_id, transitioned_at, id)`, which serves the first/latest-transition subqueries in both directions; `application_transitions (to_stage_id)` and `(from_stage_id)`; and `applications (stage_id)`.

"Not blank" means `CHECK (btrim(col) <> '')`. The constraints repeat what the API validates, so a script cannot store what the app would not.

Migration notes:

- Migrations are forward-only; an applied file is never edited.
- `1730000001000` (adds `interview_date`) is a no-op on a fresh database, because the first migration was later edited to create the column.
- `1730000002000` rewrote history using raw `sort_order`, before outcome lanes ranked last. It must never run again on current data, which `schema_migrations` guarantees.
- `1730000007000` dropped `application_transitions_backup` and `pgmigrations`; production's rows were exported first to a local, uncommitted `backups/` file.
- `1730000010000` deletes legacy `created` rows and any self-loop rows before adding the no-self-loop check. It must run only once: since `1730000012000`, an edge from a deleted lane into a new lane of the same name is legitimate, and a re-run would delete it.
- `1730000011000` adds `from_stage_id` / `to_stage_id` and fills them by name; names with no lane stay `NULL`. It must run only once: after a lane is deleted and another created under its name, a re-run would attach the old history to the new lane.
- `1730000012000` replaces the name-based no-self-loop check with `application_transitions_distinct_lanes`, which compares ids, so a move from a deleted lane into a new lane of the same name can be stored.
- The runner serialises concurrent runs with `pg_advisory_xact_lock` inside each migration's transaction, then re-checks `schema_migrations`. A session-level lock would not survive Neon's transaction pooler.

### Lane kinds

The kind carries a lane's meaning. Its position on the board is layout only. All of this lives in `src/lib/stage-kinds.ts`.

| Kind | Meaning | Can go stale | Terminal |
|---|---|---|---|
| `intake` | Not applied yet (Wishlist) | no | no |
| `active` | In progress | yes | no |
| `interview` | Counts towards time-to-interview | yes | no |
| `offer` | Offer received | no | no |
| `rejected` | Outcome: rejected | no | yes |
| `closed` | Outcome: dead end without a rejection (ghosted) | no | yes |

Two groupings are in use and they differ on `offer`:

- **Terminal** (`TERMINAL_KINDS`): `rejected`, `closed`. Drives pipeline rank and the "average days in current stage" figure.
- **Resolved**: `offer`, `rejected`, `closed`. Drives the "Where applications ended" chart and `openCount`. This set is written out by hand in `db.ts` and in `stats-charts.tsx` rather than named in `stage-kinds.ts`.

### Pipeline rank

Rank is the pair `(is terminal, sort_order)`. Every terminal lane ranks after every pipeline lane wherever it sits on the board, so dropping a card into Rejected is always a forward move.

The rule is implemented twice and the two must stay in step:

- TypeScript: `compareStageRank()` and `withPipelineRank()` in `stage-kinds.ts`
- SQL: the `ranked_stages` CTE in `stageMoveStatement()` in `stage-statements.ts`

### Transition history

`application_transitions` stores the application's **current path**, not an audit log. Moving a card backwards rewrites the path.

- **Forward move** (target ranks at or above the current lane): append `current -> target`.
- **Rewind** (target ranks below the current lane):
  - keep every edge before the first one that reaches or passes the target;
  - if that boundary edge lands exactly on the target, keep it with its original timestamp;
  - otherwise replace it with `last kept lane -> target`;
  - if the target ranks below the lane the application entered in, clear the path.

There is no row for creation. The **entry lane** is derived: where the earliest transition starts (`from_stage_id`, `from_status`), or the current lane when there are none.

Edges refer to lanes by id. An edge into a deleted lane (id `NULL`) is skipped when looking for the rewind boundary.

The reference implementation is `rewindTransitionPath()` in `src/lib/transitions.ts`. The production implementation is the single SQL statement built by `stageMoveStatement()` in `src/lib/stage-statements.ts`, which also applies the `expectedStageId` guard so that a concurrent move produces a 409 instead of forked history. `tests/stage-statements.test.mjs` runs that statement on PGlite and checks every scenario, ids included, against the TypeScript version.

### Lane ids, names and renames

Transitions reference lanes by id. The name columns are kept in step: `stageUpdateStatement()` renames the lane and rewrites `from_status` / `to_status` of its edges in one statement, so the stored name always equals the live lane's name. Deleting a lane sets its ids in history to `NULL` and keeps the last name; the charts show such names without a kind. A lane deleted and re-created under the same name gets a new id and does not inherit the old history.

A rename is refused (409) when another lane has the name in any case. Charts group history by lane id and label it with the current name; history of a deleted lane is shown as `<name> (deleted)`, apart from any live lane that took the name.

### Derived values

| Value | Definition |
|---|---|
| Stage entered at | Latest transition into the current lane, else `created_at` |
| Stale | In a lane that can go stale for 14 days or more since it was entered (`STALE_THRESHOLD_DAYS`) |
| Reached (funnel) | Distinct applications whose entry lane or any lane moved into is the lane, by lane id |
| Days to interview | First transition into any `interview` lane minus `created_at` |
| Open count | Total minus applications in a resolved lane |

## Time zones

Timestamps are stored as `TIMESTAMPTZ`; `interview_date` is a plain `DATE`. The viewer's zone comes from the `tz` cookie written by `TimezoneSync`, then Vercel's `x-vercel-ip-timezone` header, then UTC. It is validated with `Intl` before it reaches SQL, where day buckets use `AT TIME ZONE`. Date formatting pins both locale and zone so server and browser render the same text.

## Logo lookup

`findCompanyLogo()` queries Clearbit's autocomplete endpoint for a domain and stores a Google S2 favicon URL for it. It runs inside `POST /api/applications` with a 3 second timeout and only on creation. Stored URLs are restricted to an allowlist of hosts and rendered with a plain `<img>` and `referrerPolicy="no-referrer"`; the Next image optimizer is disabled.

## Source layout

```
migrations/            timestamp-prefixed .mjs files exporting up(sql)
scripts/
  migration-utils.mjs  env loading, production detection, the migration loop
  migrate-up.mjs       migrates DATABASE_URL; refuses production
  migrate-prod.mjs     migrates PRODUCTION_DATABASE_URL after confirmation
  migrate-create.mjs   scaffolds a migration
  reset-neon-db.mjs    DESTRUCTIVE, guarded: empties the tables, reseeds lanes
tests/                 node --test files; stage-statements runs the SQL on PGlite
src/
  proxy.ts             auth gate, CSRF check, guest write block
  app/                 pages and API routes
  components/          client components; ui/ holds the primitives
  lib/
    db.ts              every query
    stage-statements.ts  the move and rename statements (no runtime imports)
    stage-kinds.ts     lane kinds, rank, chart colours (no runtime imports)
    transitions.ts     reference rewind implementation
    sankey.ts          builds the Sankey graph as a DAG
    auth.ts            tokens, credentials, requireSession
    api-validation.ts  input parsing
    api-errors.ts      typed errors and the response mapper
    timezone.ts        zone validation and date-only arithmetic
    limits.ts          text length limits shared by client and server
```

## Verification

`npm run check` runs lint, typecheck and every test; GitHub Actions runs it on every push, followed by `npm audit --omit=dev` and a build.

| Test (`npm run verify:<name>`) | Covers |
|---|---|
| `auth` | Token signing, expiry, tampering, guest revocation |
| `timezone` | Date-only arithmetic |
| `sankey` | Graph is acyclic |
| `transitions` | Rewind rule, TypeScript version |
| `stage-kinds` | Rank ordering, stale kinds, colours |
| `stage-statements` | The production move and rename SQL on PGlite, the move checked against the TypeScript version |
| `schema` | Indexes, constraints and cleanup built by the real migrations on PGlite; migrations re-run safely |

## Known limitations

- The login throttle is an in-memory map per server instance; it resets on cold start and is not shared between instances.
- Cards can only be moved by mouse drag or through the edit dialog, which opens on double-click.
- Reordering lanes or changing a lane's kind changes rank, so older history can contain edges that now point backwards. The Sankey drops those and reports the count.
- See `docs/AUDIT-2026-09-29.md` for the full list and `docs/FIX-PLAN.md` for the planned fixes.
