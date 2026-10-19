"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { FormatId } from "@sme/core";
import { archiveTemplate, createStarterKit, templateFromComponent } from "@/app/actions";
import { ErrorBox, FORMAT_LABELS, useAction } from "@/components/ui";
import type { DsSummary } from "@/lib/ds";

export function TemplateCardActions({ projectId, templateId, archived }: { projectId: string; templateId: string; archived: boolean }) {
  const { pending, run } = useAction();
  return (
    <div className="row" style={{ marginTop: 8 }}>
      <Link className="btn" href={`/p/${projectId}/templates/${templateId}`}>Edit</Link>
      <Link className="btn" href={`/p/${projectId}/create?template=${templateId}`}>Use</Link>
      <button disabled={pending} onClick={() => run(() => archiveTemplate(projectId, templateId, !archived))}>{archived ? "Restore" : "Archive"}</button>
    </div>
  );
}

export function NewTemplate({ projectId, ds }: { projectId: string; ds: DsSummary }) {
  const router = useRouter();
  const { pending, error, run } = useAction();
  const [format, setFormat] = useState<FormatId>("square");
  const pick = (re: RegExp, fallback = "") => ds.colors.find((c) => re.test(c.name))?.name ?? fallback;
  const [choice, setChoice] = useState({
    ground: pick(/^(ground|background|bg|surface)/, ds.colors[0]?.name),
    text: pick(/^(text|ink|foreground|fg)/, ds.colors[1]?.name),
    accent: pick(/^(brand|accent|primary)/, ds.colors[2]?.name),
    headingFamily: ds.families.find((f) => /serif|display|heading/.test(f)) ?? ds.families[0] ?? "",
    bodyFamily: ds.families.find((f) => /sans|body|text/.test(f)) ?? ds.families[0] ?? "",
    logo: ds.assets.find((a) => /lockup|logo/i.test(a.path) && a.contentType.startsWith("image/"))?.path ?? "",
  });
  return (
    <div className="stack">
      <ErrorBox error={error} />
      <div className="cols">
        <div className="card stack">
          <h2>From a design-system showcase</h2>
          <p className="small muted">Turns a component preview from your Claude design system into a template: its text becomes slots, its assets stay linked, and it is scaled to the format.</p>
          <div className="field"><label>Format</label><select value={format} onChange={(e) => setFormat(e.target.value as FormatId)}>{(Object.keys(FORMAT_LABELS) as FormatId[]).map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}</select></div>
          {ds.components.map((c) => (
            <div key={c} className="row spread"><span>{c}</span><button disabled={pending} onClick={() => run(() => templateFromComponent(projectId, c, format), (id) => router.push(`/p/${projectId}/templates/${id}`), false)}>Convert</button></div>
          ))}
          {!ds.components.length && <p className="small muted">This design system has no component previews.</p>}
          <hr style={{ border: 0, borderTop: "1px solid var(--line)", width: "100%" }} />
          <h2>Blank template</h2>
          <p className="small muted">Write HTML and CSS using your tokens.</p>
          <Link className="btn" href={`/p/${projectId}/templates/new?blank=1`}>Start blank</Link>
        </div>
        <div className="card stack">
          <h2>Starter kit</h2>
          <p className="small muted">Eight ready layouts (headline, quote, photo, stat, carousel cover/page/end, YouTube thumbnail) bound to tokens you choose.</p>
          {([["ground", "Background colour"], ["text", "Text colour"], ["accent", "Accent colour"]] as const).map(([k, label]) => (
            <div className="field" key={k}><label>{label}</label>
              <select value={choice[k]} onChange={(e) => setChoice({ ...choice, [k]: e.target.value })}>{ds.colors.map((c) => <option key={c.name} value={c.name}>{c.name} {c.value.startsWith("#") ? c.value : ""}</option>)}</select>
            </div>
          ))}
          {([["headingFamily", "Heading font"], ["bodyFamily", "Body font"]] as const).map(([k, label]) => (
            <div className="field" key={k}><label>{label}</label><select value={choice[k]} onChange={(e) => setChoice({ ...choice, [k]: e.target.value })}>{ds.families.map((f) => <option key={f}>{f}</option>)}</select></div>
          ))}
          <div className="field"><label>Logo</label><select value={choice.logo} onChange={(e) => setChoice({ ...choice, logo: e.target.value })}><option value="">No logo</option>{ds.assets.filter((a) => a.contentType.startsWith("image/")).map((a) => <option key={a.path} value={a.path}>{a.path}</option>)}</select></div>
          <button className="primary" disabled={pending} onClick={() => run(() => createStarterKit(projectId, { ...choice, logo: choice.logo || undefined }), () => router.push(`/p/${projectId}/templates`), false)}>Create starter kit</button>
        </div>
      </div>
    </div>
  );
}
