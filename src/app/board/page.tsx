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
  // One clock reading for the whole render, handed to the client components so
  // relative dates match between the server HTML and hydration. A server
  // component renders once per request, so reading the clock here is safe.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  // listApplications leaves out the notes for a guest viewer.
  const [applications, stages] = await Promise.all([listApplications(session.role), listStages()]);

  return (
    <main className="min-h-screen px-6 py-10">
      <PageHeader active="board" readOnly={readOnly} />
      <KanbanBoard
        initialApplications={applications}
        initialStages={stages}
        readOnly={readOnly}
        timeZone={timeZone}
        now={now}
      />
    </main>
  );
}
