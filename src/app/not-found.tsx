import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageSession } from "@/lib/page-auth";

// Unknown URLs and notFound() calls. The proxy sends visitors without a
// session to /login first; requirePageSession() makes that hold here too, and
// tells a guest's header from the owner's.
export default async function NotFound() {
  const session = await requirePageSession();

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-6 py-10">
      <PageHeader readOnly={session.role === "guest"} />
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
