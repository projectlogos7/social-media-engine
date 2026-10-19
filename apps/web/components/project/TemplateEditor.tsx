"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormatId, Slot, SlotValues, TemplateSpec } from "@sme/core";
import { saveTemplate, setGolden } from "@/app/actions";
import { ErrorBox, FORMAT_LABELS, FormatChecks, Issues, useAction } from "@/components/ui";
import type { DsSummary } from "@/lib/ds";
import { LivePreview } from "./Composer";
import { SlotForm } from "./SlotForm";

const EMPTY_SLOT: Slot = { name: "new_slot", label: "New slot", type: "text", description: "", required: true, maxChars: 80, maxLines: 2 };

function SlotsEditor({ slots, onChange, disabled }: { slots: Slot[]; onChange: (s: Slot[]) => void; disabled: boolean }) {
  const set = (i: number, patch: Partial<Slot>) => onChange(slots.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const num = (v: string) => (v === "" ? undefined : Math.max(1, Number(v)));
  return (
    <div className="stack">
      <table>
        <thead><tr><th>Name</th><th>Label</th><th>Type</th><th>Max chars</th><th>Max lines</th><th>Req.</th><th></th></tr></thead>
        <tbody>
          {slots.map((s, i) => (
            <tr key={i}>
              <td><input className="mono" value={s.name} disabled={disabled} onChange={(e) => set(i, { name: e.target.value })} /></td>
              <td><input value={s.label} disabled={disabled} onChange={(e) => set(i, { label: e.target.value })} /></td>
              <td>
                <select value={s.type} disabled={disabled} onChange={(e) => set(i, { type: e.target.value as Slot["type"] })}>
                  {["text", "image", "list", "choice"].map((t) => <option key={t}>{t}</option>)}
                </select>
              </td>
              <td><input type="number" value={s.maxChars ?? ""} disabled={disabled || s.type === "image"} onChange={(e) => set(i, { maxChars: num(e.target.value) })} style={{ width: 80 }} /></td>
              <td><input type="number" value={s.maxLines ?? ""} disabled={disabled || s.type === "image"} onChange={(e) => set(i, { maxLines: num(e.target.value) })} style={{ width: 70 }} /></td>
              <td><input type="checkbox" checked={s.required} disabled={disabled} onChange={(e) => set(i, { required: e.target.checked })} style={{ width: "auto" }} /></td>
              <td><button disabled={disabled} className="danger" onClick={() => onChange(slots.filter((_, k) => k !== i))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {slots.map((s, i) => (
        <div key={`d${i}`} className="row" style={{ flexWrap: "nowrap" }}>
          <span className="mono" style={{ width: 120 }}>{s.name}</span>
          <input placeholder="Guidance for the copywriter / art director" value={s.description} disabled={disabled} onChange={(e) => set(i, { description: e.target.value })} />
          {s.type === "choice" && <input placeholder="Options, comma separated" value={(s.options ?? []).join(", ")} disabled={disabled} onChange={(e) => set(i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />}
        </div>
      ))}
      <div><button disabled={disabled} onClick={() => onChange([...slots, { ...EMPTY_SLOT, name: `slot_${slots.length + 1}` }])}>Add slot</button></div>
    </div>
  );
}

export function TemplateEditor(props: {
  projectId: string;
  ds: DsSummary;
  templateId?: string;
  initial: TemplateSpec;
  current?: { versionId: string; version: number; golden: string[] };
  versions?: { id: string; version: number; note: string; createdAt: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [spec, setSpec] = useState<TemplateSpec>(props.initial);
  const [tab, setTab] = useState<"layout" | "slots" | "sample" | "reference">("layout");
  const [format, setFormat] = useState<FormatId>(props.initial.formats[0]);
  const [note, setNote] = useState("");
  const [warnings, setWarnings] = useState<{ severity: "error" | "warning"; message: string; code: "lint" }[]>([]);
  const [compare, setCompare] = useState<{ format: string; ratio: number; before: string; after: string; diff: string }[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const { pending, error, run } = useAction();
  const set = (patch: Partial<TemplateSpec>) => setSpec({ ...spec, ...patch });
  const dirty = JSON.stringify(spec) !== JSON.stringify(props.initial);
  const ro = !props.canEdit;

  const doCompare = async () => {
    if (!props.current) return;
    setComparing(true);
    const r = await fetch("/api/templates/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ versionId: props.current.versionId, spec }) });
    setComparing(false);
    const j = await r.json();
    if (r.ok) setCompare(j.results);
  };

  return (
    <div className="stack">
      <ErrorBox error={error} />
      <div className="cols">
        <div className="card stack">
          <div className="row">
            <input value={spec.name} onChange={(e) => set({ name: e.target.value })} disabled={ro} style={{ flex: 2, fontWeight: 600 }} />
            <select value={spec.role} onChange={(e) => set({ role: e.target.value as TemplateSpec["role"] })} disabled={ro} style={{ flex: 1 }}>
              <option value="single">Single post</option><option value="cover">Carousel cover</option><option value="content">Carousel page</option><option value="end">Carousel end</option>
            </select>
            <select value={spec.theme} onChange={(e) => set({ theme: e.target.value })} disabled={ro} style={{ flex: 1 }}>
              <option value="">Theme: {props.ds.themes[0]} (default)</option>
              {props.ds.themes.map((t) => <option key={t} value={t}>Theme: {t}</option>)}
            </select>
          </div>
          <textarea value={spec.description} onChange={(e) => set({ description: e.target.value })} disabled={ro} rows={2} placeholder="When to use this template (Claude reads this when choosing)" style={{ minHeight: 50 }} />
          <FormatChecks value={spec.formats} onChange={(f) => { set({ formats: f }); if (f[0] && !f.includes(format)) setFormat(f[0]); }} />
          <div className="tabs">
            {(["layout", "slots", "sample", "reference"] as const).map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "layout" ? "HTML & CSS" : t === "slots" ? `Slots (${spec.slots.length})` : t === "sample" ? "Sample values" : "Tokens & assets"}</button>)}
          </div>
          {tab === "layout" && (
            <>
              <label>HTML <span className="hint">Handlebars. Mark text with data-slot="name", logos with data-role="logo". Helpers: {"{{asset \"Group/file.svg\"}}"}, {"{{image \"slot\"}}"}, {"{{focus \"slot\"}}"}, {"{{#if (eq format.id \"story\")}}"}</span></label>
              <textarea className="code" value={spec.html} onChange={(e) => set({ html: e.target.value })} disabled={ro} spellCheck={false} />
              <label>CSS <span className="hint">Only var(--token) colours and var(--font-*) families. The canvas has data-format="{format}".</span></label>
              <textarea className="code" value={spec.css} onChange={(e) => set({ css: e.target.value })} disabled={ro} spellCheck={false} />
            </>
          )}
          {tab === "slots" && <SlotsEditor slots={spec.slots} onChange={(slots) => set({ slots })} disabled={ro} />}
          {tab === "sample" && <SlotForm slots={spec.slots} values={spec.sample as SlotValues} onChange={(sample) => set({ sample })} library={[]} projectId={props.projectId} />}
          {tab === "reference" && (
            <div className="stack small">
              <div><b>Colours</b> ({props.ds.name} v{props.ds.version})</div>
              <table><tbody>{props.ds.colors.map((c) => <tr key={c.name}><td>{c.value.startsWith("#") && <span style={{ display: "inline-block", width: 14, height: 14, background: c.value, borderRadius: 3, verticalAlign: "middle", marginRight: 6 }} />}<span className="mono">var(--{c.name})</span></td><td className="muted">{c.usage}</td></tr>)}</tbody></table>
              <div><b>Fonts:</b> {props.ds.families.map((f) => <span key={f} className="mono" style={{ marginRight: 8 }}>var(--font-{f})</span>)}</div>
              {props.ds.spacing.length > 0 && <div><b>Spacing:</b> <span className="mono">{props.ds.spacing.join(" · ")}</span></div>}
              <div><b>Assets</b></div>
              {props.ds.assets.map((a) => <div key={a.path} className="mono">{`{{asset "${a.path}"}}`}</div>)}
            </div>
          )}
          {props.canEdit && (
            <div className="row">
              <input placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1 }} />
              <button
                className="primary"
                disabled={pending || (!dirty && !!props.templateId)}
                onClick={() =>
                  run(() => saveTemplate(props.projectId, spec, props.templateId, note), (d) => {
                    setWarnings(d.warnings as typeof warnings);
                    setNote("");
                    if (!props.templateId) router.push(`/p/${props.projectId}/templates/${d.templateId}`);
                  })
                }
              >
                {props.templateId ? `Save as v${(props.current?.version ?? 0) + 1}` : "Create template"}
              </button>
            </div>
          )}
          <Issues issues={warnings} />
        </div>
        <div className="stack">
          <div className="card stack">
            <div className="row">{spec.formats.map((f) => <button key={f} className={format === f ? "primary" : ""} onClick={() => setFormat(f)}>{FORMAT_LABELS[f]}</button>)}</div>
            {spec.formats.length > 0 && <LivePreview projectId={props.projectId} spec={spec} format={spec.formats.includes(format) ? format : spec.formats[0]} slots={spec.sample as SlotValues} />}
          </div>
          {props.current && (
            <div className="card stack">
              <h3>Golden snapshots</h3>
              <p className="small muted">The approved look of v{props.current.version} for each format. Compare edits (or a new design system) against it before saving.</p>
              <div className="row">
                {props.canEdit && <button disabled={pending} onClick={() => run(() => setGolden(props.projectId, props.current!.versionId))}>{props.current.golden.length ? "Re-approve snapshots" : "Approve snapshots"}</button>}
                <button disabled={comparing || !props.current.golden.length} onClick={doCompare}>{comparing ? "Comparing…" : "Compare current edit"}</button>
              </div>
              {compare?.map((c) => (
                <div key={c.format} className="stack">
                  <div className="row spread small"><b>{FORMAT_LABELS[c.format as FormatId]}</b><span className={`badge ${c.ratio === 0 ? "ok" : c.ratio < 0.01 ? "warn" : "err"}`}>{(c.ratio * 100).toFixed(2)}% of pixels changed</span></div>
                  <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                    <figure style={{ margin: 0 }}><img className="preview" src={c.before} alt="" /><figcaption className="small muted">Approved</figcaption></figure>
                    <figure style={{ margin: 0 }}><img className="preview" src={c.after} alt="" /><figcaption className="small muted">Now</figcaption></figure>
                    <figure style={{ margin: 0 }}><img className="preview" src={c.diff} alt="" /><figcaption className="small muted">Difference</figcaption></figure>
                  </div>
                </div>
              ))}
            </div>
          )}
          {props.versions && props.versions.length > 1 && (
            <div className="card stack small">
              <h3>Versions</h3>
              {props.versions.map((v) => <div key={v.id}>v{v.version} · {new Date(v.createdAt).toLocaleString()} {v.note && `· ${v.note}`}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
