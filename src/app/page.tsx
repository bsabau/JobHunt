import { cookies } from "next/headers";
import { KanbanBoard } from "@/components/kanban-board";
import { LogoutButton } from "@/components/logout-button";
import { listApplications, listStages } from "@/lib/db";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [applications, stages] = await Promise.all([listApplications(), listStages()]);

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const readOnly = session?.role === "guest";

  return (
    <main className="mx-auto min-h-screen max-w-[1500px] px-6 py-10">
      <div className="mb-8 flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.25em] text-sky-300/80">Job Tracker</p>
          <h1 className="text-3xl font-bold">Kanban Job Hunt Dashboard</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {readOnly
              ? "You are viewing the board as a guest. Editing is disabled."
              : "Add companies, track your progress by dragging cards between stages, and get logo lookup automatically."}
          </p>
        </div>
        <LogoutButton />
      </div>
      <KanbanBoard initialApplications={applications} initialStages={stages} readOnly={readOnly} />
    </main>
  );
}
