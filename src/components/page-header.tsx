import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  // The current view, left out of the navigation. Omitted on error pages,
  // which link to every view.
  active?: "board" | "stats" | "sankey";
  readOnly?: boolean;
  // Replaces the role-based description; null leaves it out (error pages,
  // which cannot tell an owner from a guest).
  description?: string | null;
}

const NAV_ITEMS = [
  { key: "stats", href: "/", label: "Stats" },
  { key: "sankey", href: "/sankey", label: "Sankey" },
  { key: "board", href: "/board", label: "Board" },
] as const;

export function PageHeader({ active, readOnly = false, description }: PageHeaderProps) {
  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.25em] text-sky-300/80">
          Job Tracker{readOnly ? " · Guest (read-only)" : ""}
        </p>
        <h1 className="text-3xl font-bold">Kanban Job Hunt Dashboard</h1>
        {description === null ? null : (
          <p className="max-w-2xl text-sm text-muted-foreground">
            {description ??
              (readOnly
                ? "You are viewing the board as a guest. Editing is disabled."
                : "Add companies, track your progress by dragging cards between stages, and get logo lookup automatically.")}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {NAV_ITEMS.filter((item) => item.key !== active).map((item) => (
          <Button key={item.key} variant="outline" asChild className="w-24 justify-center">
            <Link href={item.href}>{item.label}</Link>
          </Button>
        ))}
        <LogoutButton />
      </div>
    </div>
  );
}
