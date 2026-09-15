import type { SankeyPayload } from "@/lib/types";

export interface SankeySourceData {
  stages: { name: string; sortOrder: number }[];
  transitions: { fromStatus: string; toStatus: string; company: string }[];
  entries: { entryStage: string; company: string }[];
  current: { stageName: string; company: string }[];
}

const ENTRY_NODE_NAME = "New";

// Builds the Sankey graph from already-fetched rows. Node order is: the entry
// node first, then the current stages in pipeline order, then any stage names
// that only survive in history. Because every emitted link therefore points at
// a strictly higher node index, the graph is a DAG by construction and Recharts'
// unbounded depth recursion cannot loop. Links that would point backwards are
// dropped and reported through `hiddenBackward` so the UI can explain them.
export function buildSankeyPayload(source: SankeySourceData): SankeyPayload {
  const { stages, transitions, entries, current } = source;

  const transitionMap = new Map<string, { from: string; to: string; count: number; companies: string[] }>();
  for (const row of transitions) {
    const key = `${row.fromStatus}|${row.toStatus}`;
    const entry = transitionMap.get(key) ?? { from: row.fromStatus, to: row.toStatus, count: 0, companies: [] };
    entry.count += 1;
    entry.companies.push(row.company);
    transitionMap.set(key, entry);
  }

  const currentStageNames = stages.map((stage) => stage.name);

  const entryMap = new Map<string, { count: number; companies: string[] }>();
  for (const row of entries) {
    const entry = entryMap.get(row.entryStage) ?? { count: 0, companies: [] };
    entry.count += 1;
    entry.companies.push(row.company);
    entryMap.set(row.entryStage, entry);
  }

  const currentCompanies = new Map<string, string[]>();
  for (const row of current) {
    const list = currentCompanies.get(row.stageName) ?? [];
    list.push(row.company);
    currentCompanies.set(row.stageName, list);
  }

  // The entry node is index 0; every real stage follows. Keeping the entry node
  // out of this name-keyed list (and using an index offset instead) means a
  // stage literally named "New" becomes its own node instead of merging with
  // the entry node and having its entry links dropped as self-loops.
  const stageNames = Array.from(new Set([
    ...currentStageNames,
    ...Array.from(transitionMap.values()).flatMap((t) => [t.from, t.to]),
    ...Array.from(entryMap.keys())
  ]));

  const stageIndex = new Map(stageNames.map((name, index) => [name, index + 1]));

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

  for (const [stage, companies] of currentCompanies) {
    addCompanies(stage, companies);
  }
  for (const [stage, data] of entryMap) {
    addCompanies(stage, data.companies);
  }
  for (const data of transitionMap.values()) {
    addCompanies(data.from, data.companies);
    addCompanies(data.to, data.companies);
  }

  const entryCompanies = Array.from(new Set(Array.from(entryMap.values()).flatMap((data) => data.companies)));

  const links: { source: number; target: number; value: number; companies: string[] }[] = [];

  // Add entry links: New → entry stage for all applications
  for (const [stage, data] of entryMap) {
    const target = stageIndex.get(stage);
    if (target !== undefined && data.count > 0) {
      links.push({ source: 0, target, value: data.count, companies: data.companies });
    }
  }

  // Add transition-based links between stages
  for (const data of transitionMap.values()) {
    const source = stageIndex.get(data.from);
    const target = stageIndex.get(data.to);
    if (source !== undefined && target !== undefined && data.count > 0) {
      links.push({ source, target, value: data.count, companies: data.companies });
    }
  }

  const dagLinks = links.filter((link) => link.source < link.target);
  const hiddenBackward = links.length - dagLinks.length;

  return {
    nodes: [
      { name: ENTRY_NODE_NAME, companies: entryCompanies },
      ...stageNames.map((name) => ({
        name,
        companies: Array.from(nodeCompanySets.get(name) ?? [])
      }))
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
