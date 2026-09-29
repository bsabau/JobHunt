import type { SankeyPayload, StageKind } from "@/lib/types";

export interface SankeySourceData {
  // `sortOrder` is the pipeline rank (withPipelineRank in stage-kinds.ts), not
  // the board position: outcome lanes rank last so links into them always
  // point forward, wherever the lane sits on the board.
  stages: { id?: number; name: string; sortOrder: number; kind?: StageKind }[];
  // Lane ids identify the nodes; a null id is a deleted lane, known only by its
  // stored name. Rows without ids (undefined) are matched to lanes by name.
  transitions: { fromStatus: string; toStatus: string; fromStageId?: number | null; toStageId?: number | null; company: string }[];
  entries: { entryStage: string; entryStageId?: number | null; company: string }[];
  current: { stageName: string; stageId?: number; company: string }[];
}

const ENTRY_NODE_NAME = "New";

// Builds the Sankey graph from already-fetched rows. Node order is: the entry
// node first, then the current stages in pipeline order, then any lanes that
// only survive in history. Because every emitted link therefore points at a
// strictly higher node index, the graph is a DAG by construction and Recharts'
// unbounded depth recursion cannot loop. Links that would point backwards are
// dropped and reported through `hiddenBackward` so the UI can explain them.
//
// Nodes are keyed by lane, not by name: a lane deleted and re-created under the
// same name gets two nodes, the old one labelled "(deleted)", and each node is
// labelled with the lane's current name.
export function buildSankeyPayload(source: SankeySourceData): SankeyPayload {
  const { stages, transitions, entries, current } = source;

  const orderedStages = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const laneById = new Map(orderedStages.filter((stage) => stage.id !== undefined).map((stage) => [stage.id, stage]));
  const laneByName = new Map(orderedStages.map((stage) => [stage.name, stage]));
  const labels = new Map<string, string>();
  const kinds = new Map<string, StageKind | undefined>();

  const laneKey = (lane: SankeySourceData["stages"][number]) => {
    const key = `lane:${lane.id ?? lane.name}`;
    labels.set(key, lane.name);
    kinds.set(key, lane.kind);
    return key;
  };

  const nodeKey = (name: string, id: number | null | undefined) => {
    const lane = typeof id === "number" ? laneById.get(id) : id === undefined ? laneByName.get(name) : undefined;
    if (lane) {
      return laneKey(lane);
    }
    const key = `gone:${name}`;
    labels.set(key, id === null ? `${name} (deleted)` : name);
    return key;
  };

  const currentStageKeys = orderedStages.map(laneKey);

  const transitionMap = new Map<string, { from: string; to: string; count: number; companies: string[] }>();
  for (const row of transitions) {
    const from = nodeKey(row.fromStatus, row.fromStageId);
    const to = nodeKey(row.toStatus, row.toStageId);
    const key = `${from}|${to}`;
    const entry = transitionMap.get(key) ?? { from, to, count: 0, companies: [] };
    entry.count += 1;
    entry.companies.push(row.company);
    transitionMap.set(key, entry);
  }

  const entryMap = new Map<string, { count: number; companies: string[] }>();
  for (const row of entries) {
    const key = nodeKey(row.entryStage, row.entryStageId);
    const entry = entryMap.get(key) ?? { count: 0, companies: [] };
    entry.count += 1;
    entry.companies.push(row.company);
    entryMap.set(key, entry);
  }

  const currentCompanies = new Map<string, string[]>();
  for (const row of current) {
    const key = nodeKey(row.stageName, row.stageId);
    const list = currentCompanies.get(key) ?? [];
    list.push(row.company);
    currentCompanies.set(key, list);
  }

  // The entry node is index 0; every real stage follows. Keeping the entry node
  // out of this keyed list (and using an index offset instead) means a stage
  // literally named "New" becomes its own node instead of merging with the
  // entry node and having its entry links dropped as self-loops.
  //
  // Lanes that only survive in history have no rank. Each goes just before the
  // first live lane it flows into, so its outgoing links point forward, and
  // at the end when it flows into no live lane.
  const nodeKeys = [...currentStageKeys];
  const historyOnlyKeys = new Set(
    [...Array.from(transitionMap.values()).flatMap((t) => [t.from, t.to]), ...entryMap.keys()].filter(
      (key) => !currentStageKeys.includes(key)
    )
  );
  for (const key of historyOnlyKeys) {
    const firstTarget = Math.min(
      ...Array.from(transitionMap.values())
        .filter((t) => t.from === key)
        .map((t) => currentStageKeys.indexOf(t.to))
        .filter((index) => index !== -1)
        .map((index) => nodeKeys.indexOf(currentStageKeys[index]))
    );
    if (Number.isFinite(firstTarget)) {
      nodeKeys.splice(firstTarget, 0, key);
    } else {
      nodeKeys.push(key);
    }
  }

  const nodeIndex = new Map(nodeKeys.map((key, index) => [key, index + 1]));

  // A node's hover should list every company that flowed through it, not only
  // the ones currently parked there.
  const nodeCompanySets = new Map<string, Set<string>>();
  const addCompanies = (key: string, companies: string[] | undefined) => {
    if (!companies || companies.length === 0) {
      return;
    }
    const set = nodeCompanySets.get(key) ?? new Set<string>();
    for (const company of companies) {
      set.add(company);
    }
    nodeCompanySets.set(key, set);
  };

  for (const [key, companies] of currentCompanies) {
    addCompanies(key, companies);
  }
  for (const [key, data] of entryMap) {
    addCompanies(key, data.companies);
  }
  for (const data of transitionMap.values()) {
    addCompanies(data.from, data.companies);
    addCompanies(data.to, data.companies);
  }

  const entryCompanies = Array.from(new Set(Array.from(entryMap.values()).flatMap((data) => data.companies)));

  const links: { source: number; target: number; value: number; companies: string[] }[] = [];

  // Add entry links: New → entry stage for all applications
  for (const [key, data] of entryMap) {
    const target = nodeIndex.get(key);
    if (target !== undefined && data.count > 0) {
      links.push({ source: 0, target, value: data.count, companies: data.companies });
    }
  }

  // Add transition-based links between stages
  for (const data of transitionMap.values()) {
    const source = nodeIndex.get(data.from);
    const target = nodeIndex.get(data.to);
    if (source !== undefined && target !== undefined && data.count > 0) {
      links.push({ source, target, value: data.count, companies: data.companies });
    }
  }

  const dagLinks = links.filter((link) => link.source < link.target);
  const hiddenBackward = links.length - dagLinks.length;

  return {
    nodes: [
      { name: ENTRY_NODE_NAME, companies: entryCompanies },
      ...nodeKeys.map((key) => {
        const kind = kinds.get(key);
        return {
          name: labels.get(key) ?? key,
          companies: Array.from(nodeCompanySets.get(key) ?? []),
          ...(kind ? { kind } : {})
        };
      })
    ],
    links: dagLinks,
    hiddenBackward
  };
}

// A cheap independent DAG check used by the regression test to prove the
// emitted links contain no cycle, regardless of how the node indices line up.
export function hasCycle(links: { source: number; target: number }[]): boolean {
  const adjacency = new Map<number, number[]>();
  for (const link of links) {
    const next = adjacency.get(link.source) ?? [];
    next.push(link.target);
    adjacency.set(link.source, next);
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();

  const visit = (node: number): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const neighbor of adjacency.get(node) ?? []) {
      if (visit(neighbor)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  for (const node of adjacency.keys()) {
    if (visit(node)) return true;
  }

  return false;
}
