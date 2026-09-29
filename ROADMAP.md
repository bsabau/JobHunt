# Roadmap

Feature backlog, in priority order. The app is in daily use, so these are the next things worth building. Measured ideas for the stats page, and more features, are in `docs/PRODUCT-AUDIT-2026-09-29.md` (IDs such as F-3 refer to it). The steps, their order and the open decisions are in `docs/PRODUCT-PLAN.md`.

## Shipped

- **Board search**: find a card by company or role and jump to it.
- **Stats page** (`/`): pipeline totals, funnel and drop-off, applications and transitions over time, outcomes, upcoming interviews.
- **Stale alerts**: cards that have sat for 14 days or more in a lane that can go stale (not a wishlist, offer or outcome lane) are flagged on the board and listed on the stats page.
- **Sankey flow** (`/sankey`), lane types that carry the meaning of each lane, the applied date, and moving cards by keyboard.

## Next

In the order of `docs/PRODUCT-PLAN.md`.

### 1. Application timeline (F-3)

**Why:** see how one application moved and how long it sat in each lane.

- Show the path with dates in the card dialog. The rows are already in `application_transitions`; the dialog needs an endpoint that returns them for one card, owner and guest alike (no notes involved).
- The path shows where the application stands, not every move ever made: rewinds rewrite it.

### 2. Board filter (F-4)

The search jumps to a card; a filter would narrow the board instead. A text filter over company and role, and a toggle that hides `rejected` and `closed` lanes. Client side only.

### 3. A stats page that says each thing once

Response, interview, offer and ghosted rates; one funnel chart instead of three; applications per week (M-1, R-1 to R-4).

### Later

- New metrics: time to hear back, results by application week, results by source, a date range filter (M-2 to M-5).
- Actions on stale applications: followed up, snooze, close (F-1).
- Close ghosted applications in bulk (F-2).

### Optional

Not needed now; built only on request.

- Optional fields: referral, location, salary (F-6).
- Calendar export for interviews (F-7).
- Bulk import from CSV, with a preview, one logo lookup per company and a row cap.
- CSV export, which doubles as a personal backup (F-5).
