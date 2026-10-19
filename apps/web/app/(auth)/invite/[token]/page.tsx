import { getDb } from "@sme/db";
import { getInvite } from "@sme/engine";
import { InviteForm } from "@/components/auth/AuthForms";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await getInvite(getDb(), token);
  const s = await currentSession();
  if (!inv) return <div className="auth"><div className="card"><h1>Invite not valid</h1><p className="muted">This invite link has expired or was already used. Ask for a new one.</p></div></div>;
  return <div className="auth"><InviteForm token={token} email={inv.email} workspace={inv.workspaceName} role={inv.role} signedInAs={s?.user.email} /></div>;
}
