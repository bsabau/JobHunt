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
import { StageKind, StatsPayload } from "@/lib/types";
import { daysUntil } from "@/lib/timezone";
import { KIND_COLORS, KIND_LABELS, RESOLVED_KINDS, ResolvedKind, colorFor, compareStageRank, isTerminalKind } from "@/lib/stage-kinds";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function formatDate(value: string): string {
  // A date-only PostgreSQL value must be formatted as a calendar date. Parsing
  // it with Date treats it as UTC midnight and shifts it for western timezones.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const d = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  // An explicit locale keeps SSR and the browser in agreement (a default
  // locale would produce a hydration mismatch).
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isTodayOrFuture(value: string, timeZone: string, now: number): boolean {
  return daysUntil(value, timeZone, now) >= 0;
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

function OutcomeChip({ label, color, count, total }: { label: string; color: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-2.5 py-1 text-muted-foreground">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
      <span className="font-semibold tabular-nums text-foreground">{count}</span>
      <span className="tabular-nums">({pct}%)</span>
    </span>
  );
}

// The theme variables hold HSL channels ("222 40% 10%"), so they must be read
// with hsl(); rgb() misreads them as an orange background.
const tooltipStyle = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--popover-foreground))",
  borderRadius: 8,
  fontSize: 12,
};

// Recharts colours a tooltip row with the <Bar>'s fill and falls back to black.
// Bars coloured per lane through <Cell> have no fill, so their rows need this.
const cellTooltipItemStyle = { color: "hsl(var(--popover-foreground))" };

// `now` is the server's clock at render time, so "upcoming" is decided the
// same way on the server and during hydration.
export function StatsCharts({ data, timeZone, now }: { data: StatsPayload; timeZone: string; now: number }) {
  const upcomingInterviews = useMemo(
    () => data.upcomingInterviews.filter((row) => isTodayOrFuture(row.interviewDate, timeZone, now)),
    [data.upcomingInterviews, timeZone, now]
  );
  const stageData = useMemo(
    () => data.stageCounts.map((row) => ({ ...row, fill: colorFor(row.stage, row.kind) })),
    [data.stageCounts]
  );

  // Pipeline rank of every current stage: outcome lanes come after the
  // pipeline wherever they sit on the board. History-only names rank last.
  const rankedFunnel = useMemo(() => [...data.funnel].sort(compareStageRank), [data.funnel]);
  const stageRank = useMemo(
    () => new Map(rankedFunnel.map((row, index) => [row.stage, index])),
    [rankedFunnel]
  );

  const conversionData = useMemo(() => {
    const reachedMap = new Map<string, number>();
    const kindMap = new Map<string, StageKind>();
    for (const f of data.funnel) {
      reachedMap.set(f.stage, f.reached);
      kindMap.set(f.stage, f.kind);
    }
    const rows: { transition: string; rate: number; fill: string; fromSort: number; toSort: number }[] = [];
    for (const p of data.stagePairs ?? []) {
      const fromReached = reachedMap.get(p.from) ?? 0;
      if (fromReached === 0) continue;
      const rate = Math.round((p.count / fromReached) * 1000) / 10;
      rows.push({
        transition: `${p.from} → ${p.to}`,
        rate,
        fill: colorFor(p.to, kindMap.get(p.to)),
        fromSort: stageRank.get(p.from) ?? Number.MAX_SAFE_INTEGER,
        toSort: stageRank.get(p.to) ?? Number.MAX_SAFE_INTEGER,
      });
    }
    rows.sort((a, b) => a.fromSort - b.fromSort || a.toSort - b.toSort);
    return rows;
  }, [data.funnel, data.stagePairs, stageRank]);

  const timeSeriesData = useMemo(
    () => data.applicationsOverTime.map((row) => ({ ...row, label: formatDate(row.date) })),
    [data.applicationsOverTime]
  );

  const transitionsData = useMemo(
    () => data.transitionsByDay.map((row) => ({ ...row, label: formatDate(row.date) })),
    [data.transitionsByDay]
  );

  const funnelData = useMemo(
    () => rankedFunnel.map((row) => ({ ...row, fill: colorFor(row.stage, row.kind) })),
    [rankedFunnel]
  );

  const dropOffData = useMemo(() => {
    const pipeline = rankedFunnel.filter((row) => !isTerminalKind(row.kind));

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
        fill: colorFor(to.stage, to.kind, i + 1)
      });
    }

    return rows;
  }, [rankedFunnel]);

  // One row per stage applications left to reach an outcome, stacked by the
  // kind of outcome: shows where in the process applications end.
  const outcomeData = useMemo(() => {
    const byStage = new Map<string, { fromStage: string; lanes: string[] } & Record<ResolvedKind, number>>();
    for (const row of data.outcomes) {
      if (!(RESOLVED_KINDS as readonly string[]).includes(row.kind)) continue;
      const entry = byStage.get(row.fromStage) ?? { fromStage: row.fromStage, lanes: [], rejected: 0, closed: 0, offer: 0 };
      entry[row.kind as ResolvedKind] += row.count;
      entry.lanes.push(`${row.outcomeStage}: ${row.count}`);
      byStage.set(row.fromStage, entry);
    }
    return Array.from(byStage.values())
      .sort(
        (a, b) =>
          (stageRank.get(a.fromStage) ?? Number.MAX_SAFE_INTEGER) -
          (stageRank.get(b.fromStage) ?? Number.MAX_SAFE_INTEGER)
      )
      // null (not 0) so the tooltip, which filters nulls, lists only outcomes that happened.
      .map((row) => ({
        ...row,
        rejected: row.rejected || null,
        closed: row.closed || null,
        offer: row.offer || null
      }));
  }, [data.outcomes, stageRank]);

  const outcomeTotals = useMemo(() => {
    const totals: Record<ResolvedKind, number> = { rejected: 0, closed: 0, offer: 0 };
    for (const row of data.outcomes) {
      if ((RESOLVED_KINDS as readonly string[]).includes(row.kind)) {
        totals[row.kind as ResolvedKind] += row.count;
      }
    }
    return totals;
  }, [data.outcomes]);

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
          hint="Excluding rejected and closed lanes"
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
                    {upcomingInterviews.map((row, index) => (
                      <li
                        key={`${index}-${row.company}-${row.interviewDate}`}
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
                    {data.staleApplications.map((row, index) => (
                      <li
                        key={`${index}-${row.company}-${row.stageName}`}
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

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <CardTitle>Where Applications Ended</CardTitle>
              <div className="flex flex-wrap gap-2 text-xs">
                <OutcomeChip label="Open" color={KIND_COLORS.active} count={data.openCount} total={data.totals.applications} />
                {RESOLVED_KINDS.map((kind) => (
                  <OutcomeChip
                    key={kind}
                    label={KIND_LABELS[kind]}
                    color={KIND_COLORS[kind]}
                    count={outcomeTotals[kind]}
                    total={data.totals.applications}
                  />
                ))}
              </div>
            </CardHeader>
            <CardContent style={{ height: Math.max(200, outcomeData.length * 44 + 64) }}>
              {outcomeData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
                  <BarChart data={outcomeData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="rgba(148,163,184,0.15)" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <YAxis
                      type="category"
                      dataKey="fromStage"
                      width={130}
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                      tickFormatter={(value: string) => `after ${value}`}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(148,163,184,0.08)" }}
                      contentStyle={tooltipStyle}
                      labelFormatter={(label, payload) => {
                        const row = payload?.[0]?.payload as (typeof outcomeData)[number] | undefined;
                        return row ? `After ${label} · ${row.lanes.join(", ")}` : `After ${label}`;
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {RESOLVED_KINDS.map((kind) => (
                      <Bar
                        key={kind}
                        dataKey={kind}
                        name={KIND_LABELS[kind]}
                        stackId="outcome"
                        fill={KIND_COLORS[kind]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No application has reached an offer, rejected or closed lane yet.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Applications by Stage</CardTitle>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
                  <BarChart data={stageData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                    <XAxis dataKey="stage" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <Tooltip
                      cursor={{ fill: "rgba(148,163,184,0.08)" }}
                      contentStyle={tooltipStyle}
                      itemStyle={cellTooltipItemStyle}
                    />
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
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
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
                        itemStyle={cellTooltipItemStyle}
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
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
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
                      itemStyle={cellTooltipItemStyle}
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
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
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
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
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
                    <Tooltip
                      cursor={{ fill: "rgba(148,163,184,0.08)" }}
                      contentStyle={tooltipStyle}
                      itemStyle={cellTooltipItemStyle}
                    />
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
                  <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
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
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
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
