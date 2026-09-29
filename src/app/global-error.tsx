"use client";

import "./globals.css";

// Replaces the root layout when that layout itself fails, so it brings its
// own <html>, <body> and styles. The app is always dark (see ThemeProvider).
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="dark">
      <body>
        <title>Something went wrong · JobHunt Board</title>
        <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
          <p className="text-xs uppercase tracking-[0.25em] text-sky-300/80">Job Tracker</p>
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The app could not start this page. Trying again often works; if it keeps failing, check the server logs.
          </p>
          {error.digest ? <p className="text-xs text-muted-foreground">Error reference: {error.digest}</p> : null}
          <div>
            <button
              type="button"
              onClick={() => retry()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
