# Combined security-fix change audit

## Executive summary

The combined changes improve validation, API error handling, stale-stage calculations, CSRF checks, and several UI failure modes. They are not ready to merge. The review found three high-impact correctness/security problems, several requested medium-priority fixes that remain absent, and one new credential-disclosure risk introduced by the session-version implementation.

Fixed point: `bef1ae0255dbf799f571b406a1e5a34e993489bc` (`git diff HEAD`, including uncommitted changes).

## Standards

### STD-1 — Hard violation: dependency security verification fails

- **Location:** `package.json:29`, `package.json:42`, `package.json:48`
- **Standard:** `AGENTS.md` requires `npm audit` as routine verification.
- **Evidence:** `npm audit --omit=dev` reports 1 critical, 3 high, and 1 moderate vulnerability. Next remains `^16.2.9`; `eslint-config-next` remains `^16.2.9`; the PostCSS override remains `^8.5.15`.
- **Required action:** upgrade to patched versions and rerun the audit until no high or critical findings remain.

### STD-2 — Judgment call: unused authorization header is speculative generality

- **Location:** `src/proxy.ts:45`
- The proxy now forwards `x-user-role`, but no route or page reads it. This adds another authorization-shaped mechanism without enforcing authorization in the data path. Delete it until a concrete consumer exists, or centralize authorization around a server-side helper.

### STD-3 — Judgment call: duplicated stage-entry SQL

- **Location:** `src/lib/db.ts:154`, `src/lib/db.ts:318`, `src/lib/db.ts:737`, `src/lib/db.ts:822`
- The same “latest transition into current stage, otherwise created_at” rule appears in several queries. This makes semantic fixes easy to apply inconsistently. A shared SQL view/helper or clearly named query fragment would reduce the duplication, provided parameterization remains intact.

## Spec

### SPEC-1 — High: session tokens disclose a password-derived owner credential hash

- **Spec:** finding 15 asked for credential-versioned sessions.
- **Location:** `src/lib/auth.ts:48`, `src/lib/auth.ts:61`
- **Evidence:** `credentialVersion()` computes plain SHA-256 over `AUTH_USER:AUTH_PASS`; `createSessionToken()` embeds that digest directly in the client-held token.
- **Impact:** when guest access is enabled, any guest can obtain an offline-verifiable hash derived from the owner credentials and brute-force weak owner passwords.
- **Fix:** make the version a keyed HMAC using `AUTH_SECRET`, or use an explicit server-managed `AUTH_SESSION_VERSION`. Never place a raw password-derived digest in a token.

### SPEC-2 — High: backward moves still erase valid history

- **Spec:** finding 2 required path truncation that preserves the transition into the target stage.
- **Location:** `src/lib/db.ts:411`
- **Evidence:** the delete removes every transition whose destination sort is at or above the target. PostgreSQL data-modifying CTEs share one snapshot, so the later `NOT EXISTS` still sees the transition being deleted and suppresses the replacement insert.
- **Trigger:** `Applied -> Interview -> Offer`, then move back to `Interview`. The `Applied -> Interview` and `Interview -> Offer` rows are deleted, while the replacement is skipped.
- **Fix:** implement the rewind as a pure, tested path transformation and write its result atomically. At minimum, preserve an existing edge into the target rather than deleting it.

### SPEC-3 — High: vulnerable dependency versions remain installed

- **Spec:** finding 3 required Next.js `>=16.3.3` plus patched transitive dependencies.
- **Location:** `package.json:29`, `package.json:42`, `package.json:48`
- `images.unoptimized: true` closes the image optimizer path, but it does not address the remaining Next.js, PostCSS, Nano ID, Sharp, or baseline-browser-mapping advisories.
- **Fix:** upgrade the packages and lockfile, then verify with `npm audit --omit=dev` and the production build.

### SPEC-4 — Medium: disabling guest access does not revoke issued guest sessions

- **Spec:** findings 1 and 15 require guest gating and credential rotation behavior.
- **Location:** `src/lib/auth.ts:48`, `src/lib/auth.ts:84`, `src/lib/auth.ts:102`
- `credentialVersion()` includes only owner credentials. Token verification never checks `AUTH_GUEST_ENABLED` or `AUTH_GUEST_PASS` for a guest token.
- **Confirmed:** a guest token remains valid after `AUTH_GUEST_ENABLED` is changed to `false` and the guest password is rotated.
- **Fix:** reject guest-role tokens when guest access is disabled and bind guest tokens to a keyed version of the guest configuration.

### SPEC-5 — Medium: authorization remains proxy-only

- **Spec:** finding 5 required `requireSession()` in every protected route and page before database access.
- **Location:** `src/app/api/applications/route.ts:15`, `src/app/page.tsx:9`, `src/app/board/page.tsx:9`, `src/app/sankey/page.tsx:9`
- No route handler performs its own session/role check, and pages still query the database before reading the session.
- **Fix:** enforce authentication and write authorization in route/page code, while retaining the proxy as an early gate.

### SPEC-6 — Medium: stage-move concurrency protection is absent

- **Spec:** finding 7 required conditional updates, `409` conflicts, `expectedStageId`, and an in-flight client guard.
- **Location:** `src/lib/db.ts:461`, `src/components/kanban-board.tsx:222`, `src/components/edit-application-dialog.tsx:78`
- The server still reads the current stage before its transaction and updates without an expected-stage predicate. The client still allows overlapping moves and stale edit submissions.
- **Impact:** concurrent requests can produce forked transition history and UI/DB disagreement.

### SPEC-7 — Medium: brute-force and constant-time authentication work is missing

- **Spec:** finding 6 required rate limiting and constant-time comparisons.
- **Location:** `src/lib/auth.ts:69`, `src/lib/auth.ts:102`, `src/app/api/auth/login/route.ts:11`
- Login has no visible rate limit; credentials and HMAC signatures still use `===`/`!==`.
- **False-positive note:** an external Vercel Firewall rule could supply rate limiting, but no such configuration is visible in the repository.

### SPEC-8 — Low: timezone and Sankey fixes are only partial

- **Spec:** findings 9 and 11.
- **Location:** `src/lib/db.ts:659`, `src/lib/db.ts:761`, `src/lib/db.ts:767`, `src/components/stats-charts.tsx:49`, `src/components/sankey-chart.tsx:55`
- Date-only display is fixed, but activity buckets still use the database timezone and the client/server “today” calculation can differ during SSR. Sankey now retains links whose source index exceeds the target index, but the `New` node collision, `Created` filtering, current-stage-only hover companies, and reserved-name behavior remain.

### SPEC-9 — Low: other atomicity and logo restrictions remain partial

- **Spec:** findings 17 and 18.
- **Location:** `src/lib/db.ts:221`, `src/lib/db.ts:201`, `src/lib/logo.ts:38`
- Reorder validation still happens outside its transaction. Concurrent `MAX(sort_order) + 1` inserts can produce duplicate sort orders because the schema has no unique constraint on `sort_order`. Logo fallback validation permits any HTTPS host rather than a host allowlist.

## Verification

- `npm run lint`: pass on Node 24.18.0.
- `npx tsc --noEmit --incremental false`: pass on Node 24.18.0.
- `npm run verify:auth`: pass, but it does not test guest-token invalidation.
- `npm run build`: pass on Node 24.18.0 outside the restricted sandbox.
- `git diff --check`: pass.
- `npm audit --omit=dev`: fail with 1 critical, 3 high, and 1 moderate vulnerability.

Summary: 3 Standards findings (worst: failed dependency security requirement) and 9 Spec findings (worst: exposed password-derived hash and destructive backward-transition behavior).
