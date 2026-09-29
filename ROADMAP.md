# Roadmap

Feature backlog, in priority order. The app is in daily use, so these are the next things worth building. Measured ideas for the stats page, and more features, are in `docs/PRODUCT-AUDIT-2026-09-29.md` (IDs such as F-3 refer to it). The steps, their order and the open decisions are in `docs/PRODUCT-PLAN.md`.

## Shipped

- **Board search**: find a card by company or role and jump to it.
- **Stats page** (`/`): pipeline totals, funnel and drop-off, applications and transitions over time, outcomes, upcoming interviews.
- **Stale alerts**: cards that have sat for 14 days or more in a lane that can go stale (not a wishlist, offer or outcome lane) are flagged on the board and listed on the stats page.
- **Board filter**: narrows every lane by company or role, and a remembered toggle hides the rejected and closed lanes.
- **Application timeline**: the card dialog shows the lanes a card passed through, with dates and time in each; the guest gets a read-only version.
- **Sankey flow** (`/sankey`), lane types that carry the meaning of each lane, the applied date, and moving cards by keyboard.

## Next

In the order of `docs/PRODUCT-PLAN.md`.

### 1. A stats page that says each thing once

Response, interview, offer and ghosted rates; one funnel chart instead of three; applications per week (M-1, R-1 to R-4).

### Later

- New metrics: time to hear back, results by application week, results by source, a date range filter (M-2 to M-5).
- Actions on stale applications: followed up, snooze, close (F-1).
- Close ghosted applications in bulk (F-2).
- Optional fields: referral, location, salary (owner-only) (F-6), and calendar export for interviews (F-7), last.

### Optional

Not needed now; built only on request (decision 19).

- Bulk import from CSV, with a preview, one logo lookup per company and a row cap.
- CSV export, which doubles as a personal backup (F-5).
