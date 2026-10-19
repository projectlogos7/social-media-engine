import type { TemplateSpec } from "@sme/core";

export interface StarterChoice {
  ground: string;
  text: string;
  accent: string;
  /** Muted text colour; defaults to text. */
  muted?: string;
  /** Font family keys from type.families, e.g. "serif", "sans". */
  headingFamily: string;
  bodyFamily: string;
  /** Asset path for the logo on this ground, e.g. "Lockups/x.svg". */
  logo?: string;
}

const ALL = ["square", "portrait", "story", "landscape"] as const;

/**
 * Generates a starter kit of templates bound to chosen design-system tokens.
 * Layout adapts to the format through [data-format] selectors on the canvas.
 */
export function starterTemplates(c: StarterChoice): TemplateSpec[] {
  const muted = c.muted ?? c.text;
  const base = `
.frame { position: absolute; inset: 0; background: var(--${c.ground}); color: var(--${c.text}); font-family: var(--font-${c.bodyFamily}); padding: 88px; display: flex; flex-direction: column; }
[data-format="story"] .frame { padding: 240px 88px 340px; }
[data-format="landscape"] .frame { padding: 56px 72px; }
.eyebrow { font-size: 26px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; color: var(--${c.accent}); }
.headline { font-family: var(--font-${c.headingFamily}); font-weight: 600; color: var(--${c.text}); margin: 0; }
.copy { color: var(--${muted}); }
.logo { height: 64px; width: auto; display: block; }
.rule { height: 3px; background: var(--${c.accent}); width: 120px; }
.foot { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; }`;
  const logo = c.logo ? `<img class="logo" data-role="logo" src="{{asset "${c.logo}"}}" alt="">` : "";
  return [
    {
      name: "Headline",
      description: "A bold statement with an optional supporting line and call to action.",
      formats: [...ALL],
      theme: "",
      role: "single",
      html: `<div class="frame">
  {{#if eyebrow}}<div class="eyebrow" data-slot="eyebrow">{{eyebrow}}</div>{{/if}}
  <h1 class="headline" data-slot="headline">{{headline}}</h1>
  {{#if body}}<p class="copy" data-slot="body">{{body}}</p>{{/if}}
  <div class="foot">{{#if cta}}<div class="cta" data-slot="cta">{{cta}}</div>{{/if}}${logo}</div>
</div>`,
      css: `${base}
.eyebrow { margin-bottom: 32px; }
.headline { font-size: 96px; line-height: 1.05; }
[data-format="landscape"] .headline { font-size: 64px; }
.copy { font-size: 34px; line-height: 1.4; margin: 36px 0 0; max-width: 820px; }
[data-format="landscape"] .copy { font-size: 26px; }
.cta { font-size: 28px; font-weight: 600; color: var(--${c.accent}); }`,
      slots: [
        { name: "eyebrow", label: "Eyebrow", type: "text", description: "Short label above the headline, 1–4 words.", required: false, maxChars: 32, maxLines: 1 },
        { name: "headline", label: "Headline", type: "text", description: "The main statement.", required: true, maxChars: 70, maxLines: 4 },
        { name: "body", label: "Supporting line", type: "text", description: "One supporting sentence.", required: false, maxChars: 140, maxLines: 4 },
        { name: "cta", label: "Call to action", type: "text", description: "Short call to action.", required: false, maxChars: 32, maxLines: 1 },
      ],
      sample: { eyebrow: "New", headline: "A headline that says one thing well", body: "A supporting sentence gives the reader a reason to care.", cta: "Read more" },
    },
    {
      name: "Quote",
      description: "A pull-quote with attribution.",
      formats: [...ALL],
      theme: "",
      role: "single",
      html: `<div class="frame">
  <div class="rule"></div>
  <blockquote class="quote" data-slot="quote">{{quote}}</blockquote>
  <div class="foot"><div><div class="who" data-slot="attribution">{{attribution}}</div>{{#if role}}<div class="copy role" data-slot="role">{{role}}</div>{{/if}}</div>${logo}</div>
</div>`,
      css: `${base}
.quote { font-family: var(--font-${c.headingFamily}); font-size: 64px; line-height: 1.2; margin: 48px 0 0; font-style: italic; }
[data-format="landscape"] .quote { font-size: 44px; }
.who { font-size: 30px; font-weight: 600; }
.role { font-size: 26px; margin-top: 6px; }`,
      slots: [
        { name: "quote", label: "Quote", type: "text", description: "A quotation, verbatim from the source.", required: true, maxChars: 180, maxLines: 6 },
        { name: "attribution", label: "Attribution", type: "text", description: "Who said it.", required: true, maxChars: 48, maxLines: 1 },
        { name: "role", label: "Role", type: "text", description: "Their role or source.", required: false, maxChars: 60, maxLines: 2 },
      ],
      sample: { quote: "Memory held only by people ends with those people.", attribution: "A. Speaker", role: "Historian" },
    },
    {
      name: "Photo and headline",
      description: "A full-bleed image with a headline panel.",
      formats: [...ALL],
      theme: "",
      role: "single",
      html: `<div class="photo-wrap">
  {{#if (has "photo")}}<img class="photo" src="{{image "photo"}}" style="object-position: {{focus "photo"}}" alt="">{{/if}}
  <div class="panel">
    {{#if eyebrow}}<div class="eyebrow" data-slot="eyebrow">{{eyebrow}}</div>{{/if}}
    <h1 class="headline" data-slot="headline">{{headline}}</h1>
    ${logo}
  </div>
</div>`,
      css: `${base}
.photo-wrap { position: absolute; inset: 0; background: var(--${c.ground}); display: flex; flex-direction: column; }
.photo { width: 100%; flex: 1 1 auto; min-height: 0; object-fit: cover; display: block; }
.panel { background: var(--${c.ground}); color: var(--${c.text}); padding: 56px 88px 72px; display: flex; flex-direction: column; gap: 24px; font-family: var(--font-${c.bodyFamily}); }
[data-format="story"] .panel { padding-bottom: 340px; }
[data-format="landscape"] .photo-wrap { flex-direction: row; }
[data-format="landscape"] .photo { width: 50%; height: 100%; }
[data-format="landscape"] .panel { width: 50%; justify-content: center; padding: 48px; }
.headline { font-size: 64px; line-height: 1.08; }
[data-format="landscape"] .headline { font-size: 48px; }`,
      slots: [
        { name: "photo", label: "Photo", type: "image", description: "The main picture.", required: true, imageSource: "either" },
        { name: "eyebrow", label: "Eyebrow", type: "text", description: "Short label, 1–4 words.", required: false, maxChars: 32, maxLines: 1 },
        { name: "headline", label: "Headline", type: "text", description: "The main statement.", required: true, maxChars: 60, maxLines: 3 },
      ],
      sample: { eyebrow: "Feature", headline: "A headline sits under the picture" },
    },
    {
      name: "Stat",
      description: "One number, what it measures, and its source.",
      formats: [...ALL],
      theme: "",
      role: "single",
      html: `<div class="frame">
  <div class="stat" data-slot="number">{{number}}</div>
  <p class="headline what" data-slot="label">{{label}}</p>
  <div class="foot"><div class="copy source" data-slot="source">{{source}}</div>${logo}</div>
</div>`,
      css: `${base}
.stat { font-family: var(--font-${c.headingFamily}); font-size: 220px; line-height: 1; font-weight: 600; color: var(--${c.accent}); margin-top: 40px; }
[data-format="landscape"] .stat { font-size: 140px; margin-top: 0; }
.what { font-size: 52px; line-height: 1.15; margin-top: 24px; }
[data-format="landscape"] .what { font-size: 38px; }
.source { font-size: 22px; }`,
      slots: [
        { name: "number", label: "Number", type: "text", description: "The figure, with unit (e.g. 14%, 1.2M).", required: true, maxChars: 8, maxLines: 1 },
        { name: "label", label: "What it measures", type: "text", description: "What the number counts, one sentence.", required: true, maxChars: 90, maxLines: 3 },
        { name: "source", label: "Source", type: "text", description: "Where the number comes from.", required: true, maxChars: 80, maxLines: 2 },
      ],
      sample: { number: "14%", label: "of the population, by the most recent census", source: "Source: Census, 2011" },
    },
    {
      name: "Carousel cover",
      description: "First page of a carousel.",
      formats: ["square", "portrait"],
      theme: "",
      role: "cover",
      html: `<div class="frame">
  {{#if eyebrow}}<div class="eyebrow" data-slot="eyebrow">{{eyebrow}}</div>{{/if}}
  <h1 class="headline" data-slot="headline">{{headline}}</h1>
  <div class="foot"><div class="copy swipe">Swipe →</div>${logo}</div>
</div>`,
      css: `${base}
.headline { font-size: 104px; line-height: 1.04; margin-top: 40px; }
.swipe { font-size: 26px; }`,
      slots: [
        { name: "eyebrow", label: "Eyebrow", type: "text", description: "Series or topic label.", required: false, maxChars: 32, maxLines: 1 },
        { name: "headline", label: "Headline", type: "text", description: "What the carousel is about.", required: true, maxChars: 60, maxLines: 4 },
      ],
      sample: { eyebrow: "Explainer", headline: "Five things to know" },
    },
    {
      name: "Carousel page",
      description: "A numbered content page of a carousel.",
      formats: ["square", "portrait"],
      theme: "",
      role: "content",
      html: `<div class="frame">
  <div class="num">{{#if page}}{{pad2 page.index}}{{/if}}</div>
  <h2 class="headline" data-slot="title">{{title}}</h2>
  <p class="copy" data-slot="text">{{text}}</p>
  <div class="foot"><span></span>${logo}</div>
</div>`,
      css: `${base}
.num { font-family: var(--font-${c.headingFamily}); font-size: 80px; color: var(--${c.accent}); font-weight: 600; }
.headline { font-size: 64px; line-height: 1.1; margin-top: 24px; }
.copy { font-size: 34px; line-height: 1.45; margin-top: 28px; }`,
      slots: [
        { name: "title", label: "Title", type: "text", description: "Point title.", required: true, maxChars: 60, maxLines: 3 },
        { name: "text", label: "Text", type: "text", description: "Two or three sentences.", required: true, maxChars: 260, maxLines: 7 },
      ],
      sample: { title: "The first point", text: "Two or three sentences that explain the point plainly, with a concrete example." },
    },
    {
      name: "Carousel end",
      description: "Closing page with a call to action.",
      formats: ["square", "portrait"],
      theme: "",
      role: "end",
      html: `<div class="frame end">
  <h2 class="headline" data-slot="headline">{{headline}}</h2>
  {{#if cta}}<p class="copy" data-slot="cta">{{cta}}</p>{{/if}}
  <div class="foot"><span></span>${logo}</div>
</div>`,
      css: `${base}
.end { justify-content: center; }
.end .foot { margin-top: 0; position: absolute; left: 88px; right: 88px; bottom: 88px; }
.headline { font-size: 80px; line-height: 1.08; }
.copy { font-size: 34px; margin-top: 28px; }`,
      slots: [
        { name: "headline", label: "Headline", type: "text", description: "Closing line.", required: true, maxChars: 60, maxLines: 3 },
        { name: "cta", label: "Call to action", type: "text", description: "What to do next.", required: false, maxChars: 80, maxLines: 2 },
      ],
      sample: { headline: "Read the full piece", cta: "Link in bio" },
    },
    {
      name: "YouTube thumbnail",
      description: "Big headline beside a picture, for 1280 × 720 thumbnails.",
      formats: ["youtube"],
      theme: "",
      role: "single",
      html: `<div class="yt">
  {{#if (has "photo")}}<img class="photo" src="{{image "photo"}}" style="object-position: {{focus "photo"}}" alt="">{{/if}}
  <div class="panel"><h1 class="headline" data-slot="headline">{{headline}}</h1>${logo}</div>
</div>`,
      css: `${base}
.yt { position: absolute; inset: 0; display: flex; background: var(--${c.ground}); }
.photo { width: 55%; height: 100%; object-fit: cover; }
.panel { flex: 1; padding: 48px; display: flex; flex-direction: column; justify-content: space-between; color: var(--${c.text}); font-family: var(--font-${c.bodyFamily}); }
.headline { font-size: 84px; line-height: 1.02; }`,
      slots: [
        { name: "photo", label: "Photo", type: "image", description: "The thumbnail picture.", required: false, imageSource: "either" },
        { name: "headline", label: "Headline", type: "text", description: "2–5 words.", required: true, maxChars: 32, maxLines: 3 },
      ],
      sample: { headline: "Watch the lecture" },
    },
  ];
}
