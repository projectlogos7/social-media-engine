# Social Media Engine — Plan

An engine that produces on-brand social images and posts for multiple projects,
where each project has a fixed design system, and where the output is
**predictable**: the same inputs give the same result, and nothing leaves the
engine that breaks the brand.

---

## 1. The core idea: AI fills slots, it doesn't draw the whole image

If you ask an image model for "an Instagram post for Brand X with the headline
'Summer Sale'", you get a different layout, wrong fonts, mangled text and
off-palette colors every time. That cannot be made reliable.

So the engine splits every image into two kinds of parts:

| Part | Who produces it | Why |
|---|---|---|
| Layout, grid, typography, colors, logo, spacing | **Deterministic template** rendered from the project's design system | Pixel-exact, identical every time |
| Text (headline, body, CTA, hashtags, caption) | **LLM**, returning strict JSON that must pass a schema (length limits, tone rules) | Words vary, the slot they go in doesn't |
| Imagery (photo, illustration, background) | **Image model**, with a locked style prompt, reference images and a stored seed — or a real asset from the project library | Only the picture inside the frame varies |

The final image is rendered by a headless browser (HTML/CSS → PNG), so text is
real typography, never AI-drawn letters.

```
 Brief ──► Content planner (LLM) ──► Slot values (JSON, validated)
   │              ▲                          │
   │      Website knowledge                  ▼
   │                               Template + Design system tokens
   │                                          │
   └──► Image slot (gen model / asset) ──────►│
                                              ▼
                                  Renderer (Playwright) ──► PNG/JPG/PDF
                                              │
                                              ▼
                               Quality gates ──► Review ──► Approved post
```

---

## 2. Domain model

```
Workspace
 └─ Project                      e.g. "Acme Coffee", "Nous Podcast"
     ├─ DesignSystem (versioned, immutable once published)
     │   ├─ tokens: colors, type scale, fonts, spacing, radii, shadows
     │   ├─ assets: logos (variants), patterns, icons, fonts files
     │   ├─ imagery style: style prompt, negative prompt, reference images,
     │   │                 model + params allowed for this brand
     │   └─ voice: tone rules, banned words, CTA style, hashtag policy, language
     ├─ Templates (versioned)
     │   ├─ format: 1080x1080, 1080x1350, 1080x1920, 1200x628, carousel…
     │   ├─ layout: HTML/CSS using only design-system tokens
     │   └─ slots: name, type (text/image/list), constraints
     │            (max chars, min/max lines, required, crop ratio)
     ├─ Sources (website(s), sitemaps, RSS, uploaded docs)
     │   └─ Knowledge: crawled pages → clean text + structured entities
     ├─ Asset library (uploaded photos, product shots, approved generations)
     └─ Posts
         └─ Renders  ← each one stores its full "recipe"
```

**Design system lock:** a project points to one *published* design system
version. Templates and renders reference that version explicitly. Editing the
design system creates a new version; old posts still re-render exactly as they
were.

---

## 3. What makes it predictable

1. **Recipes.** Every render stores: design system version, template version,
   slot values, image prompt, model name + version, seed, reference images,
   and source URLs used. Any render can be reproduced or tweaked from its recipe.
2. **Constrained generation.** The LLM never writes free-form layouts. It
   fills a JSON schema derived from the template's slots. Anything that fails
   the schema is retried, then flagged — never rendered half-broken.
3. **Fixed vocabulary.** Templates may only use design tokens (no raw hex
   codes or ad-hoc fonts). A linter enforces this when a template is saved.
4. **Quality gates before a post is "ready":**
   - text fits its box (measured in the real renderer, no overflow/clipping)
   - WCAG contrast of text against its background
   - logo present, safe-zone respected
   - image palette distance from brand palette (flag outliers)
   - voice check: banned words, length, claims backed by website content
5. **Image generation discipline.** Per-project style prompt + reference images
   + fixed seed; several candidates generated, a human (or a scoring pass)
   picks one, and approved images go into the asset library for reuse.
6. **Golden tests.** Each template has sample inputs and a snapshot image;
   changing a template or design system shows a visual diff before publishing.

---

## 4. Website data & content

Per project, the engine connects to the project's website(s):

1. **Crawl** from sitemap.xml / RSS / start URL (headless browser for JS sites),
   on a schedule, respecting robots.txt.
2. **Extract** clean text, headings, images, and structured entities
   (products, prices, blog posts, events, team, FAQs) into typed records.
3. **Index** chunks with embeddings (pgvector) for retrieval.
4. **Use** in generation: "make a post about our new blog article" pulls the
   article, its hero image and key quotes; every factual claim in generated
   copy carries a link back to the source page.
5. **Triggers** (later): new blog post / new product on the site → draft posts
   automatically queued for review.

Brand bootstrapping: the crawler can also *propose* a starter design system
(colors, fonts, logo) from the site, which a human then confirms and locks.

---

## 5. User flows

- **Set up a project:** create project → import/define design system
  (manual, from tokens JSON, from Figma, or proposed from website) → publish v1.
- **Create templates:** pick format → build layout from components
  (headline block, image block, logo, CTA, quote card, stat card, carousel page)
  → define slots → save golden sample.
- **Make a post:** choose project → choose template (or "suggest one") →
  write a brief or pick website content → engine fills slots + generates image
  candidates → preview all variants → edit any slot inline → approve → export
  (PNG/JPG, carousel ZIP/PDF, caption text).
- **Batch:** "10 posts from our last 5 blog articles in these 2 templates."
- **Re-render:** design system updated → re-render chosen posts with the new
  version, side-by-side diff.

---

## 6. Proposed tech stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript monorepo (pnpm workspaces) | One language across UI, API, renderer |
| App / UI | Next.js (App Router) | Project/template editor, post review |
| API | Next.js route handlers or a Fastify service | |
| Database | Postgres + pgvector (Drizzle ORM) | Projects, versions, recipes, knowledge |
| Files | S3-compatible storage (R2/S3/MinIO) | Fonts, logos, generations, renders |
| Jobs | Queue (pg-boss or BullMQ) | Crawls, generations, renders are async |
| Renderer | Playwright + Chromium, HTML/CSS templates | Real fonts, exact layout, measurable text fit |
| Copy / planning | Claude via Anthropic API with structured (JSON-schema) output | |
| Images | Adapter over several providers (e.g. Flux, Imagen, gpt-image, Ideogram) | Per project, choose the one that holds its style best |
| Crawling | Playwright + readability extraction | |

Packages:

```
apps/web            UI + API
packages/core       domain types, schemas, recipe format
packages/design     design-system schema, token → CSS compiler, template linter
packages/render     Playwright renderer, text-fit + contrast checks
packages/generate   LLM slot filling, image-provider adapters
packages/knowledge  crawler, extractor, embeddings, retrieval
packages/worker     job runner
```

---

## 7. Phased delivery

**Phase 0 — Foundations (week 1)**
Monorepo, DB schema, design-system JSON schema, token→CSS compiler, one
hard-coded template rendered to PNG via Playwright. *Proof: same input → byte-identical PNG.*

**Phase 1 — Deterministic posts (weeks 2–3)**
Projects, versioned design systems, template editor with slots, manual slot
filling, render + export, golden-snapshot tests, text-fit/contrast gates.
*Proof: a non-designer can make on-brand posts with zero AI.*

**Phase 2 — AI content (weeks 4–5)**
Brief → LLM fills slots via schema; voice rules; image generation with
per-project style, seeds and candidates; recipes stored; asset library.
*Proof: 20 generated posts, all pass gates, all look like the brand.*

**Phase 3 — Website knowledge (weeks 6–7)**
Crawler, extraction, embeddings, "post from this page", source citations,
starter design system from website.

**Phase 4 — Scale & automation (week 8+)**
Batch generation, carousels, new-content triggers, re-render on design-system
update with diffs, scheduling/publishing integrations, team roles & approvals.

---

## 8. Open questions

1. **Design systems today** — where do they live? (Figma files, tokens JSON,
   PDF brand guides, CSS of the website?) This decides the import path.
2. **Image generation** — any preferred provider / existing accounts? Do you
   want photorealistic imagery, illustration, or mostly typographic posts?
3. **Platforms & formats** — Instagram, LinkedIn, X, TikTok covers, YouTube
   thumbnails? Carousels? Video later?
4. **Who uses it** — just you, or a team with review/approval roles?
5. **Hosting** — self-hosted (Docker) vs managed (Vercel + Supabase/Neon + R2)?
6. **Publishing** — export files only, or post directly to the platforms?
