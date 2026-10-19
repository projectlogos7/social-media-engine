"use client";
import { useState } from "react";
import { ROLES } from "@sme/core";
import { inviteMember, removeMember, revokeInvite, setMemberRole, setProviderKey } from "@/app/actions";
import { Confirm, ErrorBox, useAction } from "@/components/ui";

const ROLE_HELP: Record<string, string> = {
  owner: "everything, including billing and owners",
  admin: "members, projects, websites, channels, API keys",
  designer: "design systems and templates, plus posts",
  editor: "create, export and publish posts",
  viewer: "browse and download",
};

export function Members(props: {
  members: { userId: string; email: string; name: string; role: string; since: string }[];
  pending: { id: string; email: string; role: string; expiresAt: string }[];
  canManage: boolean;
  me: string;
  myRole: string;
}) {
  const { pending, error, run } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="card stack">
      <h2>Members</h2>
      <ErrorBox error={error} />
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
        <tbody>
          {props.members.map((m) => (
            <tr key={m.userId}>
              <td>{m.name}{m.userId === props.me && <span className="badge" style={{ marginLeft: 6 }}>you</span>}</td>
              <td>{m.email}</td>
              <td>
                {props.canManage ? (
                  <select value={m.role} disabled={pending} onChange={(e) => run(() => setMemberRole(m.userId, e.target.value))} style={{ width: "auto" }}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : m.role}
              </td>
              <td>{props.canManage && m.userId !== props.me && <Confirm label="Remove" onConfirm={() => run(() => removeMember(m.userId))} disabled={pending} />}</td>
            </tr>
          ))}
          {props.pending.map((p) => (
            <tr key={p.id}>
              <td className="muted">Invited</td><td>{p.email}</td><td>{p.role}</td>
              <td>{props.canManage && <button className="danger" onClick={() => run(() => revokeInvite(p.id))}>Revoke</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.canManage && (
        <div className="stack">
          <h3>Invite someone</h3>
          <div className="row">
            <input style={{ flex: 2, minWidth: 220 }} placeholder="name@example.org" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select style={{ flex: 1, minWidth: 140 }} value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.filter((r) => r !== "owner" || props.myRole === "owner").map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button className="primary" disabled={pending || !email} onClick={() => run(() => inviteMember(email, role), (d) => { setLink(`${location.origin}/invite/${d.token}`); setEmail(""); })}>Create invite link</button>
          </div>
          <p className="small muted">{role}: {ROLE_HELP[role]}. Roles can be narrowed per project in each project's settings.</p>
          {link && <div className="alert ok">Send this link (valid 7 days, shown once):<br /><span className="mono">{link}</span></div>}
        </div>
      )}
    </div>
  );
}

export function ProviderKeys({ keys, canManage }: { keys: { id: string; label: string; hint: string | null; source: string | null }[]; canManage: boolean }) {
  const { pending, error, run } = useAction();
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className="card stack">
      <h2>API keys</h2>
      <p className="muted small">Stored encrypted. Claude writes the copy; image providers make pictures. The offline brand-pattern provider needs no key.</p>
      <ErrorBox error={error} />
      <table>
        <thead><tr><th>Provider</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>{k.label}</td>
              <td>{k.hint ? <span className="badge ok">{k.source === "env" ? "server default" : `set ${k.hint}`}</span> : <span className="badge">not set</span>}</td>
              <td>
                {canManage && (
                  <div className="row">
                    <input type="password" placeholder="Paste key" value={values[k.id] ?? ""} onChange={(e) => setValues({ ...values, [k.id]: e.target.value })} style={{ width: 260 }} />
                    <button disabled={pending || !values[k.id]} onClick={() => run(() => setProviderKey(k.id, values[k.id]), () => setValues({ ...values, [k.id]: "" }))}>Save</button>
                    {k.source === "workspace" && <button className="danger" disabled={pending} onClick={() => run(() => setProviderKey(k.id, ""))}>Remove</button>}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
