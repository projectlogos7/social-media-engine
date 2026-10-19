"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  ["", "Posts"],
  ["/create", "Create"],
  ["/batch", "Batch"],
  ["/templates", "Templates"],
  ["/design", "Design system"],
  ["/library", "Library"],
  ["/website", "Website"],
  ["/publish", "Publishing"],
  ["/settings", "Settings"],
] as const;

export function ProjectTabs({ projectId, hasDs }: { projectId: string; hasDs: boolean }) {
  const path = usePathname();
  const base = `/p/${projectId}`;
  return (
    <>
      <nav className="tabs">
        {TABS.map(([href, label]) => {
          const full = base + href;
          const on = href === "" ? path === base || path.startsWith(`${base}/posts`) : path.startsWith(full);
          return <Link key={href} href={full} className={on ? "on" : ""}>{label}</Link>;
        })}
      </nav>
      {!hasDs && !path.startsWith(`${base}/design`) && (
        <div className="alert warn" style={{ marginBottom: 16 }}>
          This project has no published design system yet. <Link href={`${base}/design`}>Import your Claude design system</Link> to start.
        </div>
      )}
    </>
  );
}
