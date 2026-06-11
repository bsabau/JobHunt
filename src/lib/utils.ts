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

export function confirmDuplicateCompany(company: string, matches: Application[], action: "add" | "save"): boolean {
  if (matches.length === 0) {
    return true;
  }

  const label = company.trim();
  const roles = matches.map((app) => app.role).join(", ");
  const verb = action === "add" ? "Add another" : "Save changes";

  return window.confirm(
    `You already have ${matches.length} application${matches.length === 1 ? "" : "s"} at ${label} (${roles}). ${verb} anyway?`
  );
}
