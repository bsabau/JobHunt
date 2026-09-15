import { SankeyChart } from "@/components/sankey-chart";
import { PageHeader } from "@/components/page-header";
import { getSankeyData } from "@/lib/db";
import { requirePageSession } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function SankeyPage() {
  const session = await requirePageSession();
  const readOnly = session.role === "guest";

  const sankey = await getSankeyData();

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-6 py-10">
      <PageHeader active="sankey" readOnly={readOnly} />
      <SankeyChart data={sankey} />
    </main>
  );
}
