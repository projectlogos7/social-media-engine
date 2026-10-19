"use client";
import { useState } from "react";
import type { ImageRef, Slot, SlotValues } from "@sme/core";

export interface LibraryImage {
  id: string;
  name: string;
  kind: string;
}

function ImagePicker({ value, onChange, library, projectId, onUploaded }: { value: ImageRef | null; onChange: (v: ImageRef | null) => void; library: LibraryImage[]; projectId: string; onUploaded?: (img: LibraryImage) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("projectId", projectId);
    for (const f of Array.from(files)) fd.append("files", f);
    const r = await fetch("/api/assets/upload", { method: "POST", body: fd });
    setBusy(false);
    const j = await r.json();
    if (!r.ok) return alert(j.error);
    const a = j.assets[0];
    onUploaded?.({ id: a.id, name: a.name, kind: "upload" });
    onChange({ kind: "image", assetId: a.id });
  };
  return (
    <div className="stack">
      <div className="row">
        {value ? <img src={`/api/assets/${value.assetId}`} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6 }} /> : <span className="small muted">No image</span>}
        <button type="button" onClick={() => setOpen(!open)}>{open ? "Close" : "Choose from library"}</button>
        <label className="btn" style={{ margin: 0 }}>
          {busy ? "Uploading…" : "Upload"}
          <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files)} />
        </label>
        {value && <button type="button" className="danger" onClick={() => onChange(null)}>Remove</button>}
      </div>
      {open && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))", gap: 6, maxHeight: 260, overflow: "auto" }}>
          {library.map((a) => (
            <button type="button" key={a.id} className={`pick ${value?.assetId === a.id ? "on" : ""}`} onClick={() => { onChange({ kind: "image", assetId: a.id }); setOpen(false); }} title={a.name}>
              <img src={`/api/assets/${a.id}`} alt="" className="thumb cover" loading="lazy" />
            </button>
          ))}
          {!library.length && <span className="small muted">The library is empty. Upload an image.</span>}
        </div>
      )}
    </div>
  );
}

export function SlotForm({ slots, values, onChange, library, projectId, onUploaded, issuesBySlot }: {
  slots: Slot[];
  values: SlotValues;
  onChange: (v: SlotValues) => void;
  library: LibraryImage[];
  projectId: string;
  onUploaded?: (img: LibraryImage) => void;
  issuesBySlot?: Record<string, string[]>;
}) {
  const set = (name: string, v: SlotValues[string]) => onChange({ ...values, [name]: v });
  return (
    <div className="stack">
      {slots.map((s) => {
        const v = values[s.name];
        const text = typeof v === "string" ? v : Array.isArray(v) ? v.join("\n") : "";
        const over = s.maxChars && text.length > s.maxChars;
        const problems = issuesBySlot?.[s.name] ?? [];
        return (
          <div className="field" key={s.name}>
            <label>
              {s.label} {!s.required && <span className="hint">optional</span>}
              {s.type !== "image" && s.maxChars ? <span className="hint" style={{ float: "right", color: over ? "var(--err)" : undefined }}>{text.length}/{s.maxChars}</span> : null}
            </label>
            {s.description && <div className="hint" style={{ marginBottom: 4 }}>{s.description}</div>}
            {s.type === "image" ? (
              <ImagePicker value={(v as ImageRef) ?? null} onChange={(x) => set(s.name, x)} library={library} projectId={projectId} onUploaded={onUploaded} />
            ) : s.type === "choice" ? (
              <select value={text} onChange={(e) => set(s.name, e.target.value)}>
                <option value="">Choose…</option>
                {s.options?.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : s.type === "list" ? (
              <textarea value={text} onChange={(e) => set(s.name, e.target.value.split("\n"))} placeholder="One item per line" />
            ) : (s.maxChars ?? 0) > 90 || (s.maxLines ?? 1) > 2 ? (
              <textarea value={text} onChange={(e) => set(s.name, e.target.value)} rows={3} style={{ minHeight: 60 }} />
            ) : (
              <input value={text} onChange={(e) => set(s.name, e.target.value)} />
            )}
            {problems.map((p, i) => <div key={i} className="small" style={{ color: "var(--err)", marginTop: 4 }}>{p}</div>)}
          </div>
        );
      })}
    </div>
  );
}
