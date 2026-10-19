import Link from "next/link";
import type { ReactNode } from "react";
import { getDb } from "@sme/db";
import { listProjects } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { signOutAction, switchWorkspaceAction } from "@/app/actions";

export async function Shell({ children }: { children: ReactNode }) {
  const s = await requireSession();
  const projects = await listProjects(getDb(), s.actor);
  return (
    <div className="shell">
      <nav className="side">
        <div className="brand">Social Media Engine</div>
        {s.workspaces.length > 1 ? (
          <form action={async (fd: FormData) => { "use server"; await switchWorkspaceAction(String(fd.get("ws"))); }}>
            <select name="ws" defaultValue={s.workspace.id} style={{ background: "#2f3d39", color: "#fff", border: 0, marginBottom: 8 }}>
              {s.workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
            <button style={{ width: "100%", marginBottom: 8 }}>Switch workspace</button>
          </form>
        ) : (
          <div className="small" style={{ padding: "0 10px 8px", color: "#9fb1aa" }}>{s.workspace.name}</div>
        )}
        <Link href="/">All projects</Link>
        <div className="section">Projects</div>
        {projects.map((p) => (
          <Link key={p.id} href={`/p/${p.id}`}>{p.name}</Link>
        ))}
        <div className="section">Workspace</div>
        <Link href="/settings">Members & API keys</Link>
        <form action={signOutAction}>
          <button style={{ marginTop: 16, width: "100%", background: "transparent", color: "#dfe7e3", borderColor: "#3c4c47" }}>Sign out ({s.user.name})</button>
        </form>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
