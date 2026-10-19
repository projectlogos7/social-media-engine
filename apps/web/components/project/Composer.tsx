"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormatId, QualityIssue, SlotValues, TemplateSpec } from "@sme/core";
import { createPost, startGeneration } from "@/app/actions";
import { ErrorBox, FORMAT_LABELS, FormatChecks, Issues, JobStatus, useAction, useJob } from "@/components/ui";
import { SlotForm, type LibraryImage } from "./SlotForm";

interface Tpl {
  id: string;
  versionId: string;
  name: string;
  role: string;
  spec: TemplateSpec;
}

/** Live preview of a template with the current slot values (debounced). */
export function LivePreview({ projectId, spec, format, slots }: { projectId: string; spec: TemplateSpec; format: FormatId; slots: SlotValues }) {
  const [png, setPng] = useState<string | null>(null);
  const [issues, setIssues] = useState<QualityIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify({ spec, format, slots });
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await fetch("/api/templates/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, spec, format, slots }) });
      const j = await r.json();
      if (n !== seq.current) return;
      setBusy(false);
      if (!r.ok) return setErr(j.error);
      setErr(null);
      setPng(j.png);
      setIssues(j.report.issues);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className="stack">
      <div className="row spread small muted"><span>{FORMAT_LABELS[format]}</span>{busy && <span className="spinner" />}</div>
      <ErrorBox error={err} />
      {png && <img className="preview" src={png} alt="Preview" />}
      <Issues issues={issues} empty="Passes every check." />
    </div>
  );
}

export function Composer(props: {
  projectId: string;
  templates: Tpl[];
  library: LibraryImage[];
  pages: { id: string; title: string; url: string; types: string[] }[];
  imagery: { provider: string; candidates: number };
  initialPageId?: string;
  initialTemplateId?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"ai" | "manual">(props.initialPageId ? "ai" : "ai");
  const singles = props.templates.filter((t) => t.role === "single");
  const [kind, setKind] = useState<"single" | "carousel">("single");
  const [templateId, setTemplateId] = useState(props.initialTemplateId ?? (singles[0]?.id || ""));
  const tpl = props.templates.find((t) => t.id === templateId);
  const [formats, setFormats] = useState<FormatId[]>(tpl ? [tpl.spec.formats[0]] : ["square"]);
  const [slots, setSlots] = useState<SlotValues>(tpl ? (tpl.spec.sample as SlotValues) : {});
  const [library, setLibrary] = useState(props.library);
  const [previewFormat, setPreviewFormat] = useState<FormatId>(formats[0]);

  // AI mode
  const [aiTemplate, setAiTemplate] = useState("auto");
  const [brief, setBrief] = useState("");
  const [variants, setVariants] = useState(2);
  const [images, setImages] = useState<"generate" | "library" | "none">("generate");
  const [pageIds, setPageIds] = useState<string[]>(props.initialPageId ? [props.initialPageId] : []);
  const [pageFilter, setPageFilter] = useState("");
  const [cover, setCover] = useState(props.templates.find((t) => t.role === "cover")?.id ?? "");
  const [content, setContent] = useState(props.templates.find((t) => t.role === "content")?.id ?? "");
  const [end, setEnd] = useState(props.templates.find((t) => t.role === "end")?.id ?? "");
  const [pagesCount, setPagesCount] = useState(5);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const { pending, error, run } = useAction();

  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    const t = props.templates.find((x) => x.id === id);
    if (t) {
      setSlots(t.spec.sample as SlotValues);
      const f = formats.filter((x) => t.spec.formats.includes(x));
      setFormats(f.length ? f : [t.spec.formats[0]]);
      setPreviewFormat(f[0] ?? t.spec.formats[0]);
    }
  };

  const allowedFormats = useMemo<FormatId[]>(() => {
    if (mode === "manual") return tpl?.spec.formats ?? [];
    if (kind === "carousel") {
      const ts = [cover, content, end].map((id) => props.templates.find((t) => t.id === id)).filter(Boolean) as Tpl[];
      return (["square", "portrait"] as FormatId[]).filter((f) => ts.every((t) => t.spec.formats.includes(f)));
    }
    if (aiTemplate === "auto") return [...new Set(singles.flatMap((t) => t.spec.formats))] as FormatId[];
    return props.templates.find((t) => t.id === aiTemplate)?.spec.formats ?? [];
  }, [mode, kind, tpl, cover, content, end, aiTemplate, props.templates, singles]);

  const filteredPages = props.pages.filter((p) => !pageFilter || `${p.title} ${p.url}`.toLowerCase().includes(pageFilter.toLowerCase())).slice(0, 60);
  const created = (job?.result as { postIds?: string[] } | null)?.postIds;

  if (!props.templates.length)
    return <div className="card">No templates yet. <Link href={`/p/${props.projectId}/templates`}>Create templates</Link> from your design system first.</div>;

  return (
    <div className="stack">
      <div className="tabs">
        <button className={mode === "ai" ? "on" : ""} onClick={() => setMode("ai")}>Write with AI</button>
        <button className={mode === "manual" ? "on" : ""} onClick={() => setMode("manual")}>Fill in myself</button>
      </div>
      <ErrorBox error={error} />

      {mode === "manual" && tpl && (
        <div className="cols">
          <div className="card stack">
            <div className="field">
              <label>Template</label>
              <select value={templateId} onChange={(e) => chooseTemplate(e.target.value)}>
                {props.templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.role !== "single" ? ` (${t.role})` : ""}</option>)}
              </select>
              <div className="hint">{tpl.spec.description}</div>
            </div>
            <div className="field"><label>Formats</label><FormatChecks value={formats} onChange={(f) => { setFormats(f); if (f[0]) setPreviewFormat(f[0]); }} allowed={allowedFormats} /></div>
            <SlotForm slots={tpl.spec.slots} values={slots} onChange={setSlots} library={library} projectId={props.projectId} onUploaded={(img) => setLibrary([img, ...library])} />
            <button className="primary" disabled={pending || !formats.length} onClick={() => run(() => createPost(props.projectId, { pages: [{ templateVersionId: tpl.versionId, slots }], formats }), (id) => router.push(`/p/${props.projectId}/posts/${id}`), false)}>
              Create post
            </button>
          </div>
          <div className="card stack">
            <div className="row">{formats.map((f) => <button key={f} className={previewFormat === f ? "primary" : ""} onClick={() => setPreviewFormat(f)}>{FORMAT_LABELS[f]}</button>)}</div>
            <LivePreview projectId={props.projectId} spec={tpl.spec} format={formats.includes(previewFormat) ? previewFormat : formats[0] ?? tpl.spec.formats[0]} slots={slots} />
          </div>
        </div>
      )}

      {mode === "ai" && (
        <div className="cols side-r">
          <div className="card stack">
            <div className="row">
              <label className="row" style={{ fontWeight: 400 }}><input type="radio" style={{ width: "auto" }} checked={kind === "single"} onChange={() => setKind("single")} /> Single post</label>
              <label className="row" style={{ fontWeight: 400 }}><input type="radio" style={{ width: "auto" }} checked={kind === "carousel"} onChange={() => setKind("carousel")} /> Carousel</label>
            </div>
            {kind === "single" ? (
              <div className="field">
                <label>Template</label>
                <select value={aiTemplate} onChange={(e) => setAiTemplate(e.target.value)}>
                  <option value="auto">Let Claude choose the best template</option>
                  {singles.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            ) : (
              <div className="row">
                {([["Cover", cover, setCover, "cover"], ["Pages", content, setContent, "content"], ["End", end, setEnd, "end"]] as const).map(([label, val, set, role]) => (
                  <div className="field" key={label} style={{ flex: 1, minWidth: 150 }}>
                    <label>{label}</label>
                    <select value={val} onChange={(e) => set(e.target.value)}>
                      {role === "end" && <option value="">No end page</option>}
                      {props.templates.filter((t) => t.role === role || (role === "content" && t.role === "single")).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                ))}
                <div className="field" style={{ width: 110 }}><label>Pages</label><input type="number" min={2} max={10} value={pagesCount} onChange={(e) => setPagesCount(Number(e.target.value))} /></div>
              </div>
            )}
            <div className="field">
              <label>Brief</label>
              <textarea value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What is this post about? Who is it for? Anything it must say (dates, names, a call to action)?" rows={5} />
            </div>
            <div className="field"><label>Formats</label><FormatChecks value={formats.filter((f) => allowedFormats.includes(f))} onChange={setFormats} allowed={allowedFormats} /></div>
            <div className="row">
              {kind === "single" && <div className="field" style={{ width: 140 }}><label>Variants</label><select value={variants} onChange={(e) => setVariants(Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select></div>}
              <div className="field" style={{ flex: 1 }}>
                <label>Images</label>
                <select value={images} onChange={(e) => setImages(e.target.value as typeof images)}>
                  <option value="generate">Generate ({props.imagery.provider}, {props.imagery.candidates} candidates each)</option>
                  <option value="library">Leave image slots for me to pick from the library</option>
                  <option value="none">No images</option>
                </select>
              </div>
            </div>
            <button
              className="primary"
              disabled={pending || !!(job && job.status !== "done" && job.status !== "failed") || !formats.some((f) => allowedFormats.includes(f)) || (!brief.trim() && !pageIds.length)}
              onClick={() =>
                run(
                  () =>
                    startGeneration({
                      projectId: props.projectId,
                      templateId: kind === "single" ? aiTemplate : undefined,
                      carousel: kind === "carousel" ? { coverTemplateId: cover, contentTemplateId: content, endTemplateId: end || undefined, pages: pagesCount } : undefined,
                      brief,
                      formats: formats.filter((f) => allowedFormats.includes(f)),
                      variants: kind === "single" ? variants : 1,
                      sourcePageIds: pageIds,
                      images: images === "library" ? "none" : images,
                    }),
                  (id) => setJobId(id),
                  false,
                )
              }
            >
              Generate
            </button>
            <JobStatus job={job} />
            {created && (
              <div className="stack">
                <b>Created {created.length} post{created.length > 1 ? "s" : ""}:</b>
                <div className="row">{created.map((id, i) => <Link key={id} className="btn" href={`/p/${props.projectId}/posts/${id}`}>Open variant {i + 1}</Link>)}</div>
              </div>
            )}
          </div>
          <div className="card stack">
            <h3>Use website content <span className="hint">({pageIds.length} selected)</span></h3>
            <p className="small muted">Selected pages are given to Claude as sources; facts come only from the brief and these pages, and each post records the URLs it used.</p>
            <input placeholder="Filter pages" value={pageFilter} onChange={(e) => setPageFilter(e.target.value)} />
            <div style={{ maxHeight: 460, overflow: "auto" }} className="stack">
              {filteredPages.map((p) => (
                <label key={p.id} className="row" style={{ fontWeight: 400, alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <input type="checkbox" style={{ width: "auto", marginTop: 4 }} checked={pageIds.includes(p.id)} onChange={(e) => setPageIds(e.target.checked ? [...pageIds, p.id] : pageIds.filter((x) => x !== p.id))} />
                  <span>
                    <span>{p.title}</span> {p.types.map((t) => <span key={t} className="badge" style={{ marginLeft: 4 }}>{t}</span>)}
                    <br /><span className="small muted">{p.url}</span>
                  </span>
                </label>
              ))}
              {!props.pages.length && <span className="small muted">No website content yet. Add the site on the Website tab.</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
