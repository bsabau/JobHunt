# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Kanban-style job application tracker. Users add job applications, drag them between pipeline stages (Wishlist → Applied → Interview → Offer → Rejected), and view a Sankey diagram of transitions.

## Commands

- `npm run dev` — start dev server (Next.js with Turbopack) at localhost:3000
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run migrate:up` — run database migrations (required before first run)
- `npm run migrate:create -- <name>` — scaffold a new migration
- `npm run reset:db` — drop all data and recreate default stages

## Architecture

**Next.js App Router** with server-side rendering. The home page (`src/app/page.tsx`) is a server component that fetches data and passes it to the client-side `KanbanBoard`.

### Data flow

- **Database**: Neon serverless Postgres via `@neondatabase/serverless`. All queries in `src/lib/db.ts` using the tagged template `sql` function.
- **API routes** (`src/app/api/`): REST endpoints for applications (CRUD + stage moves), stages (CRUD + reorder), and sankey data. Stage moves record transitions in `application_transitions` table.
- **Logo lookup**: `src/lib/logo.ts` uses Clearbit autocomplete → Google S2 favicons for company logos.

### Key modules

- `src/lib/db.ts` — all database access; exports functions consumed by API routes and the server component. Uses `ensureSchema()` guard that checks tables exist on first query.
- `src/lib/types.ts` — shared TypeScript interfaces (`Stage`, `Application`, `SankeyPayload`).
- `src/lib/constants.ts` — default stage names and color tones.
- `src/components/kanban-board.tsx` — main client component with drag-and-drop.
- `src/components/sankey-chart.tsx` — Recharts Sankey visualization (route: `/sankey`).
- `src/components/ui/` — shadcn/ui-style primitives (Radix UI + Tailwind).

### Database schema

Three tables: `stages`, `applications`, `application_transitions`. Managed by custom migration runner in `scripts/` with migration files in `migrations/` (timestamp-prefixed `.mjs` files). The migration runner tracks applied migrations in a `schema_migrations` table.

### Environment

Requires `DATABASE_URL` in `.env.local` pointing to a Neon Postgres connection string.

## Conventions

- Tailwind CSS v4 (PostCSS plugin, not the older config-based setup)
- UI components follow shadcn/ui patterns with `cn()` utility from `src/lib/utils.ts`
- DB column names are snake_case; TypeScript interfaces use camelCase; `mapApplication()` in `db.ts` handles the mapping
- Neon's `sql` tagged template handles parameterization — never interpolate user input directly
