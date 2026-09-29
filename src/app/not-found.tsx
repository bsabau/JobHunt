import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Unknown URLs and notFound() calls. Only signed-in users get here; the proxy
// sends everyone else to /login first.
export default function NotFound() {
  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-6 py-10">
      <PageHeader />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Page not found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">There is nothing at this address.</p>
          <Button asChild>
            <Link href="/board">Go to the board</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
