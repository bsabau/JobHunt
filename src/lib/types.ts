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
  totals: {
    applications: number;
    activeStages: number;
    transitions: number;
    avgDaysSinceCreated: number;
    avgDaysInCurrentStage: number;
    avgDaysToInterview: number | null;
    interviewReachedCount: number;
    staleCount: number;
  };
  stageCounts: { stage: string; count: number; sortOrder: number; kind: StageKind }[];
  applicationsOverTime: { date: string; created: number; cumulative: number }[];
  transitionsByDay: { date: string; count: number }[];
  topCompanies: { company: string; count: number }[];
  funnel: { stage: string; reached: number; sortOrder: number; kind: StageKind }[];
  stagePairs: { from: string; to: string; count: number }[];
  upcomingInterviews: { company: string; role: string; interviewDate: string; stageName: string }[];
  staleApplications: { company: string; role: string; stageName: string; daysSinceUpdate: number }[];
  // Where applications that reached an outcome lane (offer, rejected, closed)
  // came from: the stage they left to get there.
  outcomes: { fromStage: string; outcomeStage: string; kind: StageKind; count: number }[];
  openCount: number;
}
