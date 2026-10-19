export interface Robots {
  allowed(path: string): boolean;
  sitemaps: string[];
  crawlDelayMs: number;
}

/** Minimal robots.txt: groups for our agent or "*", longest-match Allow/Disallow, Sitemap lines. */
export function parseRobots(text: string, agent: string): Robots {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const sitemaps: string[] = [];
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[]; delay?: number };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const line of lines) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "sitemap") {
      sitemaps.push(val);
      continue;
    }
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") {
      if (val) cur.rules.push({ allow: key === "allow", path: val });
    } else if (key === "crawl-delay") cur.delay = Number(val) * 1000;
  }
  const a = agent.toLowerCase();
  const group = groups.find((g) => g.agents.some((x) => x !== "*" && a.includes(x))) ?? groups.find((g) => g.agents.includes("*"));
  const rules = group?.rules ?? [];
  const toRe = (p: string) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  return {
    sitemaps,
    crawlDelayMs: Math.min(group?.delay ?? 0, 10_000),
    allowed(path: string) {
      let best: { allow: boolean; len: number } | null = null;
      for (const r of rules) {
        if (toRe(r.path).test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
      }
      return best ? best.allow : true;
    },
  };
}
