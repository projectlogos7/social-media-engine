import Link from "next/link";
import { can } from "@sme/core";
import { getDb } from "@sme/db";
import { listProjects } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { NewProject } from "@/components/workspace/NewProject";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await requireSession();
  const { error } = await searchParams;
  const projects = await listProjects(getDb(), s.actor);
  return (
    <div className="stack">
      <div className="header">
        <div>
          <h1>Projects</h1>
          <p className="muted">Each project has its own locked design system, templates, website and channels.</p>
        </div>
      </div>
      {error && <div className="alert err">{error}</div>}
      <div className="grid wide">
        {projects.map((p) => {
          const colors = ((p.designSystem?.tokens as { color?: { tokens?: { value: unknown }[] } })?.color?.tokens ?? [])
            .map((t) => t.value)
            .filter((v): v is string => typeof v === "string" && v.startsWith("#"))
            .slice(0, 6);
          return (
            <Link key={p.id} href={`/p/${p.id}`} className="card" style={{ color: "inherit", textDecoration: "none" }}>
              <div className="row" style={{ gap: 4, marginBottom: 12 }}>
                {colors.map((c) => <span key={c} style={{ width: 28, height: 28, borderRadius: 4, background: c, border: "1px solid rgba(0,0,0,.08)" }} />)}
              </div>
              <h2 style={{ marginBottom: 4 }}>{p.name}</h2>
              <div className="small muted">
                {p.designSystem ? `${p.designSystem.name} v${p.designSystem.version}` : "No design system yet"} · {p.templateCount} templates · {p.postCount} posts
              </div>
              <div className="small muted">Your role: {p.role}</div>
            </Link>
          );
        })}
        {can(s.role, "project.create") && <NewProject />}
      </div>
    </div>
  );
}
