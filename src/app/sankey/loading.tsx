import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-6 py-10">
      {/* Streams before the session is known, so no role-specific text. */}
      <PageHeader active="sankey" description={null} />
      <Skeleton className="h-[480px]" />
    </main>
  );
}
