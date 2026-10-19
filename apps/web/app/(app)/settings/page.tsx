import { can } from "@sme/core";
import { getDb } from "@sme/db";
import { listMembers, listProviderKeys } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { Members, ProviderKeys } from "@/components/workspace/Settings";

export default async function SettingsPage() {
  const s = await requireSession();
  const [members, keys] = await Promise.all([listMembers(getDb(), s.actor), listProviderKeys(getDb(), s.actor)]);
  return (
    <div className="stack">
      <div className="header"><div><h1>{s.workspace.name}</h1><p className="muted">Members, roles and API keys for this workspace.</p></div></div>
      <Members
        members={members.members.map((m) => ({ ...m, since: m.since.toISOString() }))}
        pending={members.pending.map((p) => ({ ...p, expiresAt: p.expiresAt.toISOString() }))}
        canManage={can(s.role, "members.manage")}
        me={s.user.id}
        myRole={s.role}
      />
      <ProviderKeys keys={keys} canManage={can(s.role, "keys.manage")} />
    </div>
  );
}
