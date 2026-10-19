"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { FormatId } from "@sme/core";
import { createBatch } from "@/app/actions";
import { ErrorBox, FormatChecks, useAction } from "@/components/ui";

export function BatchForm({ projectId, templates, pages }: { projectId: string; templates: { id: string; name: string; formats: FormatId[] }[]; pages: { id: string; title: string; url: string; types: string[]; firstSeenAt: string }[] }) {
  const { pending, error, run } = useAction();
  const [tpl, setTpl] = useState<string[]>(templates.slice(0, 1).map((t) => t.id));
  const [sel, setSel] = useState<string[]>([]);
  const [type, setType] = useState("");
  const [brief, setBrief] = useState("Make a post that sends people to this page. Use its most interesting concrete detail.");
  const [formats, setFormats] = useState<FormatId[]>(["square"]);
  const [images, setImages] = useState<"generate" | "none">("generate");
  const [done, setDone] = useState<{ batchId: string; jobIds: string[] } | null>(null);
  const allowed = useMemo(() => (["square", "portrait", "story", "landscape", "youtube"] as FormatId[]).filter((f) => tpl.every((id) => templates.find((t) => t.id === id)?.formats.includes(f))), [tpl, templates]);
  const shown = pages.filter((p) => !type || p.types.includes(type));
  const total = Math.max(sel.length, 1) * tpl.length;
  return (
    <div className="cols side-r">
      <div className="card stack">
        <h2>Batch</h2>
        <p className="small muted">One post per selected page and template, written by Claude, each going through the same checks. Posts arrive as drafts.</p>
        <ErrorBox error={error} />
        <div className="field"><label>Templates</label><div className="checks">{templates.map((t) => <label key={t.id}><input type="checkbox" checked={tpl.includes(t.id)} onChange={(e) => setTpl(e.target.checked ? [...tpl, t.id] : tpl.filter((x) => x !== t.id))} />{t.name}</label>)}</div></div>
        <div className="field"><label>Formats</label><FormatChecks value={formats.filter((f) => allowed.includes(f))} onChange={setFormats} allowed={allowed} /></div>
        <div className="field"><label>Brief for every post</label><textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} /></div>
        <div className="field"><label>Images</label><select value={images} onChange={(e) => setImages(e.target.value as "generate" | "none")}><option value="generate">Generate</option><option value="none">None (pick later)</option></select></div>
        <button className="primary" disabled={pending || !tpl.length || !formats.some((f) => allowed.includes(f)) || total > 60} onClick={() => run(() => createBatch({ projectId, templateIds: tpl, sourcePageIds: sel, brief, formats: formats.filter((f) => allowed.includes(f)), images }), setDone, false)}>
          Create {total} post{total > 1 ? "s" : ""}
        </button>
        {total > 60 && <div className="small" style={{ color: "var(--err)" }}>At most 60 posts per batch.</div>}
        {done && <div className="alert ok">Queued {done.jobIds.length} posts. <Link href={`/p/${projectId}?batch=${done.batchId}`}>Watch them arrive</Link></div>}
      </div>
      <div className="card stack">
        <div className="row spread"><h3>Pages ({sel.length})</h3><select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 150 }}><option value="">All</option>{["article", "event", "product"].map((t) => <option key={t} value={t}>{t}s</option>)}</select></div>
        <div className="row"><button onClick={() => setSel(shown.slice(0, 10).map((p) => p.id))}>Newest 10</button><button onClick={() => setSel([])}>Clear</button></div>
        <div style={{ maxHeight: 520, overflow: "auto" }} className="stack">
          {shown.map((p) => (
            <label key={p.id} className="row" style={{ fontWeight: 400, flexWrap: "nowrap", alignItems: "flex-start" }}>
              <input type="checkbox" style={{ width: "auto", marginTop: 4 }} checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />
              <span>{p.title}<br /><span className="small muted">{p.url}</span></span>
            </label>
          ))}
          {!pages.length && <span className="small muted">No website pages yet; a batch without pages makes one post per template from the brief.</span>}
        </div>
      </div>
    </div>
  );
}
