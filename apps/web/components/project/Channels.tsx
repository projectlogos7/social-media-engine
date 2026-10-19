"use client";
import { deleteChannel } from "@/app/actions";
import { Confirm, ErrorBox, useAction } from "@/components/ui";

export function ChannelList({ projectId, channels, canManage }: { projectId: string; canManage: boolean; channels: { id: string; platform: string; name: string; expired: boolean; expiresAt: string | null }[] }) {
  const { error, run } = useAction();
  if (!channels.length) return <div className="small muted">No accounts connected.</div>;
  return (
    <>
      <ErrorBox error={error} />
      <table>
        <tbody>
          {channels.map((c) => (
            <tr key={c.id}>
              <td><span className="badge">{c.platform}</span> {c.name}</td>
              <td className="small">{c.expired ? <span className="badge err">expired, reconnect</span> : c.expiresAt ? `token valid until ${new Date(c.expiresAt).toLocaleDateString()}` : ""}</td>
              <td>{canManage && <Confirm label="Disconnect" onConfirm={() => run(() => deleteChannel(projectId, c.id))} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
