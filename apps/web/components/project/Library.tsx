"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteAsset, setAssetApproved } from "@/app/actions";
import { Confirm, ErrorBox, useAction } from "@/components/ui";

export function UploadButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const fd = new FormData();
    fd.set("projectId", projectId);
    for (const f of Array.from(files)) fd.append("files", f);
    const r = await fetch("/api/assets/upload", { method: "POST", body: fd });
    setBusy(false);
    if (!r.ok) return setErr((await r.json()).error);
    router.push(`/p/${projectId}/library?tab=upload`);
    router.refresh();
  };
  return (
    <span className="row">
      {err && <span className="small" style={{ color: "var(--err)" }}>{err}</span>}
      <label className="btn primary" style={{ margin: 0 }}>{busy ? "Uploading…" : "Upload images"}<input type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} /></label>
    </span>
  );
}

export function LibraryGrid({ projectId, assets, canEdit }: { projectId: string; canEdit: boolean; assets: { id: string; name: string; kind: string; approved: boolean; width: number | null; height: number | null; paletteDistance: number | null; prompt: { prompt?: string; seed?: number; provider?: string } | null }[] }) {
  const { pending, error, run } = useAction();
  if (!assets.length) return <div className="card muted">Nothing here yet.</div>;
  return (
    <div className="stack">
      <ErrorBox error={error} />
      <p className="small muted">Approved images can be picked for posts. Generated images keep their prompt and seed so they can be made again.</p>
      <div className="grid">
        {assets.map((a) => (
          <div key={a.id} className="card" style={{ padding: 10 }}>
            <img className="thumb cover" src={`/api/assets/${a.id}`} alt="" loading="lazy" />
            <div className="small" style={{ marginTop: 6 }}>{a.name || "Untitled"}</div>
            <div className="small muted">{a.width}×{a.height}{a.paletteDistance !== null && ` · palette distance ${a.paletteDistance}`}</div>
            {a.prompt && <details className="small"><summary>Prompt · seed {a.prompt.seed} · {a.prompt.provider}</summary>{a.prompt.prompt}</details>}
            {canEdit && (
              <div className="row" style={{ marginTop: 6 }}>
                <button disabled={pending} onClick={() => run(() => setAssetApproved(projectId, a.id, !a.approved))}>{a.approved ? "✓ Approved" : "Approve"}</button>
                <Confirm label="Delete" onConfirm={() => run(() => deleteAsset(projectId, a.id))} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
