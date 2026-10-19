import Link from "next/link";
import { can } from "@sme/core";
import { getDb } from "@sme/db";
import { getProject, listAssets, listSavedRenders } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { LibraryGrid, UploadButton } from "@/components/project/Library";
import { FORMAT_LABELS } from "@/components/ui";

export default async function LibraryPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { projectId } = await params;
  const { tab = "saved" } = await searchParams;
  const s = await requireSession();
  const db = getDb();
  const p = await getProject(db, s.actor, projectId);
  const edit = can(p.role, "post.create");
  const tabs = [["saved", "Saved posts"], ["upload", "Uploads"], ["generated", "Generated images"]] as const;
  return (
    <div className="stack">
      <div className="row spread">
        <nav className="tabs" style={{ marginBottom: 0 }}>{tabs.map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={tab === k ? "on" : ""}>{l}</Link>)}</nav>
        {edit && <UploadButton projectId={projectId} />}
      </div>
      {tab === "saved" ? (
        <SavedRenders projectId={projectId} rows={await listSavedRenders(db, s.actor, projectId)} />
      ) : (
        <LibraryGrid projectId={projectId} canEdit={edit} assets={(await listAssets(db, s.actor, projectId, { kind: tab })).map((a) => ({ id: a.id, name: a.name, kind: a.kind, approved: a.approved, width: a.width, height: a.height, paletteDistance: a.paletteDistance, prompt: (a.generation as { prompt?: string; seed?: number; provider?: string } | null) ?? null }))} />
      )}
    </div>
  );
}

function SavedRenders({ projectId, rows }: { projectId: string; rows: { id: string; postId: string; format: string; title: string; createdAt: Date }[] }) {
  if (!rows.length) return <div className="card muted">Images are saved here when you download or publish a post.</div>;
  return (
    <div className="grid">
      {rows.map((r) => (
        <div key={r.id} className="card" style={{ padding: 10 }}>
          <Link href={`/p/${projectId}/posts/${r.postId}`}><img className="thumb" src={`/api/renders/${r.id}`} alt="" loading="lazy" /></Link>
          <div className="small" style={{ marginTop: 6, fontWeight: 600 }}>{r.title}</div>
          <div className="row spread small muted"><span>{FORMAT_LABELS[r.format as keyof typeof FORMAT_LABELS]}</span><a href={`/api/renders/${r.id}?download=${encodeURIComponent(r.title.slice(0, 40))}`}>Download</a></div>
        </div>
      ))}
    </div>
  );
}
