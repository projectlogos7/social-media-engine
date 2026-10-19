"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { type FormatId, PLATFORM_FORMATS, type Platform, type QualityReport, type SlotValues, type TemplateSpec } from "@sme/core";
import { cancelPublication, chooseImage, deletePost, duplicatePost, renderPost, schedulePublication, updatePost } from "@/app/actions";
import { Confirm, ErrorBox, FORMAT_LABELS, Issues, PassBadge, useAction } from "@/components/ui";
import { SlotForm, type LibraryImage } from "./SlotForm";

interface Page {
  id: string;
  index: number;
  slots: SlotValues;
  templateName: string;
  templateVersion: number;
  outdated: boolean;
  spec: TemplateSpec;
  renders: Record<string, { id: string; passed: boolean; report: QualityReport; recipe: unknown; hash: string; createdAt: string } | null>;
}

export function PostEditor(props: {
  projectId: string;
  canEdit: boolean;
  canPublish: boolean;
  post: { id: string; title: string; status: string; kind: string; caption: string; hashtags: string[]; altText: string; sourceUrls: string[]; formats: FormatId[]; brief: string; meta: { model?: string; attempts?: number; problems?: string[]; candidates?: Record<string, string[]>; imagePrompts?: Record<string, string>; templateReason?: string } };
  pages: Page[];
  library: LibraryImage[];
  channels: { id: string; name: string; platform: string; expired: boolean }[];
  publications: { id: string; channelId: string; format: string; status: string; scheduledAt: string; url: string | null; error: string | null }[];
  publishing: { instagram: boolean; linkedin: boolean };
}) {
  const router = useRouter();
  const { post } = props;
  const [pageIdx, setPageIdx] = useState(0);
  const page = props.pages[pageIdx];
  const [slots, setSlots] = useState<Record<string, SlotValues>>(Object.fromEntries(props.pages.map((p) => [p.id, p.slots])));
  const [title, setTitle] = useState(post.title);
  const [caption, setCaption] = useState(post.caption);
  const [hashtags, setHashtags] = useState(post.hashtags.join(" "));
  const [altText, setAltText] = useState(post.altText);
  const [format, setFormat] = useState<FormatId>(post.formats[0]);
  const [library, setLibrary] = useState(props.library);
  const { pending, error, run } = useAction();
  const dirty = JSON.stringify(slots) !== JSON.stringify(Object.fromEntries(props.pages.map((p) => [p.id, p.slots]))) || title !== post.title || caption !== post.caption || hashtags !== post.hashtags.join(" ") || altText !== post.altText;

  const save = () =>
    run(async () => {
      const r = await updatePost(props.projectId, post.id, {
        title, caption, altText,
        hashtags: hashtags.split(/\s+/).filter(Boolean),
        pages: props.pages.map((p) => ({ id: p.id, slots: slots[p.id] })),
      });
      if (!r.ok) return r;
      return renderPost(props.projectId, post.id);
    });

  const render = page.renders[format];
  const issuesBySlot: Record<string, string[]> = {};
  for (const i of render?.report.issues ?? []) if (i.slot && i.severity === "error") (issuesBySlot[i.slot] ??= []).push(i.message);
  const allRenders = props.pages.flatMap((p) => post.formats.map((f) => p.renders[f]));
  const failing = allRenders.filter((r) => r && !r.passed).length;
  const isCarousel = props.pages.length > 1;

  return (
    <div className="stack">
      <div className="row spread">
        <div className="row">
          <Link href={`/p/${props.projectId}`}>← Posts</Link>
          <span className="badge">{post.status}</span>
          {isCarousel && <span className="badge">carousel · {props.pages.length} pages</span>}
          {failing ? <span className="badge err">{failing} render{failing > 1 ? "s" : ""} need fixes</span> : <span className="badge ok">all checks pass</span>}
        </div>
        {props.canEdit && (
          <div className="row">
            <button disabled={pending} onClick={() => run(() => duplicatePost(props.projectId, post.id), (id) => router.push(`/p/${props.projectId}/posts/${id}`), false)}>Duplicate</button>
            <Confirm label="Delete" onConfirm={() => run(() => deletePost(props.projectId, post.id), () => router.push(`/p/${props.projectId}`), false)} />
          </div>
        )}
      </div>
      <ErrorBox error={error} />

      <div className="cols">
        <div className="stack">
          <div className="card stack">
            <div className="field"><label>Title <span className="hint">internal</span></label><input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!props.canEdit} /></div>
            {isCarousel && (
              <div className="row">{props.pages.map((p, i) => <button key={p.id} className={i === pageIdx ? "primary" : ""} onClick={() => setPageIdx(i)}>Page {i + 1}</button>)}</div>
            )}
            <div className="row spread small">
              <span>Template: <b>{page.templateName}</b> v{page.templateVersion}</span>
              {page.outdated && props.canEdit && <button disabled={pending} onClick={() => run(async () => { const r = await updatePost(props.projectId, post.id, { upgradeTemplates: true }); return r.ok ? renderPost(props.projectId, post.id) : r; })}>Use newest template version</button>}
            </div>
            <SlotForm slots={page.spec.slots} values={slots[page.id]} onChange={(v) => setSlots({ ...slots, [page.id]: v })} library={library} projectId={props.projectId} onUploaded={(img) => setLibrary([img, ...library])} issuesBySlot={issuesBySlot} />
            {Object.entries(post.meta.candidates ?? {}).filter(([k]) => k.startsWith(isCarousel ? `p${pageIdx + 1}_` : "")).map(([key, ids]) => {
              const slot = isCarousel ? key.replace(/^p\d+_/, "") : key;
              const current = (slots[page.id][slot] as { assetId?: string } | null)?.assetId;
              return (
                <div key={key} className="stack">
                  <label>Generated candidates for “{slot}” <span className="hint">sorted by closeness to the brand palette</span></label>
                  {post.meta.imagePrompts?.[key] && <div className="hint">Prompt: {post.meta.imagePrompts[key]}</div>}
                  <div className="grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                    {ids.map((id) => (
                      <button key={id} className={`pick ${current === id ? "on" : ""}`} disabled={!props.canEdit || pending} onClick={() => run(() => chooseImage(props.projectId, post.id, page.id, slot, id))}>
                        <img className="thumb cover" src={`/api/assets/${id}`} alt="" />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="card stack">
            <h3>Caption</h3>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} disabled={!props.canEdit} />
            <div className="field"><label>Hashtags</label><input value={hashtags} onChange={(e) => setHashtags(e.target.value)} disabled={!props.canEdit} /></div>
            <div className="field"><label>Alt text</label><textarea value={altText} onChange={(e) => setAltText(e.target.value)} rows={2} disabled={!props.canEdit} /></div>
            {props.canEdit && <button className="primary" disabled={pending || !dirty} onClick={save}>{pending ? "Saving…" : "Save and re-render"}</button>}
          </div>
          {(post.brief || post.sourceUrls.length > 0 || post.meta.model) && (
            <div className="card stack small">
              <h3>How this was made</h3>
              {post.brief && <div><b>Brief:</b> {post.brief}</div>}
              {post.meta.model && <div><b>Copy:</b> {post.meta.model}, {post.meta.attempts} attempt{post.meta.attempts === 1 ? "" : "s"}{post.meta.templateReason ? ` · template chosen because: ${post.meta.templateReason}` : ""}</div>}
              {!!post.meta.problems?.length && <div className="alert warn">Unresolved after the last attempt: {post.meta.problems.join("; ")}</div>}
              {post.sourceUrls.length > 0 && <div><b>Sources:</b><ul>{post.sourceUrls.map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer">{u}</a></li>)}</ul></div>}
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card stack">
            <div className="row">{post.formats.map((f) => <button key={f} className={format === f ? "primary" : ""} onClick={() => setFormat(f)}>{FORMAT_LABELS[f]} {props.pages.every((p) => p.renders[f]?.passed) ? "✓" : "•"}</button>)}</div>
            {render ? <img className="preview" src={`/api/renders/${render.id}`} alt="Render" /> : <div className="thumb" />}
            <div className="row spread"><PassBadge passed={render?.passed} count={render?.report.issues.filter((i) => i.severity === "error").length} /><span className="small muted">{dirty ? "Unsaved changes" : ""}</span></div>
            <Issues issues={render?.report.issues ?? []} empty={render ? "Passes every check." : undefined} />
            <div className="row">
              {!isCarousel && <a className="btn primary" href={`/api/posts/${post.id}/export?format=${format}&kind=png`}>Download PNG</a>}
              {isCarousel && <a className="btn primary" href={`/api/posts/${post.id}/export?format=${format}&kind=zip`}>Download ZIP</a>}
              {isCarousel && <a className="btn" href={`/api/posts/${post.id}/export?format=${format}&kind=pdf`}>Download PDF (LinkedIn)</a>}
              <button onClick={() => navigator.clipboard.writeText([caption, hashtags].filter(Boolean).join("\n\n"))}>Copy caption</button>
            </div>
            <p className="small muted">Downloads save the post to the library. A post that fails its checks cannot be exported or published.</p>
            {render && (
              <details className="small">
                <summary>Recipe (everything needed to reproduce this image)</summary>
                <div className="mono" style={{ whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" }}>hash {render.hash}{"\n"}{JSON.stringify(render.recipe, null, 2)}</div>
              </details>
            )}
          </div>
          <Publish {...props} format={format} />
        </div>
      </div>
    </div>
  );
}

function Publish(props: Parameters<typeof PostEditor>[0] & { format: FormatId }) {
  const { pending, error, run } = useAction();
  const [channelId, setChannelId] = useState(props.channels[0]?.id ?? "");
  const [when, setWhen] = useState("");
  const ch = props.channels.find((c) => c.id === channelId);
  const isCarousel = props.pages.length > 1;
  const allowed = ch ? PLATFORM_FORMATS[ch.platform as Platform][isCarousel ? "carousel" : "single"] : [];
  return (
    <div className="card stack">
      <h3>Publish</h3>
      <ErrorBox error={error} />
      {!props.channels.length ? (
        <p className="small muted">No connected accounts. <Link href={`/p/${props.projectId}/publish`}>Connect Instagram or LinkedIn</Link>, or download the files above.</p>
      ) : (
        <>
          <div className="row">
            <select value={channelId} onChange={(e) => setChannelId(e.target.value)} style={{ flex: 1 }}>
              {props.channels.map((c) => <option key={c.id} value={c.id}>{c.platform}: {c.name}{c.expired ? " (reconnect)" : ""}</option>)}
            </select>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ width: 220 }} />
          </div>
          {ch && !allowed.includes(props.format) && <div className="alert warn">{FORMAT_LABELS[props.format]} {isCarousel ? "carousels" : "posts"} cannot go to {ch.platform}. Pick: {allowed.map((f) => FORMAT_LABELS[f]).join(", ")}.</div>}
          <button className="primary" disabled={!props.canPublish || pending || !ch || !allowed.includes(props.format)} onClick={() => run(() => schedulePublication(props.projectId, props.post.id, channelId, props.format, when ? new Date(when).toISOString() : undefined))}>
            {when ? "Schedule" : "Publish now"} ({FORMAT_LABELS[props.format]})
          </button>
        </>
      )}
      {props.publications.length > 0 && (
        <table>
          <tbody>
            {props.publications.map((p) => (
              <tr key={p.id}>
                <td>{props.channels.find((c) => c.id === p.channelId)?.name ?? "removed account"}</td>
                <td>{FORMAT_LABELS[p.format as FormatId]}</td>
                <td>{new Date(p.scheduledAt).toLocaleString()}</td>
                <td>
                  <span className={`badge ${p.status === "published" ? "ok" : p.status === "failed" ? "err" : ""}`}>{p.status}</span>
                  {p.url && <> <a href={p.url} target="_blank" rel="noreferrer">view</a></>}
                  {p.error && <div className="small" style={{ color: "var(--err)" }}>{p.error}</div>}
                </td>
                <td>{p.status === "scheduled" && <button className="danger" onClick={() => run(() => cancelPublication(props.projectId, p.id))}>Cancel</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
