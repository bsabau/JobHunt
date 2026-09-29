"use client";

import { MouseEvent, ReactElement, useCallback, useMemo, useState } from "react";
import { ResponsiveContainer, Sankey } from "recharts";
import type { SankeyElementType, SankeyLinkProps, SankeyNode, SankeyNodeProps } from "recharts";
import { SankeyPayload, StageKind } from "@/lib/types";
import { colorFor, isTerminalKind } from "@/lib/stage-kinds";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Recharts types node payloads as its own layout node; ours also carry the
// fields from SankeyPayload.nodes.
type ChartNode = SankeyNode & { kind?: StageKind; companies?: string[] };
type ChartLinkPayload = SankeyLinkProps["payload"] & { companies?: string[] };

function nodeColor(node: { name?: string; kind?: StageKind } | undefined): string {
  return colorFor(node?.name ?? "", node?.kind);
}

interface HoverInfo {
  label: string;
  companies: string[];
  x: number;
  y: number;
}

function CustomNode({ x, y, width, height, payload }: SankeyNodeProps) {
  const fill = nodeColor(payload as ChartNode);
  return <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={0.85} stroke="none" rx={2} />;
}

function CustomLink({
  sourceX,
  sourceY,
  sourceControlX,
  targetX,
  targetY,
  targetControlX,
  linkWidth,
  payload
}: SankeyLinkProps): ReactElement<React.SVGProps<SVGPathElement>> {
  // Flows into an outcome lane take the outcome's colour, so rejections read as
  // red wherever they came from; every other flow keeps its source colour.
  const target = payload.target as ChartNode;
  const color = isTerminalKind(target.kind) ? nodeColor(target) : nodeColor(payload.source as ChartNode);
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={color}
      strokeWidth={linkWidth}
      strokeOpacity={0.35}
    />
  );
}

export function SankeyChart({ data }: { data: SankeyPayload }) {
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const sanitized = useMemo(() => {
    const nodeCount = data.nodes.length;
    const aggregated = new Map<string, { value: number; companies: string[] }>();

    for (const link of data.links) {
      const source = Number(link.source);
      const target = Number(link.target);
      const value = Number(link.value);

      // `source < target` is the last line of defense against a cyclic graph:
      // Recharts' Sankey depth walk recurses without a visited set, so a single
      // backward link (from stale history) would throw a RangeError and blank
      // the page. The server also drops those links and reports the count.
      const isValid =
        Number.isInteger(source) &&
        Number.isInteger(target) &&
        source >= 0 &&
        target >= 0 &&
        source < nodeCount &&
        target < nodeCount &&
        source < target &&
        value > 0;

      if (!isValid) continue;
      const key = `${source}-${target}`;
      const existing = aggregated.get(key) ?? { value: 0, companies: [] };
      existing.value += value;
      existing.companies.push(...(link.companies ?? []));
      aggregated.set(key, existing);
    }

    const links = Array.from(aggregated.entries()).map(([key, entry]) => {
      const [source, target] = key.split("-").map(Number);
      return { source, target, value: entry.value, companies: entry.companies };
    });

    return { nodes: data.nodes, links };
  }, [data]);

  const handleMouseEnter = useCallback(
    (item: SankeyNodeProps | SankeyLinkProps, type: SankeyElementType, e: MouseEvent<SVGGraphicsElement>) => {
      if (type === "node") {
        const node = item.payload as ChartNode;
        const name = node.name ?? "?";
        const companies = node.companies ?? [];
        const value = node.value ?? companies.length;
        setHover({
          label: `${name} (${value})`,
          companies,
          x: e.clientX,
          y: e.clientY,
        });
      } else if (type === "link") {
        const link = item.payload as ChartLinkPayload;
        const sourceName = link.source?.name ?? "?";
        const targetName = link.target?.name ?? "?";
        const companies = link.companies ?? [];
        setHover({
          label: `${sourceName} → ${targetName} (${link.value ?? 0})`,
          companies,
          x: e.clientX,
          y: e.clientY,
        });
      }
    },
    []
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  const hasLinks = sanitized.links.length > 0;
  const hiddenBackward = data.hiddenBackward ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Application Pipeline Sankey</CardTitle>
      </CardHeader>
      <CardContent className="relative h-[420px]">
        {hiddenBackward > 0 && (
          <p className="absolute right-0 top-0 text-xs text-muted-foreground">
            {hiddenBackward} backward {hiddenBackward === 1 ? "transition" : "transitions"} hidden to keep the flow acyclic.
          </p>
        )}
        {hasLinks ? (
          <>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
              <Sankey
                data={sanitized}
                nodePadding={28}
                node={CustomNode}
                link={CustomLink}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              />
            </ResponsiveContainer>
            {hover && (
              <div
                className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md max-w-xs"
                style={{ left: hover.x + 12, top: hover.y + 12 }}
              >
                <p className="mb-1 font-semibold">{hover.label}</p>
                {hover.companies.length > 0 && (
                  <ul className="list-none space-y-0.5 text-xs text-muted-foreground">
                    {hover.companies.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No transition flow data yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
