"use client";
import Link from "next/link";
import { useActionState } from "react";
import { acceptInviteAction, signInAction, signUpAction } from "@/app/actions";

function Err({ state }: { state: { ok: boolean; error?: string } | undefined }) {
  return state && !state.ok ? <div className="alert err">{state.error}</div> : null;
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signInAction, undefined);
  return (
    <form action={action} className="card stack">
      <h1>Sign in</h1>
      <Err state={state} />
      <input type="hidden" name="next" value={next ?? "/"} />
      <div className="field"><label>Email</label><input name="email" type="email" autoComplete="email" required /></div>
      <div className="field"><label>Password</label><input name="password" type="password" autoComplete="current-password" required /></div>
      <button className="primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      <p className="small muted">New here? <Link href="/signup">Create an account</Link></p>
    </form>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signUpAction, undefined);
  return (
    <form action={action} className="card stack">
      <h1>Create your workspace</h1>
      <Err state={state} />
      <div className="field"><label>Your name</label><input name="name" required /></div>
      <div className="field"><label>Email</label><input name="email" type="email" autoComplete="email" required /></div>
      <div className="field"><label>Password <span className="hint">at least 10 characters</span></label><input name="password" type="password" autoComplete="new-password" minLength={10} required /></div>
      <div className="field"><label>Workspace name</label><input name="workspace" placeholder="e.g. Nous" /></div>
      <button className="primary" disabled={pending}>{pending ? "Creating…" : "Create workspace"}</button>
      <p className="small muted">Have an account? <Link href="/login">Sign in</Link></p>
    </form>
  );
}

export function InviteForm({ token, email, workspace, role, signedInAs }: { token: string; email: string; workspace: string; role: string; signedInAs?: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, undefined);
  const same = signedInAs === email;
  return (
    <form action={action} className="card stack">
      <h1>Join {workspace}</h1>
      <p className="muted">You were invited as <b>{role}</b> with {email}.</p>
      <Err state={state} />
      <input type="hidden" name="token" value={token} />
      {!same && (
        <>
          <div className="field"><label>Your name <span className="hint">new accounts only</span></label><input name="name" /></div>
          <div className="field"><label>Password <span className="hint">choose one, or your existing password</span></label><input name="password" type="password" minLength={10} required /></div>
        </>
      )}
      <button className="primary" disabled={pending}>{pending ? "Joining…" : "Join workspace"}</button>
    </form>
  );
}
