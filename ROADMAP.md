# Roadmap

Feature backlog, in priority order. The app is in daily use, so these are the next things worth building. Measured ideas for the stats page, and more features, are in `docs/PRODUCT-AUDIT-2026-09-29.md` (IDs such as F-3 refer to it). The steps, their order and the open decisions are in `docs/PRODUCT-PLAN.md`.

## Shipped

- **Board search**: find a card by company or role and jump to it.
- **Stats page** (`/`), for all time or the last 30 or 90 days: response, interview, offer and ghosted rates, median days to a reply and to a rejection, results by the week applications were sent and by job site, one funnel with the share of each lane's cards that went further, applications sent per week with a running total, outcomes, upcoming interviews.
- **Stale actions**: followed up, snooze 7 days, or close, from the stats page; a follow-up restarts the 14-day clock. Applications with no reply after N days (21 by default) can be closed in bulk.
- **Stale alerts**: cards that have sat for 14 days or more in a lane that can go stale (not a wishlist, offer or outcome lane) are flagged on the board and listed on the stats page.
- **Calendar export**: an optional interview time and zone, and an "Add to calendar" file for the owner.
- **Optional fields**: referral, work mode, location and salary (owner-only), with results by referral and work mode on the stats page.
- **Board filter**: narrows every lane by company or role, and a remembered toggle hides the rejected and closed lanes.
- **Application timeline**: the card dialog shows the lanes a card passed through, with dates and time in each; the guest gets a read-only version.
- **Sankey flow** (`/sankey`), lane types that carry the meaning of each lane, the applied date, and moving cards by keyboard.

## Next

Every step of `docs/PRODUCT-PLAN.md` has shipped. What remains is optional.

### Optional

Not needed now; built only on request (decision 19).

- Bulk import from CSV, with a preview, one logo lookup per company and a row cap.
- CSV export, which doubles as a personal backup (F-5).
