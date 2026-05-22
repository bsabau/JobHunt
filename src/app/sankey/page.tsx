import { cookies } from "next/headers";
import { SankeyChart } from "@/components/sankey-chart";
import { PageHeader } from "@/components/page-header";
import { getSankeyData } from "@/lib/db";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SankeyPage() {
  const sankey = await getSankeyData();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const readOnly = session?.role === "guest";

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-6 py-10">
      <PageHeader active="sankey" readOnly={readOnly} />
      <SankeyChart data={sankey} />
    </main>
  );
}
