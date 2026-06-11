import { cookies } from "next/headers";
import { KanbanBoard } from "@/components/kanban-board";
import { PageHeader } from "@/components/page-header";
import { listApplications, listStages } from "@/lib/db";
import { safeVerifySessionToken, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const [applications, stages] = await Promise.all([listApplications(), listStages()]);

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await safeVerifySessionToken(token) : null;
  const readOnly = session?.role === "guest";

  return (
    <main className="min-h-screen px-6 py-10">
      <PageHeader active="board" readOnly={readOnly} />
      <KanbanBoard initialApplications={applications} initialStages={stages} readOnly={readOnly} />
    </main>
  );
}
