import { StatsCharts } from "@/components/stats-charts";
import { PageHeader } from "@/components/page-header";
import { getStatsData } from "@/lib/db";
import { requirePageSession } from "@/lib/page-auth";
import { resolveRequestTimeZone } from "@/lib/request-timezone";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requirePageSession();
  const readOnly = session.role === "guest";

  const timeZone = await resolveRequestTimeZone();
  // One clock reading for the whole render, handed to the client components so
  // relative dates match between the server HTML and hydration. A server
  // component renders once per request, so reading the clock here is safe.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const stats = await getStatsData(timeZone);

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-6 py-10">
      <PageHeader active="stats" readOnly={readOnly} />
      <StatsCharts data={stats} timeZone={timeZone} now={now} />
    </main>
  );
}
