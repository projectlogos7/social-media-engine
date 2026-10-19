"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormatId } from "@sme/core";
import { addSource, crawlNow, deleteSource, searchKnowledge, updateSource } from "@/app/actions";
import { Confirm, ErrorBox, FormatChecks, JobStatus, useAction, useJob } from "@/components/ui";

type AutoDraft = { templateId: string; entityTypes: string[]; formats: FormatId[]; images: "generate" | "library" | "none" } | null;
interface Src { id: string; url: string; status: string; lastError: string | null; lastCrawledAt: string | null; pageCount: number; maxPages: number; intervalHours: number; renderJs: boolean; pathPrefix: string; autoDraft: AutoDraft }
const TYPES = ["article", "event", "product", "video", "course"];

function AutoDraftEditor({ projectId, src, templates }: { projectId: string; src: Src; templates: { id: string; name: string; formats: FormatId[] }[] }) {
  const { pending, error, run } = useAction();
  const [ad, setAd] = useState<NonNullable<AutoDraft>>(src.autoDraft ?? { templateId: templates[0]?.id ?? "", entityTypes: ["article", "event"], formats: ["square"], images: "generate" });
  const tpl = templates.find((t) => t.id === ad.templateId);
  return (
    <details>
      <summary className="small">Auto-draft posts for new content {src.autoDraft ? <span className="badge ok">on</span> : <span className="badge">off</span>}</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <ErrorBox error={error} />
        <p className="small muted">When a recrawl finds new pages of these kinds, a draft post is generated from each one with Claude.</p>
        <div className="checks">{TYPES.map((t) => <label key={t}><input type="checkbox" checked={ad.entityTypes.includes(t)} onChange={(e) => setAd({ ...ad, entityTypes: e.target.checked ? [...ad.entityTypes, t] : ad.entityTypes.filter((x) => x !== t) })} />{t}</label>)}</div>
        <select value={ad.templateId} onChange={(e) => setAd({ ...ad, templateId: e.target.value })}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <FormatChecks value={ad.formats} onChange={(f) => setAd({ ...ad, formats: f })} allowed={tpl?.formats} />
        <div className="row">
          <button className="primary" disabled={pending || !ad.templateId || !ad.formats.length} onClick={() => run(() => updateSource(projectId, src.id, { autoDraft: ad }))}>Save auto-draft</button>
          {src.autoDraft && <button disabled={pending} onClick={() => run(() => updateSource(projectId, src.id, { autoDraft: null }))}>Turn off</button>}
        </div>
      </div>
    </details>
  );
}

function SourceRow({ projectId, src, canManage, templates }: { projectId: string; src: Src; canManage: boolean; templates: { id: string; name: string; formats: FormatId[] }[] }) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId, () => router.refresh());
  const r = job?.result as { saved?: number; newPages?: number; skipped?: number } | null;
  return (
    <div className="card stack">
      <div className="row spread">
        <div>
          <a href={src.url} target="_blank" rel="noreferrer"><b>{src.url}</b></a>
          <div className="small muted">{src.pageCount} pages · {src.lastCrawledAt ? `last read ${new Date(src.lastCrawledAt).toLocaleString()}` : "not read yet"} · {src.intervalHours ? `every ${src.intervalHours}h` : "manual only"} · up to {src.maxPages} pages{src.pathPrefix && ` under ${src.pathPrefix}`}{src.renderJs && " · renders JavaScript"}</div>
        </div>
        <div className="row">
          <span className={`badge ${src.status === "error" ? "err" : src.status === "idle" ? "ok" : "warn"}`}>{src.status}</span>
          {canManage && <button disabled={pending || src.status === "crawling" || src.status === "queued"} onClick={() => run(() => crawlNow(projectId, src.id), setJobId)}>Read now</button>}
          {canManage && <Confirm label="Remove" onConfirm={() => run(() => deleteSource(projectId, src.id))} />}
        </div>
      </div>
      {src.lastError && <div className="alert err">{src.lastError}</div>}
      <ErrorBox error={error} />
      <JobStatus job={job} />
      {r && <div className="small">Read {r.saved} pages, {r.newPages} new, {r.skipped} skipped.</div>}
      {canManage && <AutoDraftEditor projectId={projectId} src={src} templates={templates} />}
    </div>
  );
}

export function Sources({ projectId, sources, canManage, templates }: { projectId: string; sources: Src[]; canManage: boolean; templates: { id: string; name: string; formats: FormatId[] }[] }) {
  const { pending, error, run } = useAction();
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(200);
  const [interval, setInterval] = useState(24);
  const [renderJs, setRenderJs] = useState(false);
  const [prefix, setPrefix] = useState("");
  return (
    <div className="stack">
      {canManage && (
        <div className="card stack">
          <h2>Connect a website</h2>
          <p className="small muted">The engine reads the sitemap and pages (respecting robots.txt), keeps the text, and recognises articles, events and products. Claude then uses it as the source for posts.</p>
          <ErrorBox error={error} />
          <div className="row">
            <input placeholder="https://example.org" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 3, minWidth: 240 }} />
            <input type="number" value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} style={{ width: 110 }} title="Max pages" />
            <select value={interval} onChange={(e) => setInterval(Number(e.target.value))} style={{ width: 150 }}>
              <option value={0}>Manual only</option><option value={6}>Every 6 hours</option><option value={24}>Daily</option><option value={168}>Weekly</option>
            </select>
          </div>
          <div className="row">
            <input placeholder="Only under this path, e.g. /blog (optional)" value={prefix} onChange={(e) => setPrefix(e.target.value)} style={{ flex: 1 }} />
            <label className="row" style={{ fontWeight: 400, margin: 0 }}><input type="checkbox" checked={renderJs} onChange={(e) => setRenderJs(e.target.checked)} style={{ width: "auto" }} /> Site needs JavaScript</label>
            <button className="primary" disabled={pending || !url} onClick={() => run(() => addSource(projectId, { url, maxPages, intervalHours: interval, renderJs, pathPrefix: prefix }), () => setUrl(""))}>Add and read</button>
          </div>
        </div>
      )}
      {sources.map((s) => <SourceRow key={s.id} projectId={projectId} src={s} canManage={canManage} templates={templates} />)}
    </div>
  );
}

export function WebPages({ projectId, pages, q, type }: { projectId: string; q: string; type: string; pages: { id: string; url: string; title: string; description: string; image: string | null; firstSeenAt: string; entities: { type: string; name: string; date: string | null }[] }[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ pageId: string; text: string; url: string; title: string }[] | null>(null);
  const { pending, error, run } = useAction();
  return (
    <div className="card stack">
      <h2>Content</h2>
      <div className="row">
        <form onSubmit={(e) => { e.preventDefault(); router.push(`?q=${encodeURIComponent(String(new FormData(e.currentTarget).get("q")))}&type=${type}`); }} className="row" style={{ flex: 1 }}>
          <input name="q" defaultValue={q} placeholder="Filter by title or URL" style={{ flex: 1 }} />
        </form>
        <select value={type} onChange={(e) => router.push(`?q=${encodeURIComponent(q)}&type=${e.target.value}`)} style={{ width: 160 }}>
          <option value="">All pages</option>{TYPES.map((t) => <option key={t} value={t}>{t}s</option>)}
        </select>
      </div>
      <div className="row">
        <input placeholder="Search the text (what Claude will see)" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
        <button disabled={pending || !query} onClick={() => run(() => searchKnowledge(projectId, query), setHits, false)}>Search</button>
      </div>
      <ErrorBox error={error} />
      {hits && (
        <div className="stack">
          {!hits.length && <div className="small muted">No matches.</div>}
          {hits.map((h, i) => <div key={i} className="small"><b>{h.title}</b> <span className="muted">{h.url}</span><div className="muted">{h.text.slice(0, 300)}…</div></div>)}
        </div>
      )}
      <table>
        <thead><tr><th>Page</th><th>Recognised</th><th>First seen</th><th></th></tr></thead>
        <tbody>
          {pages.map((p) => (
            <tr key={p.id}>
              <td><a href={p.url} target="_blank" rel="noreferrer">{p.title}</a><div className="small muted">{p.description.slice(0, 140)}</div></td>
              <td>{p.entities.map((e, i) => <div key={i} className="small"><span className="badge">{e.type}</span> {e.name}{e.date ? ` · ${e.date.slice(0, 10)}` : ""}</div>)}</td>
              <td className="small">{new Date(p.firstSeenAt).toLocaleDateString()}</td>
              <td><Link className="btn" href={`/p/${projectId}/create?page=${p.id}`}>Make a post</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!pages.length && <div className="small muted">No pages yet.</div>}
    </div>
  );
}
