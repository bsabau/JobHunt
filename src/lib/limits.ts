export const TEXT_LIMITS = {
  company: 200,
  role: 200,
  stageName: 200,
  notes: 10_000,
  url: 2_048,
  location: 200,
  salary: 100
} as const;

// The work modes an application can have; the migration's check constraint
// (applications_work_mode_known) allows the same values.
export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site"
};
