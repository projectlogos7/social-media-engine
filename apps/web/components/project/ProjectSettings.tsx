"use client";
import { useState } from "react";
import { ROLES, type ProjectSettings } from "@sme/core";
import { deleteProjectAction, setProjectRole, updateProject } from "@/app/actions";
import { Confirm, ErrorBox, useAction } from "@/components/ui";

export function ProjectSettingsForm(props: {
  projectId: string;
  canManage: boolean;
  canMembers: boolean;
  name: string;
  handle: string;
  settings: ProjectSettings;
  providers: { id: string; label: string; models: string[]; supportsSeed: boolean; supportsReferences: boolean }[];
  library: { id: string; name: string }[];
  members: { userId: string; name: string; email: string; role: string; projectRole: string | null }[];
}) {
  const { pending, error, run } = useAction();
  const [name, setName] = useState(props.name);
  const [handle, setHandle] = useState(props.handle);
  const [img, setImg] = useState(props.settings.imagery);
  const [voice, setVoice] = useState(props.settings.voice);
  const [copyModel, setCopyModel] = useState(props.settings.copyModel);
  const [saved, setSaved] = useState(false);
  const prov = props.providers.find((p) => p.id === img.provider);
  const ro = !props.canManage;
  return (
    <div className="stack">
      <ErrorBox error={error} />
      {saved && <div className="alert ok">Saved.</div>}
      <div className="cols">
        <div className="card stack">
          <h2>Project</h2>
          <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} disabled={ro} /></div>
          <div className="field"><label>Handle</label><input value={handle} onChange={(e) => setHandle(e.target.value)} disabled={ro} /></div>
          <h2 style={{ marginTop: 16 }}>Voice</h2>
          <p className="small muted">The design system's brand book and voice section always apply. These add to them and are checked automatically.</p>
          <div className="field"><label>Never use these words <span className="hint">comma separated</span></label><input value={voice.bannedWords.join(", ")} onChange={(e) => setVoice({ ...voice, bannedWords: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} disabled={ro} /></div>
          <div className="field"><label>Extra voice instructions</label><textarea value={voice.extra} onChange={(e) => setVoice({ ...voice, extra: e.target.value })} disabled={ro} rows={3} /></div>
          <div className="row">
            <div className="field" style={{ flex: 2 }}><label>Preferred hashtags</label><input value={voice.hashtags.join(" ")} onChange={(e) => setVoice({ ...voice, hashtags: e.target.value.split(/\s+/).filter(Boolean) })} disabled={ro} /></div>
            <div className="field" style={{ flex: 1 }}><label>Max hashtags</label><input type="number" value={voice.maxHashtags} onChange={(e) => setVoice({ ...voice, maxHashtags: Number(e.target.value) })} disabled={ro} /></div>
            <div className="field" style={{ flex: 1 }}><label>Language</label><input value={voice.language} onChange={(e) => setVoice({ ...voice, language: e.target.value })} disabled={ro} /></div>
          </div>
          <div className="field"><label>Copy model</label><select value={copyModel} onChange={(e) => setCopyModel(e.target.value)} disabled={ro}>{["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"].map((m) => <option key={m}>{m}</option>)}</select></div>
        </div>
        <div className="card stack">
          <h2>Imagery</h2>
          <p className="small muted">Every generated image uses this style, a stored seed and the same provider, so results stay consistent and can be reproduced.</p>
          <div className="row">
            <div className="field" style={{ flex: 1 }}><label>Provider</label><select value={img.provider} onChange={(e) => setImg({ ...img, provider: e.target.value, model: "" })} disabled={ro}>{props.providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
            <div className="field" style={{ flex: 1 }}><label>Model</label><select value={img.model} onChange={(e) => setImg({ ...img, model: e.target.value })} disabled={ro}><option value="">Default</option>{prov?.models.map((m) => <option key={m}>{m}</option>)}</select></div>
          </div>
          {prov && <div className="small muted">{prov.supportsSeed ? "Seeds supported: same seed, same image." : "This provider ignores seeds; prompts are still stored."} {prov.supportsReferences ? "Uses reference images." : "Reference images not supported."}</div>}
          <div className="field"><label>Style prompt <span className="hint">added to every image prompt</span></label><textarea value={img.stylePrompt} onChange={(e) => setImg({ ...img, stylePrompt: e.target.value })} disabled={ro} rows={3} /></div>
          <div className="field"><label>Avoid</label><input value={img.negativePrompt} onChange={(e) => setImg({ ...img, negativePrompt: e.target.value })} disabled={ro} /></div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}><label>Candidates per image</label><input type="number" min={1} max={8} value={img.candidates} onChange={(e) => setImg({ ...img, candidates: Number(e.target.value) })} disabled={ro} /></div>
            <div className="field" style={{ flex: 1 }}><label>Palette tolerance</label><input type="number" value={img.paletteTolerance} onChange={(e) => setImg({ ...img, paletteTolerance: Number(e.target.value) })} disabled={ro} /></div>
          </div>
          <div className="field">
            <label>Reference images <span className="hint">from the library</span></label>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))", gap: 6, maxHeight: 220, overflow: "auto" }}>
              {props.library.map((a) => (
                <button key={a.id} type="button" disabled={ro} className={`pick ${img.referenceAssetIds.includes(a.id) ? "on" : ""}`} onClick={() => setImg({ ...img, referenceAssetIds: img.referenceAssetIds.includes(a.id) ? img.referenceAssetIds.filter((x) => x !== a.id) : [...img.referenceAssetIds, a.id] })}>
                  <img className="thumb cover" src={`/api/assets/${a.id}`} alt={a.name} loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {props.canManage && (
        <div className="row">
          <button className="primary" disabled={pending} onClick={() => run(() => updateProject(props.projectId, { name, handle, settings: { imagery: img, voice, copyModel } }), () => setSaved(true))}>Save settings</button>
        </div>
      )}
      {props.canMembers && (
        <div className="card stack">
          <h2>Access to this project</h2>
          <p className="small muted">Narrow someone's workspace role for this project only (it can never be raised above their workspace role).</p>
          <table>
            <thead><tr><th>Member</th><th>Workspace role</th><th>On this project</th></tr></thead>
            <tbody>
              {props.members.map((m) => (
                <tr key={m.userId}>
                  <td>{m.name} <span className="small muted">{m.email}</span></td>
                  <td>{m.role}</td>
                  <td>
                    <select value={m.projectRole ?? ""} onChange={(e) => run(() => setProjectRole(props.projectId, m.userId, e.target.value || null))} style={{ width: 180 }}>
                      <option value="">Same as workspace</option>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {props.canManage && <div><Confirm label="Delete project" onConfirm={() => run(() => deleteProjectAction(props.projectId))} /></div>}
    </div>
  );
}
