import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="min-h-screen px-6 py-10">
      <PageHeader active="board" />
      <div className="overflow-x-auto pb-3">
        <div className="inline-grid gap-4" style={{ gridTemplateColumns: "repeat(5, minmax(240px, 280px))" }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-border/30 bg-muted/10 p-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ))}
        </div>
      </div>
    </main>
  );
}
