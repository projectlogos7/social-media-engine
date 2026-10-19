"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { applyCurrentDs, deleteDsVersion, publishDsVersion, startComparison } from "@/app/actions";
import { Confirm, ErrorBox, FORMAT_LABELS, JobStatus, useAction, useJob } from "@/components/ui";
import type { FormatId } from "@sme/core";

export function DsImport({ projectId, hasCurrent }: { projectId: string; hasCurrent: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [publish, setPublish] = useState(!hasCurrent);
  const [note, setNote] = useState("");
  const folder = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList | null, useRelative: boolean) => {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("note", note);
    if (publish) fd.set("publish", "1");
    for (const f of Array.from(files)) {
      fd.append("files", f);
      fd.append("paths", useRelative ? (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name : f.name);
    }
    const r = await fetch("/api/ds/import", { method: "POST", body: fd });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: j.error });
    setMsg({ ok: true, text: `Imported "${j.name}" as v${j.version}: ${j.fonts} fonts, ${j.assets} assets, components: ${j.components.join(", ") || "none"}.${j.warnings.length ? `\nNotes:\n${j.warnings.map((w: string) => `• ${w}`).join("\n")}` : ""}${publish ? "\nPublished." : "\nSaved as a draft; review it below and publish."}` });
    router.push(`/p/${projectId}/design?v=${j.versionId}`);
    router.refresh();
  };
  return (
    <div className="card stack">
      <h2>Import a Claude design system</h2>
      <p className="small muted">Download your Design System artifact from Claude and upload it here: the zip, the folder (the one with tokens.json), or the design system's HTML file. Each import becomes a new, locked version.</p>
      <div className="row">
        <label className="btn primary" style={{ margin: 0 }}>{busy ? "Importing…" : "Upload zip or HTML"}<input type="file" accept=".zip,.html,.htm" hidden onChange={(e) => upload(e.target.files, false)} disabled={busy} /></label>
        <button onClick={() => folder.current?.click()} disabled={busy}>Upload folder</button>
        <input ref={folder} type="file" hidden multiple {...({ webkitdirectory: "", directory: "" } as object)} onChange={(e) => upload(e.target.files, true)} />
        <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <label className="row" style={{ fontWeight: 400, margin: 0 }}><input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} style={{ width: "auto" }} /> Publish right away</label>
      </div>
      {msg && <div className={`alert ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
    </div>
  );
}

export function DsVersions(props: { projectId: string; manage: boolean; currentId: string | null; shownId: string | null; versions: { id: string; version: number; name: string; status: string; note: string; warnings: string[]; createdAt: string }[] }) {
  const { pending, error, run } = useAction();
  if (!props.versions.length) return null;
  return (
    <div className="card stack">
      <h2>Versions</h2>
      <ErrorBox error={error} />
      <table>
        <thead><tr><th>Version</th><th>Name</th><th>Status</th><th>Imported</th><th></th></tr></thead>
        <tbody>
          {props.versions.map((v) => (
            <tr key={v.id} style={{ background: v.id === props.shownId ? "#f2f1ec" : undefined }}>
              <td><Link href={`/p/${props.projectId}/design?v=${v.id}`}>v{v.version}</Link></td>
              <td>{v.name}{v.note && <div className="small muted">{v.note}</div>}</td>
              <td>{v.id === props.currentId ? <span className="badge ok">in use</span> : <span className="badge">{v.status}</span>}</td>
              <td className="small">{new Date(v.createdAt).toLocaleString()}</td>
              <td>
                {props.manage && v.id !== props.currentId && (
                  <div className="row">
                    <button disabled={pending} onClick={() => run(() => publishDsVersion(props.projectId, v.id))}>{v.status === "draft" ? "Publish" : "Make current"}</button>
                    {v.status === "draft" && <Confirm label="Delete" onConfirm={() => run(() => deleteDsVersion(props.projectId, v.id))} />}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">New posts use the version in use. Existing posts keep the version they were made with until you apply a new one (compare below first).</p>
    </div>
  );
}

interface Cmp { postId: string; title: string; format: FormatId; beforeRenderId: string; afterRenderId: string; diffRatio: number; passedBefore: boolean; passedAfter: boolean }

export function DsCompare({ projectId, versionId, version, posts }: { projectId: string; versionId: string; version: number; posts: { id: string; title: string; thumb: string | null }[] }) {
  const [sel, setSel] = useState<string[]>(posts.slice(0, 6).map((p) => p.id));
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const { pending, error, run } = useAction();
  const results = (job?.status === "done" ? (job.result as Cmp[]) : null) ?? null;
  return (
    <div className="card stack">
      <h2>Preview posts with v{version}</h2>
      <p className="small muted">Renders the selected posts with this version without changing them, and shows what moves and whether every check still passes.</p>
      <ErrorBox error={error} />
      <div className="checks">{posts.map((p) => <label key={p.id}><input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />{p.title}</label>)}</div>
      <div className="row">
        <button className="primary" disabled={pending || !sel.length} onClick={() => run(() => startComparison(projectId, versionId, sel), setJobId, false)}>Compare</button>
        <JobStatus job={job} />
      </div>
      {results && (
        <>
          <table>
            <thead><tr><th>Post</th><th>Format</th><th>Before</th><th>With v{version}</th><th>Changed</th><th>Checks</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.afterRenderId}>
                  <td>{r.title}</td><td>{FORMAT_LABELS[r.format]}</td>
                  <td><img src={`/api/renders/${r.beforeRenderId}`} alt="" style={{ width: 120 }} /></td>
                  <td><img src={`/api/renders/${r.afterRenderId}`} alt="" style={{ width: 120 }} /></td>
                  <td>{(r.diffRatio * 100).toFixed(1)}%</td>
                  <td>{r.passedAfter ? <span className="badge ok">pass</span> : <span className="badge err">fail</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button className="primary" disabled={pending} onClick={() => run(async () => { const a = await publishDsVersion(projectId, versionId); return a.ok ? applyCurrentDs(projectId, [...new Set(results.map((r) => r.postId))]) : a; })}>
              Publish v{version} and move these posts to it
            </button>
          </div>
        </>
      )}
    </div>
  );
}
