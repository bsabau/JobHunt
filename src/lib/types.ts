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
  sourceUrl: string | null;
  logoUrl: string | null;
  stageId: number;
  stageName: string;
  createdAt: string;
  updatedAt: string;
}

export interface SankeyPayload {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
}
