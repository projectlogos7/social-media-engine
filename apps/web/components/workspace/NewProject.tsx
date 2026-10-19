"use client";
import { useState } from "react";
import { createProjectAction } from "@/app/actions";
import { ErrorBox, useAction } from "@/components/ui";

export function NewProject() {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const { pending, error, run } = useAction();
  return (
    <div className="card stack">
      <h2>New project</h2>
      <ErrorBox error={error} />
      <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nous Podcast" /></div>
      <div className="field"><label>Handle <span className="hint">optional, e.g. @nous</span></label><input value={handle} onChange={(e) => setHandle(e.target.value)} /></div>
      <button className="primary" disabled={pending || !name.trim()} onClick={() => run(() => createProjectAction(name, handle))}>Create project</button>
    </div>
  );
}
