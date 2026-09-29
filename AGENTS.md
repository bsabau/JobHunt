# AGENTS.md

Guidance for coding agents working in this repository. This is the single source; `CLAUDE.md` imports it.

Deeper reference: `docs/ARCHITECTURE.md` (domain model, schema, API, auth). Open issues: `docs/AUDIT-2026-09-29.md`. Planned work: `docs/FIX-PLAN.md`. Product audit (charts and feature ideas, not yet planned): `docs/PRODUCT-AUDIT-2026-09-29.md`.

## What this is

A single-owner job application tracker with three views: pipeline stats (`/`), a Kanban board (`/board`) and a Sankey flow chart (`/sankey`). An optional guest account is read-only and never sees notes.

## Commands

- `npm run dev`: dev server (Next.js with Turbopack) at localhost:3000
- `npm run build`: production build
- `npm run check`: lint, typecheck and every test. Run it before every commit; CI runs it on every push.
- `npm run lint`, `npm run typecheck`, `npm test`: the three parts on their own
- `npm run verify:<name>`: one test file from `tests/` (`auth`, `timezone`, `sankey`, `transitions`, `stage-kinds`, `stage-statements`, `schema`, `rows`)
- `npm run migrate:up`: apply migrations to `DATABASE_URL`. Refuses when that is production.
- `npm run migrate:prod`: apply migrations to `PRODUCTION_DATABASE_URL`. Asks for the endpoint id; only run it when the user asks.
- `npm run migrate:create -- <name>`: scaffold a migration
- `npm run reset:db -- --yes`: **destructive.** Empties every table in `DATABASE_URL` and reseeds the default lanes. Refuses against production and when `PRODUCTION_DATABASE_URL` is unset. Do not run it unless the user asks for it by name.

Tests never touch a real database: `tests/stage-statements.test.mjs` runs the production SQL on PGlite, built by the real migrations. Run `npm audit` and `npm run build` when dependencies or config changed.

## Architecture

Next.js 16 App Router. Pages are server components that load data and hand it to a client component.

| Route | Page | Client component |
|---|---|---|
| `/` | `src/app/page.tsx` | `src/components/stats-charts.tsx` |
| `/board` | `src/app/board/page.tsx` | `src/components/kanban-board.tsx` |
| `/sankey` | `src/app/sankey/page.tsx` | `src/components/sankey-chart.tsx` |
| `/login` | `src/app/login/page.tsx` | |

API routes live in `src/app/api/`: applications (CRUD and stage moves), stages (CRUD and reorder), sankey, auth (login, logout).

### Request pipeline

1. `src/proxy.ts` (Next 16's middleware) checks the session, rejects cross-site writes and blocks guest writes.
2. Every route handler calls `requireSession()` and every page calls `requirePageSession()` **before** any database access. The proxy is not the authority. New routes and pages must do the same; pass `{ write: true }` for anything that changes data.
3. Parse input with the helpers in `src/lib/api-validation.ts`.
4. Query through `src/lib/db/` (imported as `@/lib/db`).
5. Return errors through `errorResponse()` from `src/lib/api-errors.ts`. Throw `NotFoundError`, `ConflictError` or `InvalidInputError` for expected failures (and `ApiValidationError` for malformed input; it is an `ApiError` too). Success responses without a payload are `{ ok: true }`.

### Key modules

- `src/lib/db/`: all database access, through Neon's `sql` tagged template. `index.ts` is the public API; `client.ts` (connection, `transaction()`, error helpers, `ensureSchema`), `schema-version.ts` (`LATEST_MIGRATION`), `rows.ts` (mappers), `stages.ts`, `applications.ts`, `sankey.ts`, `stats.ts`.
- `src/lib/stage-kinds.ts`: lane kinds, pipeline rank, chart colours. No runtime imports, so the verify scripts can load it directly.
- `src/lib/stage-statements.ts`: the SQL that moves cards and renames lanes, compiled to text and parameters. No runtime imports, so the tests run it on PGlite.
- `src/lib/transitions.ts`: reference implementation of the rewind rule.
- `src/lib/sankey.ts`: builds the Sankey graph as a DAG.
- `src/lib/auth.ts`: session tokens, credential check, `requireSession()`.
- `src/lib/logo.ts`: company logo lookup (Clearbit, Google S2 favicons, host allowlist); `src/lib/logo-lookup.ts` runs it with `after()` once the response is sent.
- `src/lib/types.ts`: shared interfaces (`Stage`, `Application`, `SankeyPayload`, `StatsPayload`).
- `src/lib/limits.ts`: text length limits used by both the forms and the API.
- `src/components/ui/`: shadcn/ui-style primitives (Radix and Tailwind).
- `src/components/feedback.tsx`: `useFeedback()` gives `toast()` and a promise-based `confirm()`. Use them instead of `window.alert()` / `window.confirm()`.

## Domain rules

These are easy to break and not obvious from any single file.

- **The lane kind carries the meaning, not the board position.** Kinds are `intake`, `active`, `interview`, `offer`, `rejected`, `closed`. Never infer meaning from a lane's name or index.
- **Pipeline rank is `(is terminal, sort_order)`.** `rejected` and `closed` lanes rank after every pipeline lane. Moving a card into one is always a forward move and never truncates history. They are excluded from staleness and drop-off.
- **The rank rule exists twice**: `compareStageRank()` in `stage-kinds.ts` and the `ranked_stages` CTE in `stageMoveStatement()` in `stage-statements.ts`. Change both together.
- **The rewind rule exists twice**: `rewindTransitionPath()` in `transitions.ts` and `stageMoveStatement()` in `stage-statements.ts`. `tests/stage-statements.test.mjs` runs the SQL on PGlite and fails when the two disagree; add a scenario there when you change either.
- **`application_transitions` is the current path, not an audit log.** Backward moves delete and rewrite rows.
- **The entry lane comes from the view `application_entry_stage`.** Read it instead of deriving "first edge's start, else current lane" again. The only other copy is the TypeScript twin in `transitions.ts`; change both together.
- **When a card entered its current lane comes from the view `application_stage_entry`.** Use it for staleness and time in lane instead of another "latest move into the lane, else created_at" subquery.
- **When an application was sent comes from the view `application_applied_at`, not `created_at`.** A card that starts in an `intake` lane is not sent until it leaves intake.
- **Transitions reference lanes by id** (`from_stage_id`, `to_stage_id`); join history to lanes by id, never by name. `from_status` / `to_status` hold the lane's name: a rename rewrites them in the same statement (`stageUpdateStatement()`), and after a lane is deleted its id becomes `NULL` and the name is all that remains. `new` and `created` are reserved names.
- **Stage moves need `expectedStageId`.** It is the concurrency guard; a mismatch returns 409.
- **Notes are owner-only.** `listApplications(viewer)` leaves them out for a guest viewer, through `mapApplication()` in `db/rows.ts`. Pass the session's role; never read applications for a guest another way.
- **Dates and zones.** `interview_date` is a `DATE` and must be handled as a `YYYY-MM-DD` string, never parsed with `new Date(string)`. Anything formatted on both server and client must pin locale and time zone, and relative ages take the `now` prop the page reads once on the server; `daysSince()` and friends require it.

## Database

Tables: `stages`, `applications`, `application_transitions`, plus `schema_migrations` for the runner. Full definitions are in `docs/ARCHITECTURE.md`.

- Migrations are timestamp-prefixed `.mjs` files in `migrations/` that export `up(sql)`. They are forward-only; there is no `down`.
- Never edit a migration that has been applied. Add a new one.
- Every new migration also updates `LATEST_MIGRATION` in `src/lib/db/schema-version.ts`; otherwise the app refuses to start on a database that lacks it, and `npm test` fails.
- Write migrations so that running them twice is harmless (`IF NOT EXISTS`, guarded updates).
- The runner wraps each migration in a transaction over a WebSocket client. The HTTP driver used by the app cannot hold a transaction across statements; in app code use `transaction()` from `db/client.ts`, which sends a fixed list of statements in one request.

## Keeping these docs current

Update the docs in the same change as the code, not afterwards. Before finishing a task, check whether it touched any of the following and edit the matching file:

| If the change touches | Update |
|---|---|
| npm scripts, env variables, Node version | `AGENTS.md` (Commands, Environment), `README.md`, `.env.example` |
| A route, page, or API request or response shape | `docs/ARCHITECTURE.md` (Routes) |
| A migration, table, column, index or constraint | `docs/ARCHITECTURE.md` (Tables) |
| Lane kinds, pipeline rank, the rewind rule, derived values | `AGENTS.md` (Domain rules), `docs/ARCHITECTURE.md` (Domain model) |
| Auth, the proxy, guest visibility | `AGENTS.md` (Request pipeline), `docs/ARCHITECTURE.md` (Authentication) |
| A module added, moved, renamed or deleted under `src/lib/` | `AGENTS.md` (Key modules), `docs/ARCHITECTURE.md` (Source layout) |
| A finding in `docs/AUDIT-2026-09-29.md` is fixed | Mark it done in `docs/FIX-PLAN.md`; remove any rule here that only described the old behaviour |

Do not add to `AGENTS.md` what the code already makes obvious. It holds rules and traps; detail belongs in `docs/ARCHITECTURE.md`. If a change needs no doc edit, say so in the final summary rather than staying silent.

## Environment

`.env.local`, see `.env.example`:

- `DATABASE_URL`: Neon Postgres connection string
- `AUTH_USER`, `AUTH_PASS`: owner credentials
- `AUTH_SECRET`: session signing key, at least 32 characters
- `AUTH_GUEST_ENABLED`, `AUTH_GUEST_PASS`: optional read-only guest

Use Node 24 LTS. The repo pins `24.16.0` in `.nvmrc` and `.node-version`, and `package.json` declares `>=24.16.0 <25`.

## Conventions

- Tailwind CSS v4 through the PostCSS plugin, not the older config file.
- UI components follow shadcn/ui patterns and use `cn()` from `src/lib/utils.ts`.
- Database columns are snake_case and TypeScript is camelCase. Queries return columns under their snake_case names (never alias to camelCase: Postgres folds unquoted aliases to lowercase), each query casts its result once to a row type (`ApplicationRow`, `StageRow` in `db/rows.ts`, or an inline type), and the mappers convert to camelCase. The Neon driver returns `numeric` (for example `AVG`) as a string.
- Neon's `sql` tagged template parameterizes values. Never build SQL by string interpolation. Statements that tests must run on PGlite (see `stage-statements.ts`) are built with `sqlFragment` and `compileSql` instead, which parameterize the same way and nest.
- Use the kind names exported from `stage-kinds.ts` (`TERMINAL_KINDS`, `STALE_EXCLUDED_KINDS`, `RESOLVED_KINDS`, `INTERVIEW_KIND`, `DEFAULT_CREATE_KIND`) in queries and components instead of writing the literals.
- Comments explain why a thing is done, not what the code does.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
