import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-6 py-10">
      {/* Streams before the session is known, so no role-specific text. */}
      <PageHeader active="stats" description={null} />
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[320px]" />
          <Skeleton className="h-[320px]" />
        </div>
        <Skeleton className="h-[320px]" />
      </div>
    </main>
  );
}
