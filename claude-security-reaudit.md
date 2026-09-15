<!-- Claude Code model: claude-fable-5-1; mode: audit; date: 2026-09-15 -->

# JobHunt: re-audit against the two prior reports

## Executive summary

This is a follow-up review of the branch `cursor/dashboard-board-insights` at `cb624fd`, checked against `claude-security-bug-assessment.md` (20 findings) and `change_audit_report.md` (3 standards + 9 spec findings). Every high-impact item from both reports is now closed in code, and the routine verification suite passes on Node 24.

No new high-confidence security vulnerability was found. The review did find **one new Medium correctness regression** introduced on this branch (the Sankey page can crash on a cyclic flow), **two Low spec deviations** in the stage-rewind logic, and a handful of Low hardening and residual items.

**Labels:** **Confirmed** means the defect is visible in the code and a concrete trigger follows from it (the Recharts recursion was reproduced locally). **Plausible** depends on conditions outside the repo. **Hardening** is not a bug today.

---

## Verification run (Node v24.18.0)

| Check | Result |
|---|---|
| `npm audit --omit=dev` | Pass, 0 vulnerabilities (next 16.3.5 in lockfile) |
| `npm run lint` | Pass |
| `npx tsc --noEmit --incremental false` | Pass |
| `npm run verify:auth` | Pass (covers guest revocation, rotation, tamper, expiry) |
| `npm run verify:timezone` | Pass |
| `git ls-files` for `.env*` | Only `.env.example` is tracked; `.gitignore` excludes the rest |

Not run: `npm run build`, dev server, any SQL against Neon.

---

## Status of prior findings

### `claude-security-bug-assessment.md`

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Hardcoded guest account | **Fixed** | `auth.ts:196` gates on `AUTH_GUEST_ENABLED === "true"` + `AUTH_GUEST_PASS`. Optional "hide notes from guests" was not done (see R-1). |
| 2 | Backward move deletes valid history | **Fixed** (with caveats) | `db.ts:442-513` single CTE chain. A→I→O then back to I yields A→I; back to the entry stage leaves no rows. See N-2 and N-3 for spec deviations. |
| 3 | Vulnerable Next/postcss/sharp/nanoid | **Fixed** | Audit clean; `images.unoptimized: true` in `next.config.ts`. |
| 4 | `ensureSchema()` caches failure | **Fixed** | `db.ts:111-117` resets the promise on rejection. |
| 5 | Authorization proxy-only | **Fixed** | `requireSession()` at the top of all 9 handlers; `requirePageSession()` before data fetch in all 3 pages. |
| 6 | No brute-force limit, non-constant-time compares | **Fixed** (partial) | Per-IP throttle in `login/route.ts`; SHA-256 digest compare for passwords; `crypto.subtle.verify` for signatures. Username still compared with `===` (see H-1). |
| 7 | Stage-move race, no in-flight guard | **Fixed** | `expectedStageId` guard in the UPDATE, 409 on mismatch, `pendingMoveIdsRef` lock in the board, edit dialog sends its loaded stage. |
| 8 | Avg-days-to-interview count wrong | **Fixed** | `COUNT(first_interview.transitioned_at)` and `null` tile when zero. |
| 9 | Timezone day-shift | **Fixed** | Viewer zone from `tz` cookie / Vercel geo header, validated with Intl, `AT TIME ZONE` bucketing, `daysUntil(date, zone)`. Cookie value is decoded correctly by Next's cookie parser (verified). |
| 10 | CSRF / login CSRF | **Fixed** | `proxy.ts:5-11` Origin + `Sec-Fetch-Site` check on every non-GET; `readJsonObject` rejects non-JSON with 415. |
| 11 | Sankey hides flows / "New" collision | **Fixed** (introduces N-1) | Entry node fixed at index 0, stage nodes keyed by name with offset, `new`/`created` reserved, node hover lists flow-through companies. The `source > target` client filter was removed in `b8a3f5a`, which is what enables N-1. |
| 12 | Stale measured from `updated_at` | **Fixed** | `stageEnteredAt` derived from latest transition into the current stage. |
| 13 | Error message leak, wrong status codes | **Fixed** | `errorResponse()` maps typed errors, generic 500 otherwise; 23505 → 409. |
| 14 | Loose integer validation | **Fixed** | `positiveInteger` accepts only integer numbers or `/^[1-9]\d*$/`, capped at int4 max. |
| 15 | Session lifecycle gaps | **Fixed** | Finite-expiry check, strict role parsing, keyed credential version. Logout still cannot revoke a copied token (stateless by design). |
| 16 | `x-user-role` on response | **Fixed** | Removed. |
| 17 | Non-atomic writes | **Fixed** (mostly) | Single DELETE for applications; conditional DELETE + resequence in one transaction for stages; `INSERT … SELECT MAX+1` for addStage; reorder folded into one guarded UPDATE; `t.id` tie-breakers added. No unique constraint on `sort_order` remains (R-3). |
| 18 | Logo lookup: no timeout, no allowlist | **Fixed** | 3 s `AbortSignal.timeout`, host allowlist, `referrerPolicy="no-referrer"`. |
| 19 | UI data-loss nits | **Fixed** | Delete confirmations, id-keyed reorder rollback, same-column drop skipped. |
| 20 | No input size limits | **Fixed** | `TEXT_LIMITS` enforced server-side and mirrored as `maxLength` on inputs. |

### `change_audit_report.md`

| ID | Finding | Status |
|---|---|---|
| STD-1 | Dependency audit fails | **Fixed** |
| STD-2 | Unused `x-user-role` header | **Fixed** (removed) |
| STD-3 | Duplicated stage-entry SQL | **Open** (R-2) |
| SPEC-1 | Token embeds unkeyed credential hash | **Fixed** (HMAC keyed by `AUTH_SECRET`, role-scoped) |
| SPEC-2 | Backward moves erase history | **Fixed** (see N-2) |
| SPEC-3 | Vulnerable versions installed | **Fixed** |
| SPEC-4 | Disabling guests does not revoke sessions | **Fixed** (version + explicit guest gate in `verifySessionToken`) |
| SPEC-5 | Authorization proxy-only | **Fixed** |
| SPEC-6 | No stage-move concurrency protection | **Fixed** |
| SPEC-7 | No rate limit / constant-time | **Fixed** (see H-1, H-3) |
| SPEC-8 | Timezone and Sankey partial | **Fixed** (see N-1) |
| SPEC-9 | Reorder atomicity, logo allowlist | **Fixed** (see R-3) |

---

## New findings

### N-1. Medium: the Sankey page crashes when the flow graph contains a cycle (Confirmed, regression)

- **Evidence:**
  - `src/components/sankey-chart.tsx:64-72` now keeps every link except self-loops. The `if (source > target) continue;` guard was removed in commit `b8a3f5a`.
  - Recharts 3.8.1 computes node depth with an unbounded recursion (`updateDepthOfTargets` in `node_modules/recharts/es6/chart/Sankey.js:91-105`) with no visited set. A cycle reachable from the entry node recurses until `RangeError: Maximum call stack size exceeded`. Reproduced locally with a 3-node graph `New→Wishlist`, `Wishlist→Applied`, `Applied→Wishlist`.
  - The rewind logic in `src/lib/db.ts:498-509` now records backward edges. When the target sorts before the stage the application was created in, `candidate_from` is empty and `COALESCE(…, c.stage_name)` inserts `current → target`.
- **Trigger (default stages, two applications):**
  1. Create app A. It lands in Applied (the first `active` stage). Drag it to Wishlist. `Applied → Wishlist` is inserted.
  2. Create app B in Wishlist, drag it to Applied. `Wishlist → Applied` is inserted.
  3. Open `/sankey`. The client component throws and Next renders "Application error: a client-side exception has occurred" for every viewer, including guests, until the data changes.
  - Stage reordering produces the same result from purely forward history: `A→I` from before a reorder plus `I→A` after it.
- **Impact:** total loss of the Sankey view, triggered by ordinary use. Not a security issue (owner-only writes), but it is the most visible regression on the branch.
- **Fix (pick one):**
  - Server-side, in `getSankeyData`: break cycles before returning. Since node order already follows `sort_order`, dropping links where `source > target` and returning a `hiddenBackward` count (rendered as a note) restores the previous DAG behaviour with the transparency the first audit asked for.
  - Or keep backward links but give the chart a cycle-safe layout: detect cycles with a DFS colouring pass and route back-edges to a duplicated "return" node, or switch to a Sankey implementation that supports circular links.
- **Regression checks:** a unit test on the pure Sankey aggregation with the two-app scenario above asserts either no cycle in the emitted links or a non-zero hidden count. A browser check confirms `/sankey` renders after the scenario.

### N-2. Low: rewinding to a previously visited stage replaces the kept edge instead of preserving it (Confirmed, spec deviation)

- **Spec:** assessment finding 2 asked "if the next node is the target, keep that transition too."
- **Evidence:** `src/lib/db.ts:488-509`. `backward_delete` removes every transition whose `to_status` sorts at or above the target, including the original edge into the target, and `backward_insert` writes a fresh edge with `NOW()`.
- **Trigger:** `Applied → Interview` on day 3, `Interview → Offer` on day 8, drag back to Interview on day 10. The graph is correct (`A→I` only), but the row's `transitioned_at` is day 10, not day 3.
- **Impact:** "Avg Days to Interview" (`db.ts:820-836`, `MIN(transitioned_at)` into an `interview` stage) now reports 10 instead of 3 for that application; the daily-transitions chart moves the event. `stageEnteredAt` becoming "now" is defensible and probably intended, so only the first-visit timing is lost.
- **Fix:** exclude the earliest edge into the target from `backward_delete` when it exists (the row `candidate_from` was derived from) and skip `backward_insert` in that case. If re-entry time should still be "now", keep the original row and add a separate `stage_entered_at` column instead of reusing transition timestamps.

### N-3. Low: moving before the creation stage records a backward edge and changes the entry stage (Plausible, product decision)

- **Evidence:** same CTE as N-2. With no earlier edge, `candidate_from` is empty and the insert falls back to `current_app.stage_name`, producing e.g. `Applied → Wishlist`.
- **Effect:** `entryStage` for that application (`db.ts:651-656`, first transition's `from_status`) stays Applied, so the funnel counts it as having reached Applied, which is accurate. The Sankey shows a backward flow, which is what feeds N-1.
- **Decision needed:** the first audit said clearing history is acceptable here. If backward edges are intentional, N-1 must be handled; if not, skip the insert when `candidate_from` is empty and the target sorts before the current stage.

---

## Hardening (new, not previously reported)

### H-1. Username comparison is not constant-time

- `src/lib/auth.ts:205`: `user === configuredUser` short-circuits before the digest compare. Fold the username into `constantTimeEqual` as well so a mismatch on either field takes the same time. Very low value to an attacker; cheap to close.

### H-2. No security response headers

- `next.config.ts` sets no `headers()`. There is no `X-Frame-Options` / `Content-Security-Policy: frame-ancestors`, `X-Content-Type-Options`, or `Referrer-Policy`. The board uses drag-and-drop on an authenticated session, so framing it from another origin is possible; the delete `confirm()` dialogs limit the damage. Vercel supplies HSTS on its own. Add at least `frame-ancestors 'none'` (or `X-Frame-Options: DENY`) and `X-Content-Type-Options: nosniff`.

### H-3. Login throttle keys on `x-forwarded-for` and lives in one instance

- `src/app/api/auth/login/route.ts:20-31`. On Vercel the header is overwritten by the platform, so it is not spoofable there; on any other host it is client-controlled and the throttle is bypassable. The code comment already states a platform rate limit is the durable fix. Keep that as the actual control and treat the in-memory counter as best effort only.

### H-4. Guest misconfiguration is discoverable through the login response

- With `AUTH_GUEST_ENABLED=true` and `AUTH_GUEST_PASS` unset, any POST with `user: "guest"` gets a 500 whose body says authentication is not configured (`login/route.ts:100-106`). Low information value, but return the generic 401 for the caller and log the configuration error server-side instead.

---

## Residual items carried over

| ID | Item | Location | Note |
|---|---|---|---|
| R-1 | Guests receive `notes` (may contain salary, recruiter contacts) | `api/applications/route.ts:19`, `db.ts:334-365` | Optional item from finding 1. Return a guest DTO without `notes` when `session.role === "guest"`. |
| R-2 | Stage-entry subquery duplicated four times | `db.ts:172-179`, `351-358`, `811-817`, `899-905` | STD-3. Extract one fragment or a view. |
| R-3 | No unique constraint on `stages.sort_order`; concurrent `addStage` can still collide | `db.ts:227-232` | Acknowledged Low in finding 17. |
| R-4 | Historical rows damaged by migration `1730000002000` were never audited | `migrations/1730000002000_cleanup-backward-transitions.mjs:35-50`, backup table `application_transitions_backup` | The original plan asked for a read-only query on a Neon branch. Still outstanding. |
| R-5 | Transitions into stages that were later deleted are neither rewound nor counted | `db.ts:473-476`, `493-495` | Edge case; they stay as orphan history. |
| R-6 | `formatDate` uses the runtime default locale | `stats-charts.tsx:47` | SSR and browser can format differently, producing hydration-mismatch text (cosmetic). Pass an explicit locale. |
| R-7 | Logout does not revoke a copied token | `api/auth/logout/route.ts` | Stateless sessions by design; 7-day window. |

---

## Recommended order

1. **N-1** (Sankey crash): restore a DAG guarantee server-side with a visible hidden-backward count, or add cycle detection. Add the two-app regression test.
2. **N-2 / N-3**: decide whether backward edges and re-timestamping are wanted; adjust `backward_delete` / `backward_insert` accordingly and add a `verify:transitions` script in the same `node:assert` style.
3. **H-2**, **H-1**: small config and one-line changes.
4. **R-1**: guest DTO without notes.
5. **R-4**: run the historical audit query on a Neon branch when convenient.
