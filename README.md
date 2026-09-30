# JobHunt App

Kanban-style job application tracker built with Next.js, TypeScript, Tailwind CSS, shadcn/ui-style components, and Neon Postgres.

## Features

- Stats dashboard (`/`), for all time or the last 30 or 90 days: response, interview, offer and ghosted rates, median days to a reply and to a rejection, a funnel with the share of each lane's cards that went further, applications sent per week and what became of each week's, results by job site, outcomes, upcoming interviews, stale applications
- Stale applications can be marked followed up, snoozed for 7 days or closed from the stats page, and applications with no reply after N days closed in bulk
- Kanban board (`/board`) with drag and drop, search, a filter with "hide outcome lanes", and stale markers; each card's dialog shows its history (the lanes it passed through, with dates and time in each)
- Drag cards to recycle bin to delete
- Add/reorder/delete stages (stage delete blocked when not empty)
- Stage types (wishlist, pipeline, interview, offer, rejected, closed) that drive the statistics
- Add application dialog with automatic company logo lookup from the internet
- Sankey diagram (`/sankey`) of application flow transitions
- Owner login plus an optional read-only guest account
- Neon Postgres persistence

## Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS v4
- Radix UI + shadcn/ui component patterns
- Neon serverless Postgres (`@neondatabase/serverless`)
- Recharts (stats and Sankey)

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): domain model, schema, API, authentication
- [`docs/AUDIT-2026-09-29.md`](docs/AUDIT-2026-09-29.md): code audit findings
- [`docs/FIX-PLAN.md`](docs/FIX-PLAN.md): planned fixes
- [`AGENTS.md`](AGENTS.md): rules for coding agents

## Environment

Create `.env.local` (or use `.env.example`) and set:

```bash
DATABASE_URL="postgresql://..."
AUTH_USER="your-username"
AUTH_PASS="your-password"
AUTH_SECRET="generate-a-long-random-session-signing-secret"
```

`AUTH_SECRET` must be at least 32 characters.

Optional read-only guest access:

```bash
AUTH_GUEST_ENABLED="true"
AUTH_GUEST_PASS="a-separate-guest-password"
```

Signing in with the username `guest` and that password grants a session that can view the board, stats, and Sankey but never sees notes and cannot change data. The owner username must not be `guest`. Setting `AUTH_GUEST_ENABLED` to anything other than `true`, or rotating `AUTH_GUEST_PASS`, invalidates every issued guest session.

For Vercel deployment, add the same values in Project Settings -> Environment Variables.

## Database migrations

```bash
npm run migrate:up
```

Other commands:

```bash
npm run migrate:create -- <migration-name>
```

Run migrations before starting the app in a new environment.

## Run locally

```bash
npm install
npm run migrate:up
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
npm run check
```

Runs lint, typecheck and every test. The tests need no database.

## Reset database

```bash
npm run reset:db -- --yes
```

**Destructive.** This deletes every application, transition and stage in the database that `DATABASE_URL` points at and recreates the default stages. It refuses to run without `--yes`, against production, or when `PRODUCTION_DATABASE_URL` is not set. The default stages are:
`Wishlist`, `Applied`, `Interview`, `Offer`, `Rejected`.
