# Product audit, 2026-09-29

A review of the stats page and the app from the user's side: which charts repeat each other, which numbers are missing, and which features would help. The code audit of the same date is `docs/AUDIT-2026-09-29.md`; its fixes are planned in `docs/FIX-PLAN.md`. Nothing here is planned or implemented yet; this is a list to choose from.

IDs are for reference only: `R` removes or merges, `M` adds a metric, `F` adds a feature.

## Summary

| ID | Idea | Needs new data | Depends on | Size |
|---|---|---|---|---|
| R-1 | Merge funnel, drop-off and conversion into one chart | no | | small |
| R-2 | Weekly bars with a cumulative line for applications over time | no | | small |
| R-3 | Drop the daily transitions chart | no | | tiny |
| R-4 | Replace two summary tiles | no | M-1 | tiny |
| M-1 | Rate tiles: response, interview, offer, ghosted | no | 5.4 | small |
| M-2 | Time to hear back | no | 5.4 | small |
| M-3 | Results by application week (cohorts) | no | 5.4 | medium |
| M-4 | Results by source | no | | small |
| M-5 | Date range filter on the stats page | no | | small |
| F-1 | Actions on stale applications | yes | | medium |
| F-2 | Close ghosted applications in bulk | no | | small |
| F-3 | Application timeline in the card dialog | no | | small |
| F-4 | Search and filter on the board | no | | small |
| F-5 | CSV export | no | | small |
| F-6 | Optional fields: referral, location, salary | yes | | medium |
| F-7 | Calendar export for interviews | yes | | small |

"5.4" is the applied date in `docs/FIX-PLAN.md`, made simpler by the entry column in 3.5.

**Recommended first:** M-3, R-1 and F-1. R-1, M-4, M-5 and F-4 do not depend on the fix plan and can be done at any time.

---

## Remove or merge

The stats page answers "how far do applications get?" four times:

| Chart | Shows |
|---|---|
| Funnel: Stages Visited | how many applications reached each lane |
| Pipeline Drop-off | the fall between neighbouring pipeline lanes of that funnel |
| Stage-to-Stage Conversion | the share moving from each lane to each other lane |
| Applications by Stage | how many sit in each lane now |

Drop-off is derived entirely from the funnel, and the conversion pairs are the same flows the Sankey draws with counts.

### R-1 One funnel chart

Replace Funnel, Pipeline Drop-off and Stage-to-Stage Conversion with a single funnel. Each bar is the number of applications that reached the lane; the label between two bars is the share that advanced. The per-pair detail stays on `/sankey`. Keep Applications by Stage, since it is the only view of where things stand today.

The funnel must keep ranking lanes with `compareStageRank()` and must keep excluding terminal lanes from the advance rate, as drop-off does now.

### R-2 Applications over time

The chart draws the cumulative total and the daily count on one axis. Once the total grows, the daily line is flat along the bottom. Show weekly bars for applications added, with the cumulative total as a line on a second axis. Weekly buckets must use the viewer's time zone, as the daily ones do.

### R-3 Daily Stage Transitions

It counts every move, including moves into Rejected, so a busy day of rejections looks like progress. Drop it, or fold activity into R-2.

### R-4 Summary tiles

- **Stage Transitions** is a count that answers no question.
- **Avg Days Since Created** averages over applications that are already closed or rejected, so it grows forever.

Replace both with tiles from M-1.

---

## New metrics

None of these need a schema change. M-1 to M-3 should count from the applied date (the first move out of an `intake` lane, see fix plan 5.4), not from `created_at`. Otherwise a card that sat in Wishlist for a month looks slow to get a reply.

Because `application_transitions` holds the current path and a rewind rewrites it, these metrics describe where applications stand, not every move that was ever made. That is fine for all of them.

### M-1 Rate tiles

Each as a share of applications that were actually applied to (left `intake`):

- **Response rate**: moved past the lane it was applied in, including straight to `rejected`.
- **Interview rate**: reached any `interview` lane.
- **Offer rate**: reached an `offer` lane.
- **Ghosted rate**: currently in a `closed` lane.

Use the lane kinds, never lane names.

### M-2 Time to hear back

Median days from applying to the first move out of the lane it was applied in, and median days from applying to a rejection. Medians, because one application that took four months would drag an average.

Once there is enough data, this can inform `STALE_THRESHOLD_DAYS`, which is a fixed 14 days today.

### M-3 Results by application week

Group applications by the week they were applied, and for each week show the share that got a response, reached an interview and got an offer. This shows whether a change of CV, target roles or approach made a difference. Recent weeks will look worse only because they have had less time, so mark weeks younger than the M-2 median as still open.

### M-4 Results by source

Group by the host of `source_url` (linkedin.com, a company careers site, a job board) and show the M-1 rates per group. Hosts with one or two applications go into "Other". Applications without a URL go into "Unknown".

### M-5 Date range filter

30 days, 90 days, all time. Filter by applied date so that a range means "applications sent in this period".

---

## Features

### F-1 Actions on stale applications

Each row of the stale list gets:

- **Followed up**: records the date and restarts the stale clock.
- **Snooze 7 days**: hides it until then.
- **Close**: moves it to the closed lane, using the normal stage move with `expectedStageId`.

The first two need a nullable `next_action_date DATE` on `applications`, handled as a `YYYY-MM-DD` string like `interview_date`. Staleness then becomes "past `next_action_date`, or 14 days in the lane when there is none". Owner only: the guest must not see these actions.

### F-2 Close ghosted applications in bulk

Offer to move every application with no reply after N days (default the M-2 median, else 30) into the `closed` lane. Show the list and move them only after one confirmation. Each move goes through the normal stage-move path, so history stays correct.

### F-3 Application timeline

Show the application's path with dates in the card dialog. The data is already in `application_transitions`; the dialog only needs the rows. Remember that the path shows where the application stands, not every move ever made.

### F-4 Board search and filter

A text filter over company and role, and a toggle to hide `rejected` and `closed` lanes. Client side only.

### F-5 CSV export

One row per application with current lane, applied date and interview date. Owner only, since it includes notes. Also useful as a personal backup.

### F-6 Optional fields

Referral (yes or no), location or remote, salary range. Each gives the stats a new way to split the data (interview rate with a referral versus without). Salary must be hidden from the guest the same way notes are, and every caller that serves a guest must redact it.

### F-7 Calendar export for interviews

An `.ics` link per interview. Needs an optional interview time. Keep `interview_date` as a `DATE` and add a separate time and time zone, rather than turning it into a timestamp and taking on its time-zone pitfalls.
