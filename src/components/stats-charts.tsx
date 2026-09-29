"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { StatsPayload } from "@/lib/types";
import { MEDIAN_MIN_SAMPLE, STALE_THRESHOLD_DAYS } from "@/lib/constants";
import { daysUntil, formatDateOnly, todayInTimeZone } from "@/lib/timezone";
import { fillWeeks, isWeekOpen, weekStartOf } from "@/lib/weeks";
import { KIND_COLORS, KIND_LABELS, RESOLVED_KINDS, ResolvedKind, colorFor } from "@/lib/stage-kinds";
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

// A share of the applications that were sent, with the counts behind it:
// with few applications a percentage alone says little.
function RateTile({ label, count, of, hint }: { label: string; count: number; of: number; hint?: string }) {
  return (
    <SummaryTile
      label={label}
      value={of > 0 ? `${Math.round((count / of) * 100)}%` : "—"}
      hint={of > 0 ? `${count} of ${of} sent${hint ? `, ${hint}` : ""}` : "Nothing sent yet"}
    />
  );
}

// A median, shown only once it rests on enough applications to mean something.
function MedianTile({ label, days, count }: { label: string; days: number | null; count: number }) {
  const enough = days !== null && count >= MEDIAN_MIN_SAMPLE;
  return (
    <SummaryTile
      label={label}
      value={enough ? days : "—"}
      hint={enough ? `Median of ${count}` : `Not enough data yet (${count} of ${MEDIAN_MIN_SAMPLE})`}
    />
  );
}

// "2 of 5" with a bar for the share: with a few applications a week, the
// counts matter more than the percentage.
function ShareCell({ count, of, color, muted, last }: { count: number; of: number; color: string; muted: boolean; last?: boolean }) {
  const pct = of > 0 ? Math.round((count / of) * 100) : 0;
  return (
    <td className={`py-2 ${last ? "" : "pr-4"}`}>
      {/* Counts first: on a phone the bar is dropped and the numbers stay. */}
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap tabular-nums">
          {count} <span className="text-muted-foreground">({pct}%)</span>
        </span>
        <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-border/40 sm:block" aria-hidden="true">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, opacity: muted ? 0.5 : 1 }} />
        </div>
      </div>
    </td>
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

  // The funnel arrives in pipeline rank (buildFunnel() on the server): outcome
  // lanes come after the pipeline wherever they sit on the board.
  const rankedFunnel = data.funnel;
  const stageRank = useMemo(
    () => new Map(rankedFunnel.map((row, index) => [row.stage, index])),
    [rankedFunnel]
  );

  // Every week up to the current one in the viewer's zone, so a quiet stretch
  // shows as empty weeks. `now` is the page's clock, so server and browser agree.
  // The axis shows the year only when the weeks span more than one; the
  // tooltip always does.
  const weeklyData = useMemo(() => {
    const weeks = fillWeeks(data.weeks, weekStartOf(todayInTimeZone(timeZone, new Date(now))));
    const years = new Set(weeks.map((week) => week.weekStart.slice(0, 4)));
    return weeks.map((row) => ({
      ...row,
      label: years.size > 1 ? `${formatDate(row.weekStart)} '${row.weekStart.slice(2, 4)}` : formatDate(row.weekStart),
      fullLabel: formatDateOnly(row.weekStart)
    }));
  }, [data.weeks, timeZone, now]);

  // Each week's results, newest first. A week stays open for the median days
  // to a first reply (rounded up) after it ends, or STALE_THRESHOLD_DAYS while
  // that median rests on too few applications.
  const openDays =
    data.timeToHearBack.replyMedianDays !== null && data.timeToHearBack.replyCount >= MEDIAN_MIN_SAMPLE
      ? Math.ceil(data.timeToHearBack.replyMedianDays)
      : STALE_THRESHOLD_DAYS;
  const weekResults = useMemo(() => {
    const today = todayInTimeZone(timeZone, new Date(now));
    return [...data.weeks]
      .reverse()
      .map((week) => ({ ...week, open: isWeekOpen(week.weekStart, openDays, today) }));
  }, [data.weeks, openDays, timeZone, now]);

  // The label beside each bar: the count, and for a pipeline lane the share
  // that went on to the next one.
  const funnelData = useMemo(
    () =>
      rankedFunnel.map((row) => ({
        ...row,
        fill: colorFor(row.stage, row.kind),
        label: row.advanced === null ? `${row.reached}` : `${row.reached} · ${row.advanced}% further`
      })),
    [rankedFunnel]
  );

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
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <SummaryTile label="Total Applications" value={data.totals.applications} />
        <RateTile label="Response Rate" count={data.rates.responded} of={data.rates.applied} />
        <RateTile label="Interview Rate" count={data.rates.interviewed} of={data.rates.applied} />
        <RateTile label="Offer Rate" count={data.rates.offered} of={data.rates.applied} />
        <RateTile label="Ghosted" count={data.rates.ghosted} of={data.rates.applied} hint="now in a closed lane" />
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
        <MedianTile
          label="Days to First Reply"
          days={data.timeToHearBack.replyMedianDays}
          count={data.timeToHearBack.replyCount}
        />
        <MedianTile
          label="Days to Rejection"
          days={data.timeToHearBack.rejectionMedianDays}
          count={data.timeToHearBack.rejectionCount}
        />
        <SummaryTile
          label="Stale Applications"
          value={data.totals.staleCount}
          hint="14+ days in Applied or middle stages"
        />
      </div>
      {data.rates.applied > 0 ? (
        <p className="-mt-3 text-xs text-muted-foreground">
          Rates count applications that were sent, where they stand now: a card moved back loses the steps it undid.
        </p>
      ) : null}

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
                <CardTitle>How Far Applications Got</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Applications that reached each lane, and the share of them that reached a later pipeline lane.
                </p>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
                  <BarChart data={funnelData} layout="vertical" margin={{ top: 8, right: 132, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="rgba(148,163,184,0.15)" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <YAxis type="category" dataKey="stage" width={90} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <Tooltip
                      cursor={{ fill: "rgba(148,163,184,0.08)" }}
                      contentStyle={tooltipStyle}
                      itemStyle={cellTooltipItemStyle}
                      formatter={(value, _name, item) => {
                        const row = item.payload as (typeof funnelData)[number];
                        return [
                          row.advanced === null ? `${value}` : `${value}, of which ${row.advanced}% reached a later lane`,
                          "Reached"
                        ];
                      }}
                    />
                    <Bar dataKey="reached" radius={[0, 6, 6, 0]}>
                      {funnelData.map((row) => (
                        <Cell key={row.stage} fill={row.fill} />
                      ))}
                      <LabelList dataKey="label" position="right" style={{ fontSize: 12, fill: "#94a3b8" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Applications Sent per Week</CardTitle>
              <p className="text-xs text-muted-foreground">
                By the date each was sent, weeks from Monday, with the running total.
              </p>
            </CardHeader>
            <CardContent className="h-[320px]">
              {weeklyData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
                  <ComposedChart data={weeklyData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <YAxis yAxisId="week" allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <YAxis yAxisId="total" orientation="right" allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(_label, payload) => `Week of ${payload?.[0]?.payload?.fullLabel ?? _label}`}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="week" dataKey="sent" name="Sent that week" fill="#34d399" radius={[4, 4, 0, 0]} />
                    <Line
                      yAxisId="total"
                      type="monotone"
                      dataKey="cumulative"
                      name="Total sent"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No application sent yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Results by Week Sent</CardTitle>
              <p className="text-xs text-muted-foreground">
                What became of each week&apos;s applications, where they stand now. A week stays open for {openDays} days
                after it ends ({openDays === STALE_THRESHOLD_DAYS && data.timeToHearBack.replyCount < MEDIAN_MIN_SAMPLE
                  ? "until there are enough replies for a median"
                  : "the median time to a first reply"}
                ); until then its figures can still rise.
              </p>
            </CardHeader>
            <CardContent>
              {weekResults.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <th scope="col" className="py-2 pr-4 font-medium">Week of</th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">Sent</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Replied</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Interview</th>
                        <th scope="col" className="py-2 font-medium">Offer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weekResults.map((week) => (
                        <tr key={week.weekStart} className={`border-t border-border/40 ${week.open ? "text-muted-foreground" : ""}`}>
                          <th scope="row" className="whitespace-nowrap py-2 pr-4 text-left font-normal">
                            {formatDateOnly(week.weekStart)}
                            {week.open ? (
                              <span className="ml-2 rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wider">
                                still open
                              </span>
                            ) : null}
                          </th>
                          <td className="py-2 pr-4 text-right tabular-nums">{week.sent}</td>
                          <ShareCell count={week.responded} of={week.sent} color={KIND_COLORS.active} muted={week.open} />
                          <ShareCell count={week.interviewed} of={week.sent} color={KIND_COLORS.interview} muted={week.open} />
                          <ShareCell count={week.offered} of={week.sent} color={KIND_COLORS.offer} muted={week.open} last />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No application sent yet.</p>
              )}
            </CardContent>
          </Card>

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
