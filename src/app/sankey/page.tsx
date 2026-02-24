import Link from "next/link";
import { SankeyChart } from "@/components/sankey-chart";
import { Button } from "@/components/ui/button";
import { getSankeyData } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SankeyPage() {
  const sankey = await getSankeyData();

  return (
    <main className="mx-auto min-h-screen max-w-[1100px] px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-sky-300/80">Analytics</p>
          <h1 className="text-3xl font-bold">Application Flow</h1>
        </div>
        <Button variant="outline" asChild>
          <Link href="/">Back to Board</Link>
        </Button>
      </div>
      <SankeyChart data={sankey} />
    </main>
  );
}
