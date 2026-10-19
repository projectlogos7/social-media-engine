import Link from "next/link";
import { can } from "@sme/core";
import { getDb } from "@sme/db";
import { getProject, listChannels, listPublications, publishingAvailability } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { ChannelList } from "@/components/project/Channels";
import { FORMAT_LABELS } from "@/components/ui";

export default async function PublishPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ connected?: string }> }) {
  const { projectId } = await params;
  const { connected } = await searchParams;
  const s = await requireSession();
  const db = getDb();
  const [p, channels, pubs] = await Promise.all([getProject(db, s.actor, projectId), listChannels(db, s.actor, projectId), listPublications(db, s.actor, projectId)]);
  const avail = publishingAvailability();
  const manage = can(p.role, "channels.manage");
  return (
    <div className="stack">
      {connected && <div className="alert ok">Connected {connected} account{connected === "1" ? "" : "s"}.</div>}
      <div className="card stack">
        <h2>Accounts</h2>
        <p className="small muted">Posts publish only when they pass every check. Instagram needs a Business or Creator account linked to a Facebook Page; LinkedIn can post as you or as pages you administer. Carousels go to LinkedIn as PDF documents.</p>
        <ChannelList projectId={projectId} canManage={manage} channels={channels.map((c) => ({ id: c.id, platform: c.platform, name: c.name, expired: c.expired, expiresAt: c.expiresAt?.toISOString() ?? null }))} />
        {manage && (
          <div className="row">
            {avail.instagram ? <a className="btn primary" href={`/api/oauth/instagram/start?projectId=${projectId}`}>Connect Instagram</a> : <span className="badge">Instagram: set META_APP_ID and META_APP_SECRET on the server</span>}
            {avail.linkedin ? <a className="btn primary" href={`/api/oauth/linkedin/start?projectId=${projectId}`}>Connect LinkedIn</a> : <span className="badge">LinkedIn: set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET on the server</span>}
          </div>
        )}
      </div>
      <div className="card stack">
        <h2>Scheduled and published</h2>
        <table>
          <thead><tr><th>Post</th><th>Where</th><th>Format</th><th>When</th><th>Status</th></tr></thead>
          <tbody>
            {pubs.map(({ pub, title, channel, platform }) => (
              <tr key={pub.id}>
                <td><Link href={`/p/${projectId}/posts/${pub.postId}`}>{title}</Link></td>
                <td>{platform}: {channel}</td>
                <td>{FORMAT_LABELS[pub.format as keyof typeof FORMAT_LABELS]}</td>
                <td className="small">{pub.scheduledAt.toLocaleString()}</td>
                <td><span className={`badge ${pub.status === "published" ? "ok" : pub.status === "failed" ? "err" : ""}`}>{pub.status}</span>{pub.url && <> <a href={pub.url} target="_blank" rel="noreferrer">view</a></>}{pub.error && <div className="small" style={{ color: "var(--err)" }}>{pub.error}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pubs.length && <div className="small muted">Nothing scheduled. Publish from a post's page.</div>}
      </div>
    </div>
  );
}
