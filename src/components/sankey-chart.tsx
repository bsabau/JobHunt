"use client";

import { useMemo } from "react";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { SankeyPayload } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SANKEY_COLORS = [
  "#38bdf8",
  "#4ade80",
  "#f59e0b",
  "#f43f5e",
  "#a78bfa",
  "#22d3ee",
  "#fb7185",
  "#2dd4bf"
];

export function SankeyChart({ data }: { data: SankeyPayload }) {
  const sanitized = useMemo<SankeyPayload>(() => {
    const nodeCount = data.nodes.length;
    const aggregated = new Map<string, number>();

    for (const link of data.links) {
      const source = Number(link.source);
      const target = Number(link.target);
      const value = Number(link.value);

      const isValid =
        Number.isInteger(source) &&
        Number.isInteger(target) &&
        source >= 0 &&
        target >= 0 &&
        source < nodeCount &&
        target < nodeCount &&
        source !== target &&
        value > 0;

      if (!isValid) {
        continue;
      }

      // Recharts Sankey expects an acyclic graph. Keep only forward edges.
      if (source > target) {
        continue;
      }

      const key = `${source}-${target}`;
      aggregated.set(key, (aggregated.get(key) ?? 0) + value);
    }

    const links = Array.from(aggregated.entries()).map(([key, value]) => {
      const [source, target] = key.split("-").map(Number);
      return {
        source,
        target,
        value,
        stroke: SANKEY_COLORS[source % SANKEY_COLORS.length],
        strokeOpacity: 0.55
      };
    });

    const nodes = data.nodes.map((node, index) => ({
      ...node,
      fill: SANKEY_COLORS[index % SANKEY_COLORS.length],
      stroke: "hsl(var(--border))"
    }));

    return { nodes, links };
  }, [data]);

  const hasLinks = sanitized.links.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Application Pipeline Sankey</CardTitle>
      </CardHeader>
      <CardContent className="h-[420px]">
        {hasLinks ? (
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={sanitized}
              nodePadding={28}
              node={{
                stroke: "hsl(var(--border))"
              }}
            >
              <Tooltip />
            </Sankey>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No transition flow data yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
