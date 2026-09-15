"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { StatsPayload } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STAGE_COLORS: Record<string, string> = {
  new: "#64748b",
  wishlist: "#94a3b8",
  applied: "#60a5fa",
  screening: "#a78bfa",
  interview: "#818cf8",
  ghosting: "#cbd5e1",
  offer: "#34d399",
  rejected: "#f87171",
};
const FALLBACK_COLOR = "#94a3b8";
const PALETTE = ["#60a5fa", "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#818cf8", "#22d3ee", "#fb7185"];

function colorFor(name: string, fallbackIndex = 0): string {
  return STAGE_COLORS[name.toLowerCase()] ?? PALETTE[fallbackIndex % PALETTE.length] ?? FALLBACK_COLOR;
}

function formatDate(value: string): string {
  // A date-only PostgreSQL value must be formatted as a calendar date. Parsing
  // it with Date treats it as UTC midnight and shifts it for western timezones.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isTodayOrFuture(value: string): boolean {
  const today = new Date();
  const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return value >= todayValue;
}

interface SummaryTileProps {
  label: string;
  value: string | number;
  hint?: string;
}

function SummaryTile({ label, value, hint }: SummaryTileProps) {
  return (
    <Card>
      <CardContent className="px-5 py-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
        <p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const tooltipStyle = {
  background: "rgb(var(--popover, 15 23 42))",
  border: "1px solid rgb(var(--border, 51 65 85))",
  borderRadius: 8,
  fontSize: 12,
};

export function StatsCharts({ data }: { data: StatsPayload }) {
  const upcomingInterviews = useMemo(
    () => data.upcomingInterviews.filter((row) => isTodayOrFuture(row.interviewDate)),
    [data.upcomingInterviews]
  );
  const stageData = useMemo(
    () => data.stageCounts.map((row) => ({ ...row, fill: colorFor(row.stage) })),
    [data.stageCounts]
  );

  const conversionData = useMemo(() => {
    const reachedMap = new Map<string, number>();
    const sortMap = new Map<string, number>();
    for (const f of data.funnel) {
      reachedMap.set(f.stage, f.reached);
      sortMap.set(f.stage, f.sortOrder);
    }
    const rows: { transition: string; rate: number; fill: string; fromSort: number; toSort: number }[] = [];
    for (const p of data.stagePairs ?? []) {
      const fromReached = reachedMap.get(p.from) ?? 0;
      if (fromReached === 0) continue;
      const rate = Math.round((p.count / fromReached) * 1000) / 10;
      rows.push({
        transition: `${p.from} → ${p.to}`,
        rate,
        fill: colorFor(p.to),
        fromSort: sortMap.get(p.from) ?? 0,
        toSort: sortMap.get(p.to) ?? 0,
      });
    }
    rows.sort((a, b) => a.fromSort - b.fromSort || a.toSort - b.toSort);
    return rows;
  }, [data.funnel, data.stagePairs]);

  const timeSeriesData = useMemo(
    () => data.applicationsOverTime.map((row) => ({ ...row, label: formatDate(row.date) })),
    [data.applicationsOverTime]
  );

  const transitionsData = useMemo(
    () => data.transitionsByDay.map((row) => ({ ...row, label: formatDate(row.date) })),
    [data.transitionsByDay]
  );

  const funnelData = useMemo(
    () =>
      [...data.funnel]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((row) => ({ ...row, fill: colorFor(row.stage) })),
    [data.funnel]
  );

  const dropOffData = useMemo(() => {
    const pipeline = [...data.funnel]
      .filter((row) => row.stage.trim().toLowerCase() !== "rejected")
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const rows: {
      transition: string;
      dropOffPct: number;
      dropped: number;
      reachedFrom: number;
      fill: string;
    }[] = [];

    for (let i = 0; i < pipeline.length - 1; i++) {
      const from = pipeline[i];
      const to = pipeline[i + 1];
      if (from.reached <= 0 || to.reached > from.reached) {
        continue;
      }
      const dropped = from.reached - to.reached;
      const dropOffPct = Math.round((dropped / from.reached) * 1000) / 10;
      rows.push({
        transition: `${from.stage} → ${to.stage}`,
        dropOffPct,
        dropped,
        reachedFrom: from.reached,
        fill: colorFor(to.stage, i + 1)
      });
    }

    return rows;
  }, [data.funnel]);

  const hasApps = data.totals.applications > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <SummaryTile label="Total Applications" value={data.totals.applications} />
        <SummaryTile label="Stage Transitions" value={data.totals.transitions} />
        <SummaryTile
          label="Avg Days Since Created"
          value={data.totals.avgDaysSinceCreated}
          hint="Across all applications"
        />
        <SummaryTile
          label="Avg Days in Current Stage"
          value={data.totals.avgDaysInCurrentStage}
          hint="Active apps, excluding Rejected"
        />
        <SummaryTile
          label="Avg Days to Interview"
          value={data.totals.avgDaysToInterview ?? "—"}
          hint={
            data.totals.interviewReachedCount > 0
              ? `Based on ${data.totals.interviewReachedCount} app${data.totals.interviewReachedCount === 1 ? "" : "s"}`
              : "No apps reached Interview yet"
          }
        />
        <SummaryTile
          label="Stale Applications"
          value={data.totals.staleCount}
          hint="14+ days in Applied or middle stages"
        />
      </div>

      {!hasApps && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No applications yet. Add some on the board to see stats.
          </CardContent>
        </Card>
      )}

      {hasApps && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Upcoming Interviews</CardTitle>
              </CardHeader>
              <CardContent>
                {upcomingInterviews.length > 0 ? (
                  <ul className="space-y-3">
                    {upcomingInterviews.map((row) => (
                      <li
                        key={`${row.company}-${row.interviewDate}`}
                        className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-background/50 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium">{row.company}</p>
                          <p className="text-xs text-muted-foreground">{row.role}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-medium text-amber-300">{formatDate(row.interviewDate)}</p>
                          <p className="text-xs text-muted-foreground">{row.stageName}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">No upcoming interviews scheduled.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Stale Applications</CardTitle>
              </CardHeader>
              <CardContent>
                {data.staleApplications.length > 0 ? (
                  <ul className="space-y-3">
                    {data.staleApplications.map((row) => (
                      <li
                        key={`${row.company}-${row.stageName}`}
                        className="flex items-start justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium">{row.company}</p>
                          <p className="text-xs text-muted-foreground">{row.role}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-medium text-amber-300">Stale · {row.daysSinceUpdate}d</p>
                          <p className="text-xs text-muted-foreground">{row.stageName}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-6 text-center text-sm text-muted-foreground">No stale applications right now.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Applications by Stage</CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stageData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                    <XAxis dataKey="stage" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <Tooltip cursor={{ fill: "rgba(148,163,184,0.08)" }} contentStyle={tooltipStyle} />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {stageData.map((row) => (
                        <Cell key={row.stage} fill={row.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Stage-to-Stage Conversion</CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                {conversionData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={conversionData}
                      layout="vertical"
                      margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                    >
                      <CartesianGrid stroke="rgba(148,163,184,0.15)" horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        unit="%"
                        tick={{ fontSize: 12, fill: "#94a3b8" }}
                      />
                      <YAxis
                        type="category"
                        dataKey="transition"
                        width={140}
                        tick={{ fontSize: 12, fill: "#94a3b8" }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(148,163,184,0.08)" }}
                        contentStyle={tooltipStyle}
                        formatter={(value) => [`${value}%`, "Conversion"]}
                      />
                      <Bar dataKey="rate" radius={[0, 6, 6, 0]}>
                        {conversionData.map((row) => (
                          <Cell key={row.transition} fill={row.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Need at least two stages to compute conversion.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pipeline Drop-off</CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {dropOffData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={dropOffData}
                    layout="vertical"
                    margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid stroke="rgba(148,163,184,0.15)" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      unit="%"
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="transition"
                      width={140}
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(148,163,184,0.08)" }}
                      contentStyle={tooltipStyle}
                      formatter={(value, _name, item) => {
                        const row = item.payload as (typeof dropOffData)[number];
                        return [`${value}% (${row.dropped} of ${row.reachedFrom} did not advance)`, "Drop-off"];
                      }}
                    />
                    <Bar dataKey="dropOffPct" radius={[0, 6, 6, 0]}>
                      {dropOffData.map((row) => (
                        <Cell key={row.transition} fill={row.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Need at least two pipeline stages to compute drop-off.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Applications Over Time</CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {timeSeriesData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeSeriesData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <defs>
                      <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="createdGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d399" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area
                      type="monotone"
                      dataKey="cumulative"
                      name="Cumulative"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      fill="url(#cumGrad)"
                    />
                    <Area
                      type="monotone"
                      dataKey="created"
                      name="Added that day"
                      stroke="#34d399"
                      strokeWidth={2}
                      fill="url(#createdGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No data.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Funnel: Stages Visited</CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={funnelData}
                    layout="vertical"
                    margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                  >
                    <CartesianGrid stroke="rgba(148,163,184,0.15)" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <YAxis
                      type="category"
                      dataKey="stage"
                      width={90}
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                    />
                    <Tooltip cursor={{ fill: "rgba(148,163,184,0.08)" }} contentStyle={tooltipStyle} />
                    <Bar dataKey="reached" radius={[0, 6, 6, 0]}>
                      {funnelData.map((row) => (
                        <Cell key={row.stage} fill={row.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Daily Stage Transitions</CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                {transitionsData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={transitionsData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line
                        type="monotone"
                        dataKey="count"
                        name="Transitions"
                        stroke="#a78bfa"
                        strokeWidth={2}
                        dot={{ r: 3, fill: "#a78bfa" }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No transitions recorded yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {data.topCompanies.some((row) => row.count > 1) && (
            <Card>
              <CardHeader>
                <CardTitle>Companies with Multiple Applications</CardTitle>
              </CardHeader>
              <CardContent className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.topCompanies.filter((row) => row.count > 1)}
                    margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                  >
                    <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                    <XAxis dataKey="company" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <Tooltip cursor={{ fill: "rgba(148,163,184,0.08)" }} contentStyle={tooltipStyle} />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="#22d3ee" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
