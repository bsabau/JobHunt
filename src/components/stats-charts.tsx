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
  const d = new Date(value);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  const stageData = useMemo(
    () => data.stageCounts.map((row) => ({ ...row, fill: colorFor(row.stage) })),
    [data.stageCounts]
  );

  const conversionData = useMemo(() => {
    const sorted = [...data.funnel].sort((a, b) => a.sortOrder - b.sortOrder);
    const rows: { transition: string; rate: number; fill: string }[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const rate = prev.reached > 0 ? Math.round((curr.reached / prev.reached) * 1000) / 10 : 0;
      rows.push({
        transition: `${prev.stage} → ${curr.stage}`,
        rate,
        fill: colorFor(curr.stage),
      });
    }
    return rows;
  }, [data.funnel]);

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

  const hasApps = data.totals.applications > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryTile label="Total Applications" value={data.totals.applications} />
        <SummaryTile label="Active Stages" value={data.totals.activeStages} hint="Stages with at least one app" />
        <SummaryTile label="Stage Transitions" value={data.totals.transitions} />
        <SummaryTile
          label="Avg Days in Pipeline"
          value={data.totals.avgDaysInPipeline}
          hint="Across all applications"
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
                <CardTitle>Funnel: Reached Stage or Beyond</CardTitle>
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
