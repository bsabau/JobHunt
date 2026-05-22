import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { Button } from "@/components/ui/button";

interface PageHeaderProps {
  active: "board" | "stats" | "sankey";
  readOnly?: boolean;
}

const NAV_ITEMS = [
  { key: "stats", href: "/stats", label: "Stats" },
  { key: "sankey", href: "/sankey", label: "Sankey" },
  { key: "board", href: "/", label: "Board" },
] as const;

export function PageHeader({ active, readOnly = false }: PageHeaderProps) {
  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.25em] text-sky-300/80">
          Job Tracker{readOnly ? " · Guest (read-only)" : ""}
        </p>
        <h1 className="text-3xl font-bold">Kanban Job Hunt Dashboard</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {readOnly
            ? "You are viewing the board as a guest. Editing is disabled."
            : "Add companies, track your progress by dragging cards between stages, and get logo lookup automatically."}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {NAV_ITEMS.filter((item) => item.key !== active).map((item) => (
          <Button key={item.key} variant="outline" asChild>
            <Link href={item.href}>{item.label}</Link>
          </Button>
        ))}
        <LogoutButton />
      </div>
    </div>
  );
}
