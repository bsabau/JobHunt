# Roadmap

Feature backlog, in priority order. The app is in daily use, so these are the next things worth building. Measured ideas for the stats page, and more features, are in `docs/PRODUCT-AUDIT-2026-09-29.md` (IDs such as F-3 refer to it).

## Shipped

- **Board search**: find a card by company or role and jump to it.
- **Stats page** (`/`): pipeline totals, funnel and drop-off, applications and transitions over time, outcomes, upcoming interviews.
- **Stale alerts**: cards that have sat for 14 days or more in a lane that can go stale (not a wishlist, offer or outcome lane) are flagged on the board and listed on the stats page.
- **Sankey flow** (`/sankey`), lane types that carry the meaning of each lane, the applied date, and moving cards by keyboard.

## Next

### 1. Bulk import from CSV

**Why:** adding many applications one by one is the biggest friction left in daily use.

- An "Import CSV" button next to "Add Application", with a preview table before anything is saved.
- Columns `company, role, source_url, notes`; company and role are required.
- A new owner-only endpoint that inserts the rows in one transaction and schedules the logo lookup for each (`scheduleLogoLookup()`), as a single create does.
- Imported cards land in the default lane (`DEFAULT_CREATE_KIND`). The result says how many were added and why any row failed.
- The duplicate-company check applies per row.
- Look up each company's logo once, not once per row, and cap the rows per file: every lookup calls Clearbit.

### 2. Application timeline (F-3)

**Why:** see how one application moved and how long it sat in each lane.

- Show the path with dates in the card dialog. The rows are already in `application_transitions`; the dialog needs an endpoint that returns them for one card, owner and guest alike (no notes involved).
- The path shows where the application stands, not every move ever made: rewinds rewrite it.

### 3. Board filter (F-4)

The search jumps to a card; a filter would narrow the board instead. A text filter over company and role, and a toggle that hides `rejected` and `closed` lanes. Client side only.

### Later

- Actions on stale applications: followed up, snooze, close (F-1).
- Close ghosted applications in bulk (F-2).
- CSV export, which doubles as a personal backup (F-5).
- The stats ideas in the product audit: rate tiles, time to hear back, results by application week (M-1 to M-3).
