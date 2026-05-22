import { cookies } from "next/headers";
import { StatsCharts } from "@/components/stats-charts";
import { PageHeader } from "@/components/page-header";
import { getStatsData } from "@/lib/db";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const stats = await getStatsData();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const readOnly = session?.role === "guest";

  return (
    <main className="mx-auto min-h-screen max-w-[1200px] px-6 py-10">
      <PageHeader active="stats" readOnly={readOnly} />
      <StatsCharts data={stats} />
    </main>
  );
}
