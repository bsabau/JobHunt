import type { StageKind } from "@/lib/stage-kinds";

export type { StageKind };

export interface Stage {
  id: number;
  name: string;
  sortOrder: number;
  kind: StageKind;
}

export interface Application {
  id: number;
  company: string;
  role: string;
  notes: string | null;
  interviewDate: string | null;
  sourceUrl: string | null;
  logoUrl: string | null;
  stageId: number;
  stageName: string;
  stageKind: StageKind;
  createdAt: string;
  updatedAt: string;
  stageEnteredAt?: string;
  // When it was sent: its creation, or its first move out of a wishlist
  // (intake) lane; null while it has not left one (view application_applied_at).
  appliedAt: string | null;
  // The stale clock (view application_stale_clock): when the card entered its
  // lane, or its latest follow-up if later. Not redacted for the guest: the
  // board's stale marker needs them and they say no more than the marker.
  staleClockAt: string;
  followedUpAt: string | null;
  snoozedUntil: string | null;
}

// One lane on an application's current path: the lane it entered in first,
// then every lane it moved into. A backward move rewrites the path, so this is
// where the application stands, not every move ever made. A deleted lane has
// no id or kind and its name ends in " (deleted)".
export interface TimelineLane {
  stageId: number | null;
  stageName: string;
  stageKind: StageKind | null;
  enteredAt: string;
}

export interface TimelinePayload {
  lanes: TimelineLane[];
}

export interface SankeyPayload {
  // `kind` is absent for the synthetic "New" entry node and for names that only
  // survive in history.
  nodes: { name: string; companies?: string[]; kind?: StageKind }[];
  links: { source: number; target: number; value: number; companies?: string[] }[];
  // Number of backward links dropped so the graph stays acyclic. Older stored
  // history can still contain them after a reorder or a legacy rewind.
  hiddenBackward?: number;
}

export interface StatsPayload {
  // The date range the ranged figures follow (null is all time), and how many
  // applications they cover: every card under all time, those sent in the
  // range otherwise.
  range: 30 | 90 | null;
  scopeTotal: number;
  // How many days after its Sunday a week in "Results by week" stays open, and
  // whether that comes from the all-time median days to a first reply.
  // medianReplyDays is that all-time median itself (one decimal), or null.
  openWeeks: { days: number; fromMedian: boolean; medianReplyDays: number | null };
  totals: {
    applications: number;
    activeStages: number;
    avgDaysInCurrentStage: number;
    avgDaysToInterview: number | null;
    interviewReachedCount: number;
    staleCount: number;
  };
  stageCounts: { stage: string; count: number; sortOrder: number; kind: StageKind }[];
  // Counts over the applications that were sent (applied_at set): the
  // denominator `applied` and how many of them got a reply, reached an
  // interview, got an offer, or sit in a closed lane now.
  rates: { applied: number; responded: number; interviewed: number; offered: number; ghosted: number };
  // Applications by the week they were sent (weeks from Monday in the
  // viewer's zone), with how many of them got a reply, an interview, an offer;
  // weeks without any are absent.
  weeks: { weekStart: string; sent: number; responded: number; interviewed: number; offered: number }[];
  // Sent applications by the host of their job link (groupBySource() in
  // sources.ts): hosts with at least 3, then "Other" and "Unknown".
  sources: { source: string; sent: number; responded: number; interviewed: number; offered: number }[];
  // Median days from sending to the first reply and to a rejection, over the
  // applications where both times are known, with how many there were.
  timeToHearBack: {
    replyMedianDays: number | null;
    replyCount: number;
    rejectionMedianDays: number | null;
    rejectionCount: number;
  };
  topCompanies: { company: string; count: number }[];
  // In pipeline rank, from buildFunnel(): `advanced` is the percent of the
  // lane's applications that reached a later pipeline lane (null where none).
  funnel: { stage: string; reached: number; sortOrder: number; kind: StageKind; advanced: number | null }[];
  upcomingInterviews: { company: string; role: string; interviewDate: string; stageName: string }[];
  // Stale now (application_stale_clock and the stale rule), oldest clock first.
  // daysSinceUpdate counts from the clock's start: lane entry or a follow-up.
  staleApplications: {
    id: number;
    stageId: number;
    company: string;
    role: string;
    stageName: string;
    daysSinceUpdate: number;
    followedUpAt: string | null;
  }[];
  // The lane "Close" moves a stale application to: the first closed lane.
  closeStage: { id: number; name: string } | null;
  // Sent at least 14 days ago, no reply, in a lane that can go stale, not
  // snoozed: what "Close ghosted applications" offers. Empty for the guest.
  ghostCandidates: {
    id: number;
    stageId: number;
    company: string;
    role: string;
    stageName: string;
    daysSinceApplied: number;
    followedUpAt: string | null;
  }[];
  // Where applications that reached an outcome lane (offer, rejected, closed)
  // came from: the stage they left to get there.
  outcomes: { fromStage: string; outcomeStage: string; kind: StageKind; count: number }[];
  openCount: number;
}
