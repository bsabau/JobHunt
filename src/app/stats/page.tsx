import Link from "next/link";
import { cookies } from "next/headers";
import { StatsCharts } from "@/components/stats-charts";
import { LogoutButton } from "@/components/logout-button";
import { Button } from "@/components/ui/button";
import { getStatsData } from "@/lib/db";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const stats = await getStatsData();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const readOnly = session?.role === "guest";

  return (
    <main className="mx-auto min-h-screen max-w-[1200px] px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-sky-300/80">
            Analytics{readOnly ? " · Guest (read-only)" : ""}
          </p>
          <h1 className="text-3xl font-bold">Application Stats</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/sankey">View Sankey</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">Back to Board</Link>
          </Button>
          <LogoutButton />
        </div>
      </div>
      <StatsCharts data={stats} />
    </main>
  );
}
