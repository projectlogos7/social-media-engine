import Link from "next/link";
import { getDb } from "@sme/db";
import { listJobs, listPosts } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { RunningJobs } from "@/components/project/RunningJobs";

const STATUSES = ["draft", "ready", "scheduled", "published"];

export default async function PostsPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ status?: string; batch?: string }> }) {
  const { projectId } = await params;
  const { status, batch } = await searchParams;
  const s = await requireSession();
  const [posts, jobs] = await Promise.all([listPosts(getDb(), s.actor, projectId, { status, batchId: batch }), listJobs(getDb(), s.actor, projectId, 20)]);
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running").map((j) => ({ id: j.id, type: j.type, summary: j.summary, status: j.status, progress: j.progress }));
  const failed = jobs.filter((j) => j.status === "failed" && Date.now() - new Date(j.updatedAt).getTime() < 86400_000);
  return (
    <div className="stack">
      <div className="row spread">
        <div className="row">
          <Link className={`badge ${!status ? "ok" : ""}`} href={`/p/${projectId}`}>All</Link>
          {STATUSES.map((st) => <Link key={st} className={`badge ${status === st ? "ok" : ""}`} href={`/p/${projectId}?status=${st}`}>{st}</Link>)}
          {batch && <span className="badge warn">batch {batch.slice(0, 8)}</span>}
        </div>
        <Link className="btn primary" href={`/p/${projectId}/create`}>New post</Link>
      </div>
      <RunningJobs jobs={active} />
      {failed.map((j) => <div key={j.id} className="alert err">{j.summary}: {j.error}</div>)}
      {!posts.length && <div className="card muted">No posts yet. Create one from a template, a brief, or your website.</div>}
      <div className="grid">
        {posts.map((p) => (
          <Link key={p.id} href={`/p/${projectId}/posts/${p.id}`} className="card" style={{ padding: 10, color: "inherit", textDecoration: "none" }}>
            {p.thumbnailRenderId ? <img className="thumb" src={`/api/renders/${p.thumbnailRenderId}`} alt="" loading="lazy" /> : <div className="thumb" />}
            <div style={{ marginTop: 8, fontWeight: 600, lineHeight: 1.3 }}>{p.title}</div>
            <div className="row small" style={{ marginTop: 6, gap: 6 }}>
              <span className="badge">{p.status}</span>
              {p.kind === "carousel" && <span className="badge">carousel</span>}
              {p.allPassed ? <span className="badge ok">checks pass</span> : <span className="badge err">needs fixes</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
