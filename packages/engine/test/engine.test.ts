import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { rmSync } from "node:fs";
import { unzipSync } from "fflate";
import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = "postgres://sme:sme@127.0.0.1:5432/sme_test";
process.env.DATA_DIR = resolve(__dirname, "../../../test-output/engine-data");
process.env.APP_URL = "https://engine.test";

import { channels, closeDb, encrypt, getDb, jobs, posts, publications, renders, runMigrations, webPages } from "@sme/db";
import { importFromFiles, readDirectory } from "@sme/design";
import * as E from "../src";

const db = () => getDb();
let seeded: Awaited<ReturnType<typeof E.seed>> & { projectId: string; workspaceId: string; userId: string };
let owner: E.Actor;

beforeAll(async () => {
  rmSync(process.env.DATA_DIR!, { recursive: true, force: true });
  await db().execute("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;" as never);
  await runMigrations();
  seeded = (await E.seed(db(), { email: "owner@test.dev", password: "a-long-password" })) as typeof seeded;
  owner = { userId: seeded.userId, workspaceId: seeded.workspaceId };
}, 120_000);

afterAll(async () => {
  await E.closeRenderer();
  await closeDb();
});

describe("seed", () => {
  it("imports ISMII, saves templates with golden snapshots, renders passing posts", async () => {
    const tpls = await E.listTemplates(db(), owner, seeded.projectId);
    expect(tpls.map((t) => t.name)).toContain("Lecture announcement");
    const all = await E.listPosts(db(), owner, seeded.projectId);
    expect(all).toHaveLength(2);
    for (const p of all) {
      const full = await E.getPost(db(), owner, p.id);
      for (const page of full.pages)
        for (const [format, r] of Object.entries(page.renders)) {
          expect(r, `${p.title} ${format}`).toBeTruthy();
          expect((r!.report as { issues: unknown[] }).issues, `${p.title} page ${page.index} ${format}`).toEqual([]);
        }
    }
  });

  it("re-rendering an unchanged post reuses the identical render", async () => {
    const [p] = await E.listPosts(db(), owner, seeded.projectId);
    const a = await E.renderPostInternal(db(), p.id);
    const b = await E.renderPostInternal(db(), p.id);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
  });
});

describe("roles", () => {
  it("enforces workspace and project roles", async () => {
    const editorInv = await E.createInvite(db(), owner, "editor@test.dev", "editor");
    const { userId: editorId } = await E.acceptInvite(db(), editorInv.token, { name: "Ed", password: "editor-password" });
    const editor = { userId: editorId, workspaceId: owner.workspaceId };
    await expect(E.saveTemplate(db(), editor, seeded.projectId, E.ISMII_TEMPLATES[1])).rejects.toThrow(/permission/);
    await expect(E.createInvite(db(), editor, "x@test.dev", "viewer")).rejects.toThrow(/permission/);
    const tpl = (await E.listTemplates(db(), editor, seeded.projectId))[0];
    const post = await E.createPost(db(), editor, seeded.projectId, { pages: [{ templateVersionId: tpl.versionId!, slots: tpl.spec!.sample as never }], formats: [tpl.spec!.formats[0]] });
    expect(post.id).toBeTruthy();
    // narrowing the editor to viewer on this project
    await E.setProjectRole(db(), owner, seeded.projectId, editorId, "viewer");
    await expect(E.createPost(db(), editor, seeded.projectId, { pages: [{ templateVersionId: tpl.versionId!, slots: {} }], formats: ["square"] })).rejects.toThrow(/permission/);
    await E.setProjectRole(db(), owner, seeded.projectId, editorId, null);
    // admins cannot create owners
    const adminInv = await E.createInvite(db(), owner, "admin@test.dev", "admin");
    const { userId: adminId } = await E.acceptInvite(db(), adminInv.token, { password: "admin-password" });
    await expect(E.createInvite(db(), { userId: adminId, workspaceId: owner.workspaceId }, "o@test.dev", "owner")).rejects.toThrow(/owner/);
    await expect(E.setMemberRole(db(), owner, owner.userId, "admin")).rejects.toThrow(/at least one owner/);
  });
});

function fakeClaude(answers: unknown[]): Anthropic {
  return {
    beta: {
      messages: {
        create: async (req: { messages: { content: unknown }[] }) => {
          if (!answers.length) throw new Error(`No more fake answers. Last message: ${JSON.stringify(req.messages.at(-1)?.content).slice(0, 1500)}`);
          return { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(answers.shift()) }], usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 } };
        },
      },
    },
  } as unknown as Anthropic;
}

describe("generation", () => {
  it("fills slots, feeds real overflow back to Claude, generates seeded images, renders", async () => {
    const tpls = await E.listTemplates(db(), owner, seeded.projectId);
    const photo = tpls.find((t) => t.name === "Photo feature")!;
    const variant = (headline: string) => ({ slots: { eyebrow: "From the archive", headline }, imagePrompts: { photo: "a reading room with manuscripts" }, caption: "We keep the record.", hashtags: ["#ISMII"], altText: "A reading room.", sourceUrls: [] });
    const tooLong = "A reading room in Hyderabad where scholars have worked for nearly a century";
    const client = fakeClaude([{ variants: [variant(tooLong)] }, { variants: [variant("A reading room in Hyderabad, 1932")] }]);
    const res = await E.generatePosts(db(), owner, { projectId: seeded.projectId, templateId: photo.id, brief: "Archive photo", formats: ["square", "landscape"], variants: 1, images: "generate", runId: "run-1" }, { anthropic: client });
    expect(res.attempts).toBe(2);
    expect(res.problems).toEqual([]);
    const post = await E.getPost(db(), owner, res.postIds[0]);
    expect(post.pages[0].slots.headline).toBe("A reading room in Hyderabad, 1932");
    const cands = (post.post.copyMeta as { candidates: Record<string, string[]> }).candidates.photo;
    expect(cands).toHaveLength(4);
    expect((post.pages[0].slots.photo as { assetId: string }).assetId).toBe(cands[0]);
    expect(post.pages[0].renders.square!.passed).toBe(true);
    const recipe = post.pages[0].renders.square!.recipe as { images: Record<string, { seed: number; provider: string }> };
    expect(Object.values(recipe.images)[0]).toMatchObject({ provider: "placeholder" });
    // same run id, same seeds -> byte-identical images
    const again = await E.generatePosts(db(), owner, { projectId: seeded.projectId, templateId: photo.id, brief: "Archive photo", formats: ["square"], variants: 1, images: "generate", runId: "run-1" }, { anthropic: fakeClaude([{ variants: [variant("A reading room in Hyderabad, 1932")] }]) });
    const p2 = await E.getPost(db(), owner, again.postIds[0]);
    const a1 = await E.getAsset(db(), owner, (post.pages[0].slots.photo as { assetId: string }).assetId);
    const a2 = await E.getAsset(db(), owner, (p2.pages[0].slots.photo as { assetId: string }).assetId);
    expect(a1.asset.sha256).toBe(a2.asset.sha256);
  });

  it("writes a carousel as one story across pages", async () => {
    const tpls = await E.listTemplates(db(), owner, seeded.projectId);
    const id = (n: string) => tpls.find((t) => t.name === n)!.id;
    const client = fakeClaude([
      { variants: [{ slots: { p1_eyebrow: "Explainer", p1_headline: "Three ports", p2_title: "Calicut", p2_text: "Pepper and faith.", p3_title: "Quilon", p3_text: "Copper plates.", p4_headline: "Commerce came first.", p4_cta: "" }, imagePrompts: {}, caption: "c", hashtags: [], altText: "a", sourceUrls: [] }] },
    ]);
    const res = await E.generatePosts(db(), owner, { projectId: seeded.projectId, carousel: { coverTemplateId: id("Carousel cover"), contentTemplateId: id("Carousel page"), endTemplateId: id("Carousel end"), pages: 4 }, brief: "ports", formats: ["portrait"], variants: 1, images: "none" }, { anthropic: client });
    const post = await E.getPost(db(), owner, res.postIds[0]);
    expect(post.post.kind).toBe("carousel");
    expect(post.pages.map((p) => p.slots.title ?? p.slots.headline)).toEqual(["Three ports", "Calicut", "Quilon", "Commerce came first."]);
    const zip = await E.exportPost(db(), owner, post.post.id, "portrait", "zip");
    expect(Object.keys(unzipSync(new Uint8Array(zip.bytes))).sort()).toEqual(["alt-text.txt", "caption.txt", "three-ports-portrait-01.png", "three-ports-portrait-02.png", "three-ports-portrait-03.png", "three-ports-portrait-04.png"]);
    const pdf = await E.exportPost(db(), owner, post.post.id, "portrait", "pdf");
    expect(pdf.bytes.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("refuses to export a post that fails its checks", async () => {
    const tpls = await E.listTemplates(db(), owner, seeded.projectId);
    const t = tpls.find((x) => x.name === "Text post")!;
    const p = await E.createPost(db(), owner, seeded.projectId, { pages: [{ templateVersionId: t.versionId!, slots: { headline: "This headline is written far too long so that it cannot possibly fit inside four lines of the frame at this size of type" } }], formats: ["square"] });
    await expect(E.exportPost(db(), owner, p.id, "square")).rejects.toThrow(/does not pass/);
  });
});

describe("website knowledge", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/robots.txt") return res.writeHead(200, { "content-type": "text/plain" }).end("User-agent: *\nAllow: /");
      if (req.url === "/sitemap.xml") return res.writeHead(404).end();
      if (req.url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(`<title>Home</title><a href="/events/coast">Lecture</a>`);
      if (req.url === "/events/coast")
        return res.writeHead(200, { "content-type": "text/html" }).end(`<html><head><title>Coast before conquest</title><script type="application/ld+json">{"@type":"Event","name":"Coast before conquest","startDate":"2027-01-09"}</script></head><body><article><p>${"The Malabar coast received Arab merchants in the seventh century and their mosques still stand. ".repeat(8)}</p></article></body></html>`);
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => server.close());

  it("crawls, indexes and searches the site, and feeds pages to generation", async () => {
    const src = await E.addSource(db(), owner, seeded.projectId, { url: base, maxPages: 10 });
    const res = await E.runCrawl(db(), src.id, owner);
    expect(res.saved).toBe(2);
    const hits = await E.searchKnowledge(db(), owner, seeded.projectId, "Malabar merchants");
    expect(hits[0].title).toBe("Coast before conquest");
    const pages = await E.listWebPages(db(), owner, seeded.projectId, { type: "event" });
    expect(pages[0].entities[0]).toMatchObject({ type: "event", name: "Coast before conquest" });
    // recrawl: nothing new
    expect((await E.runCrawl(db(), src.id, owner)).newPages).toBe(0);
  });
});

describe("publishing", () => {
  it("publishes a scheduled carousel to Instagram via the job queue", async () => {
    const [carousel] = (await E.listPosts(db(), owner, seeded.projectId)).filter((p) => p.kind === "carousel" && p.title.startsWith("Five"));
    const [ch] = await db().insert(channels).values({ projectId: seeded.projectId, platform: "instagram", externalId: "1789", name: "@ismii", tokenEncrypted: encrypt("ig-token") }).returning();
    await expect(E.schedulePublication(db(), owner, carousel.id, ch.id, "story")).rejects.toThrow(/cannot be published/);
    const pub = await E.schedulePublication(db(), owner, carousel.id, ch.id, "portrait");
    const calls: string[] = [];
    let n = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url).split("?")[0]}`);
      if (String(url).includes("media_publish")) return new Response(JSON.stringify({ id: "ig-media-1" }));
      if (init?.method === "POST") {
        const body = new URLSearchParams(String(init.body));
        if (body.get("image_url")) expect(body.get("image_url")).toMatch(/^https:\/\/engine\.test\/api\/public\/renders\/.+\?sig=/);
        return new Response(JSON.stringify({ id: `c${++n}` }));
      }
      if (String(url).includes("permalink")) return new Response(JSON.stringify({ permalink: "https://instagram.com/p/abc" }));
      return new Response(JSON.stringify({ status_code: "FINISHED" }));
    });
    try {
      expect(await E.runOneJob(db())).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    const [after] = await db().select().from(publications).where(eq(publications.id, pub.id));
    expect(after).toMatchObject({ status: "published", externalId: "ig-media-1", url: "https://instagram.com/p/abc" });
    expect(calls.filter((c) => c.startsWith("POST")).length).toBe(6); // 4 children + carousel + publish
    const [post] = await db().select().from(posts).where(eq(posts.id, carousel.id));
    expect(post.status).toBe("published");
  });
});

describe("design-system updates", () => {
  it("compares posts rendered with a new version before applying it", async () => {
    const files = await readDirectory(resolve(E.FIXTURES_DIR, "ismii"));
    const bundle = importFromFiles(files);
    const tokens = structuredClone(bundle.tokens);
    tokens.color!.tokens.find((t) => t.name === "sandstone-red")!.value = "#7a2e19";
    const v2 = await E.saveDesignSystemVersion(db(), owner, seeded.projectId, { ...bundle, tokens }, "Darker sandstone");
    const [lecture] = (await E.listPosts(db(), owner, seeded.projectId)).filter((p) => p.title === "Coast before conquest");
    const cmp = await E.compareDesignSystem(db(), owner, seeded.projectId, v2.id, [lecture.id]);
    const landscape = cmp.find((c) => c.format === "landscape")!;
    expect(landscape.diffRatio).toBeGreaterThan(0.3); // the sandstone ground changed
    const story = cmp.find((c) => c.format === "story")!;
    expect(story.diffRatio).toBeLessThan(0.01); // ivory story barely uses sandstone
    // the post itself is unchanged until applied
    const [row] = await db().select().from(posts).where(eq(posts.id, lecture.id));
    expect(row.designSystemVersionId).not.toBe(v2.id);
    await E.publishDesignSystemVersion(db(), owner, v2.id);
    await E.applyCurrentDesignSystem(db(), owner, [lecture.id]);
    const [row2] = await db().select().from(posts).where(eq(posts.id, lecture.id));
    expect(row2.designSystemVersionId).toBe(v2.id);
  });
});

describe("jobs", () => {
  it("does not retry permanent errors", async () => {
    const job = await E.startGeneration(db(), owner, { projectId: seeded.projectId, templateId: "auto", brief: "x", formats: ["youtube"], variants: 1, images: "none" });
    E.testHooks.generateDeps = { anthropic: fakeClaude([]) };
    await E.runOneJob(db());
    E.testHooks.generateDeps = undefined;
    const [j] = await db().select().from(jobs).where(eq(jobs.id, job.id));
    expect(j.status).toBe("failed");
    expect(j.error).toMatch(/No template supports/);
  });
});

void renders;
void webPages;
