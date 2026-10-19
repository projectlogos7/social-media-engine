"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FormatId, QualityIssue } from "@sme/core";
import type { Result } from "@/lib/result";

export const FORMAT_LABELS: Record<FormatId, string> = {
  square: "Square 1080×1080",
  portrait: "Portrait 1080×1350",
  story: "Story 1080×1920",
  landscape: "LinkedIn 1200×627",
  youtube: "YouTube 1280×720",
};

/** Runs a server action, keeps pending/error state, refreshes the page on success. */
export function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const run = <T,>(fn: () => Promise<Result<T>>, onOk?: (data: T) => void, refresh = true) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error);
      onOk?.(r.data);
      if (refresh) router.refresh();
    });
  return { pending, error, setError, run };
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="alert err">{error}</div>;
}

export function Issues({ issues, empty }: { issues: QualityIssue[]; empty?: string }) {
  if (!issues.length) return empty ? <div className="alert ok">{empty}</div> : null;
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  return (
    <ul className="issues">
      {sorted.map((i, k) => (
        <li key={k} className={i.severity}>
          {i.severity === "error" ? "✕ " : "! "}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

export function PassBadge({ passed, count }: { passed: boolean | null | undefined; count?: number }) {
  if (passed === null || passed === undefined) return <span className="badge">not rendered</span>;
  return passed ? <span className="badge ok">passes checks</span> : <span className="badge err">{count ? `${count} problem${count > 1 ? "s" : ""}` : "fails checks"}</span>;
}

export function FormatChecks({ value, onChange, allowed }: { value: FormatId[]; onChange: (v: FormatId[]) => void; allowed?: FormatId[] }) {
  const all = (allowed ?? (Object.keys(FORMAT_LABELS) as FormatId[]));
  return (
    <div className="checks">
      {all.map((f) => (
        <label key={f}>
          <input type="checkbox" checked={value.includes(f)} onChange={(e) => onChange(e.target.checked ? [...value, f] : value.filter((x) => x !== f))} />
          {FORMAT_LABELS[f]}
        </label>
      ))}
    </div>
  );
}

export interface JobState {
  id: string;
  status: string;
  progress: string;
  error: string | null;
  result: unknown;
}

/** Polls a background job until it finishes. */
export function useJob(jobId: string | null, onDone?: (j: JobState) => void) {
  const [job, setJob] = useState<JobState | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/jobs/${jobId}`);
      if (!r.ok) return;
      const j = (await r.json()) as JobState;
      if (stop) return;
      setJob(j);
      if (j.status === "done" || j.status === "failed" || j.status === "cancelled") done.current?.(j);
      else setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [jobId]);
  return job;
}

export function JobStatus({ job }: { job: JobState | null }) {
  if (!job) return null;
  if (job.status === "failed") return <div className="alert err">Failed: {job.error}</div>;
  if (job.status === "done") return <div className="alert ok">Done.</div>;
  return (
    <div className="row small muted">
      <span className="spinner" /> {job.status === "queued" ? (job.error ? `Retrying: ${job.error}` : "Waiting for a worker…") : job.progress || "Working…"}
    </div>
  );
}

export function Confirm({ label, onConfirm, className, disabled }: { label: string; onConfirm: () => void; className?: string; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="row">
      <button className="danger" onClick={onConfirm} disabled={disabled}>
        Yes, {label.toLowerCase()}
      </button>
      <button onClick={() => setArmed(false)}>Cancel</button>
    </span>
  ) : (
    <button className={className ?? "danger"} onClick={() => setArmed(true)} disabled={disabled}>
      {label}
    </button>
  );
}
