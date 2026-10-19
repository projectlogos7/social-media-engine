# Social Media Engine

Structured, on-brand social images from your Claude design systems: one engine, many projects, predictable output.

AI fills **slots** in fixed, designed templates. It never draws the layout. Layout, fonts, colours and logos come from each project's locked design system, so the same inputs always produce the same image. Every image passes automatic quality gates before it can be exported or published.

## What it does

- **Projects with locked design systems.** Import a Claude Design System export (zip, folder or HTML file). Tokens, themes, fonts, logos, post frames, the brand book and the voice section all come across. Each import becomes a new version. Posts keep the version they were made with until you move them on, after a visual comparison.
- **Templates.** Handlebars HTML and CSS that may only use the design system's tokens. Every edit is a new version. You can start from a design-system showcase (for example the ISMII *LecturePost*), from a starter kit, or blank. A live preview, a linter and golden snapshots with pixel diffs come with it.
- **Posts and carousels.** Fill slots yourself, or let Claude write them from a brief and your website. Formats are Instagram square/portrait/story, LinkedIn landscape and YouTube thumbnail, plus carousels (Instagram multi-image, LinkedIn PDF).
- **Images.** OpenAI (gpt-image), Google Imagen, FLUX (fal.ai) or Ideogram, with a per-project style prompt, reference images and stored seeds. An offline brand-pattern provider needs no key. Several candidates are made per image, and the one closest to the brand palette is picked.
- **Website knowledge.** A robots.txt-aware crawler reads sitemaps and pages and recognises articles, events and products (JSON-LD). It powers full-text search for Claude and makes "post from this page" possible. It can also draft posts automatically when new content appears.
- **Export and publish.** Download a PNG, a ZIP (with caption and alt text) or a PDF. Publish to Instagram (Graph API) and LinkedIn (Posts API) now or on a schedule.
- **Teams.** Workspaces, invites and five roles (owner, admin, designer, editor, viewer), which can be narrowed per project. There is no approval step.

## Why the output is predictable

1. **Recipes.** Each render stores the design-system version, template version, format, theme, slot values and, for every image, its provider, model, prompt and seed. Identical recipes reuse the identical PNG, and rendering is byte-for-byte deterministic: network blocked, fonts embedded, fixed Chromium.
2. **Constrained copy.** Claude returns schema-constrained JSON built from the template's slots, with the brand book and voice in a cached system prompt. Each variant is then *test-rendered*. Real problems ("headline wraps to 5 lines; the most is 4") go back to Claude to fix, up to three attempts.
3. **Quality gates** (a failing post cannot be exported or published):
   - required slots, character limits, banned words;
   - text that overflows, wraps too far, overlaps other text or leaves the canvas;
   - **contrast measured on the actual pixels behind the text**, including over photos (WCAG 4.5:1, or 3:1 at 24px+);
   - **colour rules read from the design system's token notes**, e.g. ISMII "rosette-gold never sets text", "deep-gold only at 24px and up", "sandstone-red never on india-ink";
   - fonts that failed to load, a missing logo, platform safe zones (story top and bottom).
4. **Template lint.** No raw colours, no foreign fonts, no scripts or remote files, and no reference to missing assets or tokens.

## Quick start (local)

Requirements: Node 22, pnpm 10, PostgreSQL 14+.

```bash
pnpm install
cp .env.example .env            # set APP_SECRET; DATABASE_URL defaults to postgres://sme:sme@127.0.0.1:5432/sme
pnpm db:migrate
pnpm seed                       # demo workspace with the ISMII project, templates and posts
pnpm dev                        # http://localhost:3000 (the job worker runs inside the web process)
```

The seed signs you in as `owner@example.com` / `change-me-now` (set `SEED_EMAIL` and `SEED_PASSWORD` to change these). Add an Anthropic key under **Members & API keys** to use *Write with AI*.

### Docker

```bash
cp .env.example .env            # set APP_SECRET and APP_URL
docker compose up --build
```

This is one container (web and worker) on the official Playwright image, plus Postgres. For managed hosting, run the same image on Fly.io, Railway or Render with a managed Postgres (Neon, Supabase) and set `S3_*` to store files in R2 or S3. Set `RUN_WORKER=false` on the web container and run `pnpm worker` in a second container to scale them separately.

## Importing a Claude design system

On claude.ai, download your Design System artifact. In the project's **Design system** tab, upload the zip, the folder (the one that contains `tokens.json`) or the design system's HTML file. The importer:

- compiles `tokens.json` the way Claude does (themes, aliases, type styles, `--font-*`, spacing);
- embeds `fonts/` so renders never fall back to another font;
- keeps `assets/<Group>/…` for templates as `{{asset "Lockups/…svg"}}`;
- turns `/_blob/<id>` links in component previews back into asset paths;
- reads the README and guideline sections as the brand book, and the voice section as the copy voice;
- derives enforceable colour rules from token `usage` notes;
- reports anything it could not read.

## Templates in short

```html
<div class="box">
  <div class="eyebrow" data-slot="kind">{{kind}}</div>
  <h1 class="title" data-slot="title">{{title}}</h1>
  {{#if (has "photo")}}<img src="{{image "photo"}}" style="object-position: {{focus "photo"}}">{{/if}}
  <img data-role="logo" src="{{asset "Lockups/ismii-lockup-horizontal-mono-ivory.svg"}}">
</div>
```

- Mark text elements with `data-slot` so they can be measured, and the logo with `data-role="logo"`.
- The canvas carries `data-format="square|portrait|story|landscape|youtube"`, so one template can lay out each format.
- Give content boxes `overflow: hidden`. Anything that does not fit is then reported, never silently cut.
- Template class names that match a design-system type style (`label`, `body`, `display`…) pick up that style. The linter warns about this.

## Repository

```
packages/core       formats, slot/template schema, roles, recipes, colour maths
packages/design     Claude DS importer, token→CSS compiler, brand rules, template engine, linter, converters, starter kit
packages/render     Playwright renderer, quality gates, visual diff, palette distance, PDF
packages/generate   Claude copywriter (structured output + fix loop), image provider adapters
packages/knowledge  crawler, extraction (readability, OpenGraph, JSON-LD), chunking
packages/publish    Instagram Graph API and LinkedIn Posts API clients
packages/db         Drizzle schema + migrations, storage (local/S3), encryption, job queue
packages/engine     services: auth, projects, design systems, templates, posts, generation, knowledge, publishing, jobs, seed
apps/web            Next.js app (UI, API routes, in-process worker)
fixtures/ismii      the ISMII Claude design system, used by the seed and tests
```

## Tests

```bash
createdb sme_test                # the engine tests use postgres://sme:sme@127.0.0.1:5432/sme_test
pnpm test                        # design, render, generate, knowledge, publish and end-to-end engine tests
pnpm typecheck
```

The engine tests cover:
- seeding ISMII with every render passing;
- roles and project narrowing;
- generation with a fake Claude, including the overflow-fix loop and seeded, reproducible images;
- carousel ZIP and PDF export;
- crawling a local site;
- publishing a carousel to a mocked Instagram through the queue;
- comparing posts against a modified design system.

## Not verified against live services

Claude, the image providers, Instagram and LinkedIn are called with their documented request shapes, but this repository was built without credentials for them. They are covered by mocked tests only. Check each one with real keys before relying on it.
