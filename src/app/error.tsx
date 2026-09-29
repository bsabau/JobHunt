"use client";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Shown when a page fails to render, most often because the database could
// not be reached. In production `error.message` is generic; `digest` matches
// the server log entry.
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-6 py-10">
      <PageHeader />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This page could not be loaded. It is usually a passing database or network problem, so trying again often
            works.
          </p>
          {error.digest ? <p className="text-xs text-muted-foreground">Error reference: {error.digest}</p> : null}
          <Button onClick={() => retry()}>Try again</Button>
        </CardContent>
      </Card>
    </main>
  );
}
