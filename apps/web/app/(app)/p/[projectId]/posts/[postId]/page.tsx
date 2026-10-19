import { can, type QualityReport } from "@sme/core";
import { getDb } from "@sme/db";
import { getPost, listAssets, listChannels, publishingAvailability } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { PostEditor } from "@/components/project/PostEditor";

export default async function PostPage({ params }: { params: Promise<{ projectId: string; postId: string }> }) {
  const { projectId, postId } = await params;
  const s = await requireSession();
  const db = getDb();
  const [p, assets, channels] = await Promise.all([getPost(db, s.actor, postId), listAssets(db, s.actor, projectId, { approvedOnly: true }), listChannels(db, s.actor, projectId)]);
  const meta = (p.post.copyMeta ?? {}) as { model?: string; attempts?: number; problems?: string[]; candidates?: Record<string, string[]>; imagePrompts?: Record<string, string>; templateReason?: string };
  return (
    <PostEditor
      projectId={projectId}
      canEdit={can(p.role, "post.create")}
      canPublish={can(p.role, "post.publish")}
      post={{
        id: p.post.id, title: p.post.title, status: p.post.status, kind: p.post.kind, caption: p.post.caption, hashtags: p.post.hashtags as string[], altText: p.post.altText,
        sourceUrls: p.post.sourceUrls as string[], formats: p.post.formats as never, brief: p.post.brief, meta,
      }}
      pages={p.pages.map((pg) => ({
        id: pg.id, index: pg.index, slots: pg.slots, templateName: pg.template.name, templateVersion: pg.template.version, outdated: pg.template.currentVersionId !== pg.templateVersionId, spec: pg.template.spec,
        renders: Object.fromEntries(Object.entries(pg.renders).map(([f, r]) => [f, r ? { id: r.id, passed: r.passed, report: r.report as QualityReport, recipe: r.recipe, hash: r.recipeHash, createdAt: r.createdAt.toISOString() } : null])),
      }))}
      library={assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind }))}
      channels={channels.map((c) => ({ id: c.id, name: c.name, platform: c.platform, expired: c.expired }))}
      publications={p.publications.map((x) => ({ id: x.id, channelId: x.channelId, format: x.format, status: x.status, scheduledAt: x.scheduledAt.toISOString(), url: x.url, error: x.error }))}
      publishing={publishingAvailability()}
    />
  );
}
