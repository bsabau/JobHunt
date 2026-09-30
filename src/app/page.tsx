import { StatsCharts } from "@/components/stats-charts";
import { PageHeader } from "@/components/page-header";
import { getStatsData } from "@/lib/db";
import { requirePageSession } from "@/lib/page-auth";
import { requestNow, resolveRequestTimeZone } from "@/lib/request-timezone";
import { parseStatsRange } from "@/lib/stats-range";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requirePageSession();
  const readOnly = session.role === "guest";

  const timeZone = await resolveRequestTimeZone();
  const now = requestNow();
  // Anything but an allowed range (?range=30 or 90) means all time.
  const range = parseStatsRange((await searchParams).range);
  const stats = await getStatsData(timeZone, { now, range, viewer: session.role });

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-6 py-10">
      <PageHeader active="stats" readOnly={readOnly} />
      <StatsCharts data={stats} timeZone={timeZone} now={now} readOnly={readOnly} />
    </main>
  );
}
