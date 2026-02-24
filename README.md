# JobHunt App

Kanban-style job application tracker built with Next.js, TypeScript, Tailwind CSS, shadcn/ui-style components, and Neon Postgres.

## Features

- Dark-theme dashboard
- Kanban columns/stages with drag and drop
- Drag cards to recycle bin to delete
- Add/reorder/delete stages (stage delete blocked when not empty)
- Add application dialog with automatic company logo lookup from the internet
- Sankey diagram view for application flow transitions
- Neon Postgres persistence

## Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS v4
- Radix UI + shadcn/ui component patterns
- Neon serverless Postgres (`@neondatabase/serverless`)
- Recharts (Sankey)

## Environment

Create `.env.local` (or use `.env.example`) and set:

```bash
DATABASE_URL="postgresql://..."
```

For Vercel deployment, add the same `DATABASE_URL` value in Project Settings -> Environment Variables.

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

## Reset database

```bash
npm run reset:db
```

This clears applications/transitions and recreates default stages:
`Wishlist`, `Applied`, `Interview`, `Offer`, `Rejected`.

Open [http://localhost:3000](http://localhost:3000).
