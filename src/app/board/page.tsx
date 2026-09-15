import { KanbanBoard } from "@/components/kanban-board";
import { PageHeader } from "@/components/page-header";
import { listApplications, listStages } from "@/lib/db";
import { requirePageSession } from "@/lib/page-auth";
import { resolveRequestTimeZone } from "@/lib/request-timezone";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const session = await requirePageSession();
  const readOnly = session.role === "guest";

  const timeZone = await resolveRequestTimeZone();
  const [applications, stages] = await Promise.all([listApplications(), listStages()]);
  // Notes are owner-only; never ship them into the guest board payload.
  const visibleApplications = readOnly
    ? applications.map((application) => ({ ...application, notes: null }))
    : applications;

  return (
    <main className="min-h-screen px-6 py-10">
      <PageHeader active="board" readOnly={readOnly} />
      <KanbanBoard
        initialApplications={visibleApplications}
        initialStages={stages}
        readOnly={readOnly}
        timeZone={timeZone}
      />
    </main>
  );
}
