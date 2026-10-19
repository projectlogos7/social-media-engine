"use client";
import { useRouter } from "next/navigation";
import { JobStatus, useJob } from "@/components/ui";

function One({ id, summary }: { id: string; summary: string }) {
  const router = useRouter();
  const job = useJob(id, () => router.refresh());
  return (
    <div className="card row spread" style={{ padding: 10 }}>
      <span className="small">{summary}</span>
      <JobStatus job={job} />
    </div>
  );
}

export function RunningJobs({ jobs }: { jobs: { id: string; summary: string }[] }) {
  if (!jobs.length) return null;
  return <div className="stack">{jobs.map((j) => <One key={j.id} id={j.id} summary={j.summary} />)}</div>;
}
