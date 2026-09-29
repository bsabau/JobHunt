import { StatsCharts } from "@/components/stats-charts";
import { PageHeader } from "@/components/page-header";
import { getStatsData } from "@/lib/db";
import { requirePageSession } from "@/lib/page-auth";
import { requestNow, resolveRequestTimeZone } from "@/lib/request-timezone";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requirePageSession();
  const readOnly = session.role === "guest";

  const timeZone = await resolveRequestTimeZone();
  const now = requestNow();
  const stats = await getStatsData(timeZone);

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-6 py-10">
      <PageHeader active="stats" readOnly={readOnly} />
      <StatsCharts data={stats} timeZone={timeZone} now={now} />
    </main>
  );
}
