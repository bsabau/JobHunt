<!-- Claude Code model: claude-opus-5; mode: plan; session: bafdad1e-df7d-43a4-a063-c68168144c28 -->

# JobHunt: security and functional review (plan only, nothing implemented)

## Context

You asked for a plan-mode review of the security and correctness of this Next.js 16 + Neon job tracker. I covered auth, authorization, API validation, CSRF, SQL integrity, UI concurrency, stage transitions, dates, stats and Sankey. I followed AGENTS.md and CLAUDE.md. I did not change any app file, did not read `.env.local`, did not contact the database, did not run migrations, and did not commit. The uncommitted change to `next-env.d.ts` is untouched.

**Scope read:** `src/proxy.ts`, `src/lib/{auth,api-validation,db,logo,constants,utils,types}.ts`, all 9 API routes, the 3 pages, the login page, `kanban-board`, the add/edit dialogs, `sankey-chart`, `stats-charts` (the data and date paths), the migrations and `scripts/`.

**Labels:** **Confirmed** means the defect is visible in the code and a concrete trigger follows from it. **Plausible** means it depends on timing, deployment or conditions outside the repo. **Hardening** means it is not a bug today, but it reduces risk.

---

## Safe verification run

| Check | Result |
|---|---|
| `npm run lint` | Pass, no findings |
| `npx tsc --noEmit --incremental false` | Pass. Incremental was off so `tsconfig.tsbuildinfo` was not rewritten |
| `npm run verify:auth` (env is faked inside the script, no DB) | Pass |
| `npm audit --omit=dev` | **5 vulns: 1 critical (`next` 16.2.9), 3 high (`nanoid`, `postcss` 8.5.15, `sharp` 0.34.5), 1 moderate (`baseline-browser-mapping`)** |
| Advisory triage (GitHub advisory pages) | GHSA-6gpp-xcg3-4w24 (proxy bypass) needs a single-entry `i18n.locales` config. This app has no i18n, so it does **not apply**. GHSA-2xp9-vwfh-vxw4 (AVIF RCE in the image optimizer) is **plausible**; see #3 |

**Skipped:**
- `npm run build`: it writes `.next` and can rewrite `next-env.d.ts`, which has your uncommitted change.
- Dev server, browser and runtime repro: plan mode.
- All SQL, migrations and `reset:db`: prohibited.
- Reading `.env*`: prohibited.
- `npm audit fix`: it mutates files.

**Note:** the shell ran Node **v22.22.3**, but `package.json` requires `>=24.16.0 <25`. The checks above ran on 22. Re-run them on 24.

---

## Prioritized findings

### P1: High

**1. Hardcoded guest account that is always on and exposes all data (Confirmed, security)**
- **Evidence:**
  - `src/lib/auth.ts:82`: `if (user === "guest" && pass === "guest") return "guest";`. It is checked before the env credentials and cannot be turned off.
  - `src/proxy.ts:29-35` blocks only non-GET `/api/*` for guests.
  - `GET /api/applications` (`src/app/api/applications/route.ts:15-18`) and all pages return everything.
- **Trigger:** anyone POSTs `{"user":"guest","pass":"guest"}` to `/api/auth/login`, then calls `GET /api/applications`.
- **Impact:** full read access for anyone on the internet. That includes every company, role, note (which can hold salary figures, recruiter contacts or personal remarks), job URL and interview date. The credential is easy to guess and not rate-limited (#6).
- **Fix:**
  - Gate guest access behind env vars, off by default. For example `AUTH_GUEST_ENABLED=true` plus `AUTH_GUEST_PASS`.
  - Optionally, hide notes from guests: return a guest-safe DTO from `listApplications` or the routes when the role is guest.
  - Update `scripts/verify-auth.mjs:40` to match.
- **Regression checks:**
  - `verify-auth`: guest login returns `null` when the flag is unset.
  - It returns `"guest"` only when the flag and password are set.
  - A guest token still gets 403 on POST, PATCH and DELETE.

**2. Moving a card backward deletes valid history (Confirmed, stage transitions and SQL integrity)**
- **Evidence:** `src/lib/db.ts:369-395`.
  - Every transition whose `to_status` sort is `>= target` is deleted, including the one that led into the target.
  - The replacement "from" is taken only from transitions with `to_status` sort `< target`.
  - The stage the app was created in has no such transition, so often nothing is inserted.
  - The migration `migrations/1730000002000_cleanup-backward-transitions.mjs:35-50` uses the same logic. Its "clean is empty means back to initial stage" assumption is wrong.
- **Trigger (default stages):**
  - Create an app in Applied, then drag it to Offer, then back to Interview. Both transitions are deleted and nothing is inserted.
  - Result: Sankey shows `New → Interview`, and the funnel's "Applied reached" count drops by 1.
  - Common real-world variant: Applied → Rejected → Interview.
  - Another: Applied → Interview → Offer → Interview. Here `Applied→Interview` is deleted even though it happened.
- **Impact:** permanent, silent loss of history, which skews Sankey, the funnel, conversion, drop-off and the transition counts. The deleted rows can't be recovered, except rows from before the migration that still sit in `application_transitions_backup`.
- **Fix:** replace the rewind with a path-truncation rule applied to the ordered path `[entry, to₁, to₂, …]`:
  - Keep nodes whose sort is below the target.
  - If the next node is the target, keep that transition too.
  - Otherwise insert `last_kept → target`. `last_kept` falls back to the entry stage, meaning the first transition's `from_status` or the stage at creation.
  - If the target sorts before the entry stage, clearing the history is acceptable (product decision).
  - Put the rule in a pure TS function, e.g. `rewindTransitionPath()` in a new `src/lib/transitions.ts`, and write the result in the same atomic statement as #7.
- **Regression checks (unit tests on the pure function):**
  - Applied→Offer→Interview keeps entry Applied and yields `Applied→Interview`.
  - A→I→O→I keeps `A→I` only.
  - Moving back to the entry stage leaves no transitions.
  - Skipping forward (A→O) is unchanged.
  - A no-op move leaves history unchanged.
- **Also:** add a one-off, read-only audit query to count apps whose first transition's `from_status` differs from the stage they were created in. Run it on a Neon branch.

**3. Next.js 16.2.9 and transitive dependencies have known critical and high advisories (Confirmed vulnerable version; exploitability Plausible)**
- **Evidence:** `package.json:30` (`next ^16.2.9`, lock pins 16.2.9). The audit output is above.
- **Relevance:**
  - GHSA-2xp9 (AVIF, libheif via sharp, RCE) affects `/_next/image`.
  - That path is **excluded from the proxy matcher** (`src/proxy.ts:44`), so it is unauthenticated.
  - `next.config.ts` still allows `logo.clearbit.com` and `images.crunchbase.com`, even though the app never uses `next/image` (`kanban-board.tsx:50-51` uses a plain `<img>`).
  - Several other advisories in the <16.2.11 range (server-action DoS, cache confusion) cover code paths this app mostly doesn't use.
- **Fix:**
  - Upgrade `next` and `eslint-config-next` to ≥16.3.3 and run `npm audit fix` to update postcss, sharp and nanoid. Raise the `postcss` override in `package.json` to the patched version.
  - Remove the unused `images.remotePatterns`, or set `images.unoptimized: true`, to close the optimizer entirely.
- **Regression checks:** `npm audit --omit=dev` shows 0 high or critical; `npm run build` passes; `/_next/image?url=…` returns 400 or 404.

**4. `ensureSchema()` caches a failed check for the life of the instance (Confirmed, availability)**
- **Evidence:** `src/lib/db.ts:59-88`. `schemaReadyPromise` is assigned once. If the first query rejects (a Neon cold-start blip, network error, or the check running before migrations), the rejected promise is reused forever.
- **Trigger:** a transient DB error on the first request after a deploy. Every later request on that warm Fluid Compute instance throws until it is recycled.
- **Impact:** a long partial outage caused by a one-off error.
- **Fix:** add `.catch((e) => { schemaReadyPromise = null; throw e; })`.
- **Regression check:** a unit test stubs `sql` to reject once and then resolve; the second call must succeed.

### P2: Medium

**5. Authorization lives only in the proxy (Hardening, defense in depth)**
- **Evidence:**
  - No route handler checks the session (`src/app/api/**`).
  - The pages fetch data *before* reading the session: `src/app/page.tsx:10` and 12-15, `board/page.tsx:10`, `sankey/page.tsx:10`.
  - The guest write block exists only in `proxy.ts:29-35`.
- **Impact:** any future proxy-bypass advisory (e.g. CVE-2025-29927, GHSA-6gpp), a matcher change or a new route exposes everything. The GHSA-6gpp advisory itself recommends enforcing authorization in the data path.
- **Fix:**
  - Add `requireSession({ write?: boolean })` in `src/lib/auth.ts`. It reads `cookies()`, reuses `safeVerifySessionToken`, and throws typed 401 or 403 errors.
  - Call it at the top of every route handler and page, before any DB access.
  - Keep the proxy as the first layer.
- **Regression checks:** a script calls each exported handler directly with no cookie, a guest cookie and a user cookie, and asserts 401, 403 and 2xx.

**6. Login has no brute-force protection and uses non-constant-time comparisons (Hardening)**
- **Evidence:**
  - `src/app/api/auth/login/route.ts` places no limit on attempts.
  - `auth.ts:87` compares the password with `===`.
  - `auth.ts:61` compares the HMAC signature with `!==`.
- **Impact:** unlimited online password guessing against a single owner account.
- **Fix:**
  - Add a Vercel Firewall rate-limit rule on `POST /api/auth/login`, or a small counter keyed by IP.
  - Verify signatures with `crypto.subtle.verify("HMAC", …)`, which is constant-time.
  - Compare credentials as SHA-256 digests of equal length.
- **Regression checks:** verify-auth tampered and valid token cases still pass; the 6th rapid attempt returns 429.

**7. Stage moves have a race window, and the UI has no in-flight guard (Confirmed code path; outcome is timing-dependent)**
- **Evidence:**
  - Server: the current stage is read outside the transaction (`db.ts:407-435` and `480-508`), then `transaction()` writes (`438-445`, `511-525`). The update is not conditioned on the stage that was read.
  - Client: `moveCard` (`kanban-board.tsx:221-243`) does no optimistic update and has no pending lock. It applies whichever response arrives last.
- **Trigger:** drag a card Applied→Interview, and within about 300 ms, before the card re-renders, drag it again to Offer. Two tabs also work. Both requests read `Applied`.
- **Impact:**
  - History ends up with `Applied→Interview` *and* `Applied→Offer`: a forked flow that is double-counted in the funnel.
  - The UI can show Interview while the DB holds Offer.
  - The edit dialog (`edit-application-dialog.tsx:80`) always sends the stage it loaded with, so saving from a stale tab silently reverts a move and records a transition.
- **Fix:**
  - Server: make each move one SQL statement built from data-modifying CTEs, starting with `UPDATE applications SET stage_id=$to, updated_at=NOW() WHERE id=$id AND stage_id=$expectedFrom RETURNING …`. Every transition CTE depends on that row.
  - If zero rows are updated, return 409.
  - Alternatively, use the `@neondatabase/serverless` `Pool` for an interactive transaction with `SELECT … FOR UPDATE`.
  - Client: send `expectedStageId`, disable dragging for a card with a pending request, apply an optimistic update with rollback, and ignore stale responses with a per-card request counter.
  - Edit PATCH: send `expectedUpdatedAt` for optimistic concurrency.
- **Regression checks:** fire two concurrent PATCHes with the same `expectedStageId` against a Neon branch. Exactly one returns 200, one returns 409, and the history is linear.

**8. The "Avg days to Interview" tile and its count are wrong (Confirmed, stats)**
- **Evidence:** `db.ts:686-698`. `JOIN LATERAL (SELECT MIN(...))` always returns one row, even with no matches, so `COUNT(*)` counts every application.
- **Trigger:** 3 apps, none of which have reached Interview. The tile shows `0` with "Based on 3 apps" (`stats-charts.tsx:169-173`) instead of "—" with "No apps reached Interview yet".
- **Fix:** use `COUNT(first_interview.transitioned_at)`, and compute AVG only over non-null values (AVG already ignores nulls; drop the `COALESCE(...,0)` and let a null become `null`).
- **Related (Low):**
  - The hardcoded lowercase names `'interview'`, `'rejected'`, `'wishlist'` and `'offer'` (`db.ts:684,697,762`; `constants.ts:7`) ignore custom stages.
  - The drop-off chart silently skips pairs where a later stage has more visits (`stats-charts.tsx:133`). That happens whenever a stage is skipped.
- **Regression check:** a fixture with 0 and 2 apps that reached Interview gives `null/0` and `avg/2`.

**9. Dates shift by a day depending on timezone (Confirmed for non-UTC users)**
- **Evidence and triggers:**
  - `stats-charts.tsx:39-42`: `new Date("2026-09-15")` parses as UTC midnight, so `toLocaleDateString` in America/* shows **Sep 14**. It is used for upcoming interviews (`:211`) and the chart labels (`:100,:105`). The board (`kanban-board.tsx:64-74`) parses local dates correctly, so the two views disagree.
  - `db.ts:753`: `interview_date >= CURRENT_DATE` uses the DB session timezone (UTC on Neon). At 18:00 in UTC-7, today's interview drops out of "Upcoming" while the board still says "Today".
  - `db.ts:701,707`: `date_trunc('day', …)` puts evening activity into the next UTC day.
  - SSR: `daysUntil` and `daysSince` (`constants.ts:13-40`) and `formatDate` run in the server's timezone during SSR and again in the browser, which risks hydration mismatches near midnight.
- **Fix:**
  - Share a date-only parser (reuse the regex logic from `formatInterviewDate`/`daysUntil`) and use it in `stats-charts`.
  - Return all interview rows with `interview_date >= CURRENT_DATE - 1` and filter by the client's local "today", or pass the client timezone.
  - Bucket days with `AT TIME ZONE $tz` from a cookie or header, defaulting to UTC.
  - Render relative labels ("Today", "Stale · Nd") client-side only.
- **Regression checks:** run unit tests with `TZ=America/Los_Angeles` and `TZ=Pacific/Auckland`. `formatDate("2026-09-15")` must contain "15". An interview "today" at 23:00 local must be listed.

**10. No CSRF defense beyond SameSite=Lax; login CSRF is possible (Hardening; login CSRF Confirmed as low impact)**
- **Evidence:**
  - `readJsonObject` (`api-validation.ts:22-36`) parses any Content-Type.
  - The proxy does no Origin or `Sec-Fetch-Site` check.
  - The login route is outside auth (`proxy.ts:6-11`).
  - The cookie is `sameSite: "lax"` (`login/route.ts:28`).
- **Triggers:**
  - (a) A cross-site page auto-submits `<form method=POST enctype=text/plain action=/api/auth/login>` with the field name `{"user":"guest","pass":"guest","x":"` and the value `"}`. This is a top-level navigation, so the Set-Cookie is accepted and replaces the owner's session with a guest session.
  - (b) An attacker-controlled *same-site* origin (a sibling subdomain on a custom domain) can send simple `text/plain` POSTs with cookies to `/api/applications`, `/api/stages` and `/api/auth/logout`.
- **Fix:**
  - In `proxy.ts`, for every non-GET/HEAD request, including login, require `Sec-Fetch-Site ∈ {same-origin, none}` or an `Origin` equal to `request.nextUrl.origin`.
  - In `readJsonObject`, reject any Content-Type that is not `application/json` with 415.
- **Regression checks:** a POST with `Origin: https://evil.example` gets 403; `text/plain` gets 415; the normal UI flows keep working.

**11. Sankey hides flows and mislabels nodes (Confirmed)**
- **Evidence:**
  - Node order is `New`, then the current stages, then stage names that appear only in transitions, then entry stages (`db.ts:608-613`).
  - The client drops any link where `source > target` (`sankey-chart.tsx:75`) and drops self-loops (`:71`).
- **Triggers:**
  - (a) Reorder so Interview comes before Applied. Every historical `Applied→Interview` link disappears, and node values no longer balance.
  - (b) Delete an empty stage that has history. It sorts after the current stages, so links *from* it vanish.
  - (c) Add a stage named "New". It merges with the entry node, its `New→New` entry links are dropped, and its outflows look like fresh entries.
  - (d) Add a stage named "Created". Every transition into or out of it is excluded by the legacy filters `LOWER(...) <> 'created'` (`db.ts:553,673-674,709-710,735,743-744`).
  - (e) Node hover lists only the companies *currently* in the stage (`db.ts:567-571`, `sankey-chart.tsx:96`) while the value counts all flow through it.
- **Fix:**
  - Reserve the entry node with a non-colliding key (e.g. `__entry__`, displayed as "New").
  - Reject the stage names `new` and `created`, case-insensitively, in `addStage`, or move the legacy filter behind a one-time cleanup and drop it.
  - Order nodes by first-seen topological position from the transitions, not by current sort order. Or keep the DAG filter but show "N backward/hidden transitions" and aggregate them separately.
  - Collect node companies from the flow rows.
- **Regression checks:** unit-test `getSankeyData`'s pure aggregation, extracted as a function, with reordered stages, a deleted stage, and stages named "New" and "Created". The sum of inflow must equal the sum of outflow plus the current count.

### P3: Low

**12. "Days in current stage" and "Stale" really measure time since the last edit (Confirmed, semantic)**
- **Evidence:** `db.ts:681` and `:759`, and `constants.ts:25` all use `updated_at`. Every edit bumps it (`db.ts:521,536`).
- **Trigger:** editing only the notes of a 30-day-stale Applied card clears "Stale" and resets the average.
- **Fix:** derive the stage-entry time as `COALESCE(latest transition to the current stage, created_at)`, or add a `stage_entered_at` column through a new migration that only the user runs.
- **Regression check:** a notes-only edit leaves stale status unchanged.

**13. Internal error messages leak, and status codes are wrong (Confirmed)**
- **Evidence:**
  - Non-validation errors return `error.message` with 400: `applications/route.ts:47-50`, `[id]/route.ts:43-46`, `status/route.ts:32-35`, `stages/route.ts:24-27`, `reorder/route.ts:25-28`.
  - The DELETE handlers call the DB outside `try` (`[id]/route.ts:63`, `stages/[id]/route.ts:22`).
- **Triggers:**
  - A duplicate stage name returns `duplicate key value violates unique constraint "stages_name_key"`.
  - A DB outage returns a Neon or driver message as a 400.
  - `DELETE /api/applications/3000000000` returns an unhandled 500 (int4 overflow).
- **Fix:**
  - Add typed domain errors (`NotFoundError`, `ConflictError`, `InvalidStageError`) in `db.ts`.
  - Map Postgres `23505` to a 409 saying "Stage already exists".
  - Return a generic 500 otherwise and log the detail server-side.
  - Wrap the DELETE handlers.
- **Regression check:** a duplicate stage name gets 409 with a friendly message; a simulated DB failure gets 500 with a generic body.

**14. Integer validation is too loose (Confirmed)**
- **Evidence:** `api-validation.ts:62-74` uses `Number(value)`.
- **Triggers:** these are accepted:
  - `/api/applications/0x10` targets id 16.
  - `"1e3"` becomes 1000.
  - `" 7 "` becomes 7.
  - JSON `stageId: true` becomes 1.
  - `[5]` becomes 5.
  - Anything above 2147483647 reaches Postgres and errors.
- **Fix:** accept only `typeof number` integers, or strings matching `/^[1-9]\d*$/`, and cap at 2147483647.
- **Regression check:** a table-driven test covers each case above.

**15. Session lifecycle gaps (Hardening)**
- **Evidence:** `auth.ts:46-66`.
  - Tokens are stateless and last 7 days.
  - Logout (`logout/route.ts`) only clears the cookie, so a copied token stays valid.
  - Changing `AUTH_PASS` doesn't invalidate existing sessions.
  - `Number("abc")` gives NaN, and `Date.now() > NaN` is false, so such a token would never expire. Only server-signed tokens can reach this check, so it isn't exploitable today.
  - Any signed role label other than `guest` maps to `user` (fails open).
- **Fix:**
  - Put a credential version (e.g. a hash of `AUTH_USER:AUTH_PASS`) into the HMAC payload.
  - Require `Number.isFinite(expires)`.
  - Accept only `user|guest` and treat anything else as invalid.
  - Consider a shorter max age.

**16. The `x-user-role` header is set on the response, not the request (Hardening)**
- **Evidence:** `proxy.ts:37-39`. The comment says server components can read it, but `NextResponse.next()` headers go to the browser. Nothing reads it (grep confirmed).
- **Risk:** a future `headers().get("x-user-role")` would read a header the client controls, so a guest could claim to be the owner.
- **Fix:** delete it. If it's needed, strip the incoming header and pass it with `NextResponse.next({ request: { headers } })`.

**17. Multi-step writes are not atomic (Low, SQL integrity)**
- `deleteApplication` (`db.ts:451-466`) runs two separate DELETEs, and the first is redundant because the FK has `ON DELETE CASCADE` (`migrations/…init-schema.mjs:28`). **Fix:** keep only the single DELETE.
- `deleteStage` (`db.ts:231-266`) runs count, delete and resequence as separate statements. A concurrent move hits the FK RESTRICT and returns an unhandled 500. **Fix:** use one statement, `DELETE … WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM applications WHERE stage_id=$1)`, with the resequence in the same `transaction()`.
- `addStage` (`db.ts:178-189`) computes MAX+1 and then inserts, so concurrent adds get duplicate `sort_order`. **Fix:** use `INSERT … SELECT COALESCE(MAX(sort_order),-1)+1 FROM stages`.
- `reorderStages` validates outside the transaction (`:201-218`).
- The entry-stage subqueries order by `transitioned_at` with no tie-breaker (`db.ts:558-560`, `725-727`). **Fix:** add `, t.id ASC`.

**18. Third-party logo lookup: no timeout and a privacy leak (Hardening)**
- **Evidence:** `logo.ts:8-11` has no `AbortSignal.timeout`, so a slow Clearbit stalls `POST /api/applications`.
- Company names are sent to Clearbit, and domains to Google S2, on every view by any viewer, including guests (`kanban-board.tsx:51`).
- The `match.logo` value is stored and rendered without any host allowlist.
- **Fix:** add a 2–3 s timeout, allowlist `https:` logo hosts, and set `referrerPolicy="no-referrer"` on the `<img>`. Also confirm the Clearbit autocomplete endpoint still works.

**19. UI data-loss and concurrency nits (Low)**
- Dropping a card or stage on the bin deletes it immediately with no confirmation (`kanban-board.tsx:357-373`). **Fix:** add `confirm()` or an undo toast.
- The reorder rollback `setStages(current)` (`:320-323`) discards any stage added while the request was in flight. **Fix:** roll back through a functional update keyed by id.
- Dropping a card on its own column still sends a PATCH (`:334-336`). **Fix:** skip the request when the stage is unchanged.

**20. No input size limits (Hardening)**
- `company`, `role`, `notes`, `sourceUrl` and the stage name are unbounded (`api-validation.ts:38-60`).
- **Fix:** add a `maxLength` option to `requiredString`/`optionalString`, for example 200 for company, role and stage name, 10 000 for notes and 2 048 for URLs. Add matching `maxLength` attributes to the inputs.

---

## Remediation plan

**Phase 0: immediate, low risk**
1. Upgrade `next` and `eslint-config-next` to ≥16.3.3, run `npm audit fix`, bump the `postcss` override, and remove `images.remotePatterns` (#3).
2. Put guest access behind env flags, off by default (#1).
3. Add a Vercel Firewall rate limit on `/api/auth/login` (#6).
4. Reset `schemaReadyPromise` on failure (#4).

**Phase 1: data integrity**
1. Add `src/lib/transitions.ts` with the pure path-rewind function (#2) and unit tests.
2. Rewrite `updateApplicationStage` and `updateApplication` so each move is one conditional statement with 409 on conflict (#7). The client sends `expectedStageId` and gets a pending lock and optimistic rollback.
3. Make stage and application deletes and `addStage` atomic, and add the tie-breakers (#17).
4. Fix the interview count and average (#8).
5. Optional: a read-only audit query for history already damaged by #2. The user runs it on a Neon branch.

**Phase 2: security hardening**
1. Add `requireSession()` to every route and page (#5).
2. Add Origin/`Sec-Fetch-Site` checks in the proxy and the JSON Content-Type check (#10).
3. Switch to constant-time comparisons and add a credential version, finite expiry check and strict role to tokens (#6, #15). Remove `x-user-role` (#16).
4. Add typed errors and generic 500s (#13), strict integer parsing (#14), length limits (#20), and the logo timeout and allowlist (#18).

**Phase 3: analytics correctness and UX**
1. Date-only parsing and timezone-aware "today" and bucketing (#9).
2. Sankey: reserved entry key, reserved stage names, topological node order, hidden-flow notice, correct node companies (#11).
3. Stage-entry time instead of `updated_at` (#12). If this adds a column, the migration is written but run only by the user.
4. Delete confirmation and reorder rollback fix (#19).

**Critical files:** `src/lib/auth.ts`, `src/proxy.ts`, `src/lib/api-validation.ts`, `src/lib/db.ts`, `src/lib/logo.ts`, `src/components/kanban-board.tsx`, `src/components/stats-charts.tsx`, `src/components/sankey-chart.tsx`, `src/components/edit-application-dialog.tsx`, the API routes under `src/app/api/`, `next.config.ts`, `package.json`. New file: `src/lib/transitions.ts`.

**Reuse:**
- Local date parsing: `formatInterviewDate` and `daysUntil` in `constants.ts`.
- Token verification: `safeVerifySessionToken`.
- Atomic batches: `transaction()` in `db.ts`.
- Test style: the `node:assert` script pattern in `scripts/verify-auth.mjs`. The repo has no test framework, so add `scripts/verify-*.mjs` scripts in the same style.

## Verification after implementation

1. On Node 24.16: `npm audit --omit=dev` (0 high/critical), `npm run lint`, `npx tsc --noEmit`, `npm run build`. These are the AGENTS.md routine checks.
2. `npm run verify:auth`, extended for #1, #6 and #15, plus new `verify-validation`, `verify-transitions`, `verify-sankey` and `verify-dates` scripts. Run the dates script under several `TZ` values.
3. On a **disposable Neon branch**, with your go-ahead: `migrate:up`, then scripted API scenarios.
   - Backward moves (#2).
   - Concurrent PATCHes that must produce 409 and a linear history (#7).
   - Guest and owner access matrix (#1, #5).
   - Origin and Content-Type rejection (#10).
   - Duplicate stage returns 409 (#13).
   - Big ids return 400 (#14).
4. Manual browser pass with `npm run dev`:
   - Drag forward and backward, then check that Sankey and the stats funnel match the expected path.
   - Reorder stages and confirm no links vanish silently.
   - Set the OS timezone to UTC-7 and confirm the dashboard and board show the same interview date.
