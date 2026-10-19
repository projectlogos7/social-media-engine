import { can, type TokensFile } from "@sme/core";
import { allTypeStyles, deriveBrandRules, resolveColor, themeIds } from "@sme/design";
import { getDb } from "@sme/db";
import { getDesignSystemVersion, getProject, listDesignSystemVersions, listPosts } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { DsImport, DsVersions, DsCompare } from "@/components/project/DesignSystem";

export default async function DesignPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ v?: string }> }) {
  const { projectId } = await params;
  const { v: viewId } = await searchParams;
  const s = await requireSession();
  const db = getDb();
  const p = await getProject(db, s.actor, projectId);
  const versions = await listDesignSystemVersions(db, s.actor, projectId);
  const manage = can(p.role, "designsystem.manage");
  const shownId = viewId ?? p.currentDesignSystemVersionId ?? versions[0]?.id;
  const v = shownId ? await getDesignSystemVersion(db, s.actor, shownId) : null;
  const posts = await listPosts(db, s.actor, projectId, { limit: 100 });
  const tokens = (v?.tokens ?? {}) as TokensFile;
  const themes = v ? themeIds(tokens) : [];
  const rules = v ? deriveBrandRules(tokens) : null;
  const fontUrl = (path: string) => `/api/ds/${v!.id}/file?path=${encodeURIComponent(path)}`;
  const fontFaces = (tokens.type?.fonts ?? []).map((f) => `@font-face{font-family:"${f.family}";src:url("${fontUrl(f.file.includes("/") ? f.file : `fonts/${f.file}`)}");font-weight:${f.weight ?? "400"};font-style:${f.style ?? "normal"}}`).join("");
  const families = tokens.type?.families ?? {};
  return (
    <div className="stack">
      {manage && <DsImport projectId={projectId} hasCurrent={!!p.currentDesignSystemVersionId} />}
      <DsVersions projectId={projectId} manage={manage} currentId={p.currentDesignSystemVersionId} shownId={shownId ?? null} versions={versions.map((x) => ({ ...x, warnings: x.warnings as string[], createdAt: x.createdAt.toISOString(), publishedAt: x.publishedAt?.toISOString() ?? null }))} />
      {v && (
        <>
          <style dangerouslySetInnerHTML={{ __html: fontFaces }} />
          <div className="card stack">
            <h2>{v.name} · v{v.version} {v.id === p.currentDesignSystemVersionId ? <span className="badge ok">in use</span> : <span className="badge">{v.status}</span>}</h2>
            {(v.warnings as string[]).length > 0 && <div className="alert warn">Import notes:{"\n"}{(v.warnings as string[]).map((w) => `• ${w}`).join("\n")}</div>}
            <h3>Colours</h3>
            {themes.map((t) => (
              <div key={t} className="stack">
                <div className="small muted">Theme: {t}</div>
                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
                  {(tokens.color?.tokens ?? []).map((c) => {
                    const val = resolveColor(tokens, c.name, t);
                    return (
                      <div key={c.name} title={c.usage}>
                        <div className="swatch" style={{ background: val ?? "transparent" }} />
                        <div className="small mono">{c.name}</div>
                        <div className="small muted">{val}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <h3>Type</h3>
            <div className="stack">
              {allTypeStyles(tokens).map((st) => {
                const fam = st.family ? families[st.family] : undefined;
                return (
                  <div key={st.name} className="row" style={{ alignItems: "baseline", flexWrap: "nowrap" }}>
                    <span className="mono small" style={{ width: 120, flex: "none" }}>{st.name}</span>
                    <span style={{ fontFamily: fam, fontSize: st.fontSize, lineHeight: typeof st.lineHeight === "number" && st.lineHeight < 10 ? st.lineHeight : st.lineHeight, fontWeight: Number(String(st.fontWeight ?? 400).split(" ")[0]), fontStyle: st.fontStyle, letterSpacing: st.letterSpacing as string, textTransform: st.name === "label" ? "uppercase" : undefined }}>{st.sample ?? "The quick brown fox"}</span>
                  </div>
                );
              })}
            </div>
            {rules && (rules.neverText.length + rules.minTextPx.length + rules.forbiddenPairs.length > 0) && (
              <>
                <h3>Rules the engine enforces</h3>
                <ul className="small">
                  {rules.neverText.map((r) => <li key={r.token}><b>{r.token}</b> never sets text.</li>)}
                  {rules.minTextPx.map((r) => <li key={r.token}><b>{r.token}</b> sets text only at {r.px}px and up.</li>)}
                  {rules.forbiddenPairs.map((r) => <li key={r.fg + r.bg}><b>{r.fg}</b> text never sits on <b>{r.bg}</b>.</li>)}
                  <li>All text meets WCAG contrast (4.5:1, or 3:1 at 24px+), measured on the actual pixels behind it.</li>
                </ul>
              </>
            )}
            <h3>Assets</h3>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {v.files.filter((f) => f.kind === "asset").map((f) => (
                <div key={f.id}>
                  {f.contentType.startsWith("image/") ? <img className="thumb checker" src={fontUrl(f.path)} alt="" loading="lazy" /> : <div className="thumb" />}
                  <div className="small mono" style={{ wordBreak: "break-all" }}>{f.path.replace(/^assets\//, "")}</div>
                </div>
              ))}
            </div>
            <h3>Brand book</h3>
            <details><summary>README</summary><div className="small" style={{ whiteSpace: "pre-wrap" }}>{v.readme}</div></details>
            {(v.sections as { title: string; markdown: string }[]).map((sec) => (
              <details key={sec.title}><summary>{sec.title}</summary><div className="small" style={{ whiteSpace: "pre-wrap" }}>{sec.markdown}</div></details>
            ))}
          </div>
          {manage && v.id !== p.currentDesignSystemVersionId && (
            <DsCompare projectId={projectId} versionId={v.id} version={v.version} posts={posts.map((x) => ({ id: x.id, title: x.title, thumb: x.thumbnailRenderId }))} />
          )}
        </>
      )}
    </div>
  );
}
