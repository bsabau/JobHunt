export interface Stage {
  id: number;
  name: string;
  sortOrder: number;
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
  createdAt: string;
  updatedAt: string;
}

export interface SankeyPayload {
  nodes: { name: string; companies?: string[] }[];
  links: { source: number; target: number; value: number; companies?: string[] }[];
}

export interface StatsPayload {
  totals: {
    applications: number;
    activeStages: number;
    transitions: number;
    avgDaysInPipeline: number;
  };
  stageCounts: { stage: string; count: number; sortOrder: number }[];
  applicationsOverTime: { date: string; created: number; cumulative: number }[];
  transitionsByDay: { date: string; count: number }[];
  topCompanies: { company: string; count: number }[];
  funnel: { stage: string; reached: number; sortOrder: number }[];
  stagePairs: { from: string; to: string; count: number }[];
}
