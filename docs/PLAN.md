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
 ├─ Members (users + roles, see §6)
 ├─ Provider keys (image + text model API keys, encrypted)
 └─ Project                      e.g. "ISMII", "Nous Podcast"
     ├─ DesignSystem (versioned, immutable once published,
     │                imported from a Claude Design System — see §4)
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
     ├─ Posts
     │   └─ Renders  ← each one stores its full "recipe"; saved in the
     │                 project's image library, downloadable any time
     └─ Channels (later): connected Instagram / LinkedIn accounts
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

## 4. Importing Claude Design Systems

Design systems are authored in Claude (the "Design System" artifact type) and
imported into the engine. That format is already structured and machine
readable, so the engine reads it directly instead of re-entering anything:

| Claude Design System file | Becomes in the engine |
|---|---|
| `tokens.json` — colours (with themes such as `ivory` / `ink`, and aliases like `{sandstone-red}`), type families + styles, spacing, radius, extra families (logo sizing, safe zones…) | Design tokens, compiled to CSS custom properties (`--sandstone-red`, `--font-serif`, `.display`, `--space-6`, `[data-theme="ink"]`), identical to how Claude compiles them |
| `fonts/*.woff2` + `type.fonts[]` | `@font-face` rules; fonts embedded in the renderer so text is pixel-exact |
| `assets/<Group>/…` (Mark, Lockups, Social-templates frames, avatars…) | Brand assets, grouped; templates reference them by role, e.g. *logo: horizontal reversed*, *frame: square sandstone* |
| `README.md` + guideline sections (`10-logo.md`, `20-colour.md`, …) | Brand rules given to the AI planner as context, and turned into checks where they are precise (e.g. "gold never sets text", "never text on india-ink in sandstone") |
| `50-voice.md` (voice section) | Voice rules for the copy writer |
| Colour token `usage` notes with contrast ratios | Allowed text/ground pairs, enforced by the contrast gate |
| `components/<Comp>/preview.html` (e.g. *LecturePost*) | Starting points for templates: the engine converts a showcase into a template with named slots |

**How it gets in:** export/download the design system from Claude and upload
the folder (zip) to a project. The importer validates it against the same
token grammar Claude uses, shows what it found (and anything it dropped),
then publishes it as a new locked version. Re-importing an updated design
system creates the next version; nothing already rendered changes.

---

## 5. Website data & content

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

The website is a content source only; the look always comes from the
imported Claude design system.

---

## 6. Users & roles

Multiple users per workspace, no approval step: anyone allowed to create
posts can export them directly.

| Role | Can |
|---|---|
| **Owner** | Everything, billing, API keys, delete workspace |
| **Admin** | Manage members and projects, connect websites, manage provider keys |
| **Designer** | Import/publish design systems, create and edit templates, plus everything an Editor can do |
| **Editor** | Create, edit, render, export and save posts |
| **Viewer** | Browse projects, posts and the image library, download |

Roles are given per workspace and can be narrowed per project (e.g. an
Editor on *ISMII* only). Every render records who made it.

---

## 7. User flows

- **Set up a project:** create project → upload the Claude Design System
  export → review → publish v1 → connect the website.
- **Create templates:** pick format → build layout from components
  (headline block, image block, logo, CTA, quote card, stat card, event card),
  or start from one of the design system's showcase components
  → define slots → save golden sample.
- **Make a post:** choose project → choose template (or "suggest one") →
  write a brief or pick website content → engine fills slots + generates image
  candidates → preview all variants → edit any slot inline → save & export
  (PNG/JPG + caption text). Saved images stay in the project's library.
- **Batch:** "10 posts from our last 5 blog articles in these 2 templates."
- **Re-render:** design system updated → re-render chosen posts with the new
  version, side-by-side diff.

---

## 8. Tech stack

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
| Images | One adapter interface, several providers: OpenAI (gpt-image), Google (Imagen / Gemini image), Black Forest Labs Flux (via fal or Replicate), Ideogram | Each project picks a default provider + model in its imagery settings; workspace stores the API keys |
| Auth | Auth.js (email magic link + Google) with workspace/project role checks | |
| Crawling | Playwright + readability extraction | |

Packages:

```
apps/web            UI + API
packages/core       domain types, schemas, recipe format
packages/design     Claude DS importer, token → CSS compiler, template linter
packages/render     Playwright renderer, text-fit + contrast checks
packages/generate   LLM slot filling, image-provider adapters
packages/knowledge  crawler, extractor, embeddings, retrieval
packages/worker     job runner
```

---

## 9. Formats (first release)

| Platform | Format | Size |
|---|---|---|
| Instagram | Square post | 1080 × 1080 |
| Instagram | Portrait post (4:5) | 1080 × 1350 |
| Instagram | Story / Reel cover (9:16) | 1080 × 1920, with the design system's bottom safe zone |
| LinkedIn | Landscape post / link image | 1200 × 627 |
| LinkedIn | Square post | 1080 × 1080 (shared with Instagram) |
| LinkedIn | Portrait post | 1080 × 1350 (shared with Instagram) |

Each template declares which formats it supports; one post can be exported in
several formats at once. **Later:** carousels (Instagram multi-image, LinkedIn
PDF document), YouTube thumbnails (1280 × 720), and more.

---

## 10. Phased delivery

**Phase 0 — Foundations (week 1)**
Monorepo, DB schema, Claude Design System importer + token→CSS compiler,
one template (ISMII lecture post) rendered to PNG via Playwright.
*Proof: import ISMII; same input → byte-identical PNG.*

**Phase 1 — Deterministic posts (weeks 2–3)**
Workspace, users & roles, projects, versioned design systems, template editor
with slots, manual slot filling, Instagram + LinkedIn formats, render, save to
library, export, golden-snapshot tests, text-fit/contrast gates.
*Proof: an Editor can make on-brand posts for two projects with zero AI.*

**Phase 2 — AI content (weeks 4–5)**
Brief → Claude fills slots via schema using the design system's voice rules;
image-provider adapters (OpenAI, Google, Flux, Ideogram) with per-project
style, seeds and candidates; recipes stored.
*Proof: 20 generated posts, all pass gates, all look like the brand.*

**Phase 3 — Website knowledge (weeks 6–7)**
Crawler, extraction, embeddings, "post from this page", source citations,
new-content triggers that draft posts.

**Phase 4 — Publishing & more formats (week 8+)**
Connect Instagram (Graph API, business/creator accounts) and LinkedIn (member
and organization pages), post now or schedule; carousels; YouTube thumbnails;
batch generation; re-render on design-system update with diffs.

---

## 11. Decisions so far

| Question | Decision |
|---|---|
| Design systems | Authored in Claude (Design System artifacts), imported as exported folders |
| Image generation | Support all major providers behind one adapter; photo, illustration and typographic posts |
| Platforms | Instagram + LinkedIn first; carousels, YouTube thumbnails later |
| Users | Multiple users with roles; no approval step |
| Publishing | Export + save to library now; direct posting in Phase 4 |

## 12. Still open

1. **Hosting** — self-hosted (Docker on a VPS) or managed (Vercel + Neon/Supabase + R2)?
   Default if no preference: managed, because the renderer and workers can run
   as one small container alongside.
2. **API keys** — which image providers you'll get keys for first (the engine
   will work with any one of them).
