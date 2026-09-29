import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Application } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function normalizeCompanyKey(company: string): string {
  return company.trim().toLowerCase();
}

export function applicationsForCompany(
  company: string,
  applications: Application[],
  excludeId?: number
): Application[] {
  const key = normalizeCompanyKey(company);
  return applications.filter(
    (app) => app.id !== excludeId && normalizeCompanyKey(app.company) === key
  );
}

// The warning to confirm before adding or saving a card for a company that
// already has one, or null when there is none.
export function duplicateCompanyWarning(company: string, matches: Application[]): string | null {
  if (matches.length === 0) {
    return null;
  }

  const roles = matches.map((app) => app.role).join(", ");
  return `You already have ${matches.length} application${matches.length === 1 ? "" : "s"} at ${company.trim()} (${roles}).`;
}
