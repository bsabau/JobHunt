// Results by source: sent applications grouped by the host of their job link.
// Loadable straight from Node for tests/sources.test.mjs.

// Hosts with fewer applications than this are summed into "Other" (owner
// decision 10 of the product plan).
export const SOURCE_MIN_GROUP = 3;
export const OTHER_SOURCE = "Other";
export const UNKNOWN_SOURCE = "Unknown";

// The host of a job link, lower-cased and without a leading "www.", or null
// when there is no link or it does not parse. Sub-domains stay separate: a
// country sub-domain of a job board is its own source (folding them needs a
// public-suffix list).
export function sourceHost(url: string | null): string | null {
  if (!url) {
    return null;
  }
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host ? host.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

export interface SourceApplication {
  sourceUrl: string | null;
  responded: boolean;
  interviewed: boolean;
  offered: boolean;
}

export interface SourceGroup {
  source: string;
  sent: number;
  responded: number;
  interviewed: number;
  offered: number;
}

// One row per host with at least SOURCE_MIN_GROUP applications, by count
// (ties by name), then "Other" and "Unknown" when they have any.
export function groupBySource(applications: readonly SourceApplication[]): SourceGroup[] {
  const byHost = new Map<string, SourceGroup>();
  const unknown: SourceGroup = { source: UNKNOWN_SOURCE, sent: 0, responded: 0, interviewed: 0, offered: 0 };
  const add = (group: SourceGroup, app: SourceApplication) => {
    group.sent += 1;
    group.responded += Number(app.responded);
    group.interviewed += Number(app.interviewed);
    group.offered += Number(app.offered);
  };

  for (const app of applications) {
    const host = sourceHost(app.sourceUrl);
    if (host === null) {
      add(unknown, app);
      continue;
    }
    const group = byHost.get(host) ?? { source: host, sent: 0, responded: 0, interviewed: 0, offered: 0 };
    add(group, app);
    byHost.set(host, group);
  }

  const other: SourceGroup = { source: OTHER_SOURCE, sent: 0, responded: 0, interviewed: 0, offered: 0 };
  const shown: SourceGroup[] = [];
  for (const group of byHost.values()) {
    if (group.sent >= SOURCE_MIN_GROUP) {
      shown.push(group);
    } else {
      other.sent += group.sent;
      other.responded += group.responded;
      other.interviewed += group.interviewed;
      other.offered += group.offered;
    }
  }
  shown.sort((a, b) => b.sent - a.sent || a.source.localeCompare(b.source));
  return [...shown, ...[other, unknown].filter((group) => group.sent > 0)];
}
