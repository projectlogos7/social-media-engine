import type { TemplateSpec } from "@sme/core";

/**
 * Hand-built templates for the ISMII design system (seed data). Square and
 * story use the brand's post frames (signature and gold rule baked in), so
 * content lives in an overflow-hidden box above the rule: anything that does
 * not fit is reported, never silently clipped. Portrait and landscape are
 * built natively with the supplied lockups.
 */

const SHARED = `
.ground { position: absolute; inset: 0; background-size: 100% 100%; background-repeat: no-repeat; }
.box { position: absolute; left: 80px; right: 80px; top: 96px; height: 760px; display: flex; flex-direction: column; overflow: hidden; }
[data-format="story"] .box { top: 260px; height: 1200px; }
[data-format="portrait"] .box { top: 104px; height: 980px; }
[data-format="landscape"] .box { left: 64px; right: 64px; top: 56px; height: 400px; }
.eyebrow { font-family: var(--font-sans); font-weight: 600; font-size: 26px; line-height: 32px; letter-spacing: 0.12em; text-transform: uppercase; }
.sig { position: absolute; left: 80px; right: 80px; }
.sig .rule { height: 2px; }
.sig img { display: block; height: 72px; width: auto; margin-top: 44px; }
[data-format="portrait"] .sig { top: 1150px; }
[data-format="landscape"] .sig { left: 64px; right: 64px; top: 490px; }
[data-format="landscape"] .sig img { height: 56px; margin-top: 28px; }
`;

const IVORY_GROUND = `
.ground { background-color: var(--marble-ivory); }
[data-format="square"] .ground { background-image: url('{{asset "Social-templates/ismii-post-frame-square-1080x1080-ivory.png"}}'); }
[data-format="story"] .ground { background-image: url('{{asset "Social-templates/ismii-story-frame-1080x1920-ivory.png"}}'); }
[data-format="landscape"] .ground { background-color: var(--warm-marble); }
.sig .rule { background: var(--deep-gold); }
`;

const IVORY_SIG = `{{#if (eq format.id "portrait")}}<div class="sig"><div class="rule"></div><img data-role="logo" src="{{asset "Lockups/ismii-lockup-horizontal-full-colour.svg"}}" alt="ISMII"></div>{{/if}}{{#if (eq format.id "landscape")}}<div class="sig"><div class="rule"></div><img data-role="logo" src="{{asset "Lockups/ismii-lockup-horizontal-full-colour.svg"}}" alt="ISMII"></div>{{/if}}`;

export const ISMII_TEMPLATES: TemplateSpec[] = [
  {
    name: "Lecture announcement",
    description: "Event post for lectures, seminars and book talks: label, title, speaker, affiliation, date and venue. Sandstone for announcements; ivory on stories.",
    formats: ["square", "story", "portrait", "landscape"],
    theme: "ivory",
    role: "single",
    html: `<div class="ground"></div>
<div class="box">
  <div class="eyebrow" data-slot="kind">{{kind}}</div>
  <h1 class="title" data-slot="title">{{title}}</h1>
  <div class="who">
    <div class="speaker" data-slot="speaker">{{speaker}}</div>
    {{#if affiliation}}<div class="aff" data-slot="affiliation">{{affiliation}}</div>{{/if}}
    <div class="when" data-slot="when">{{when}}</div>
  </div>
</div>
{{#if (eq format.id "portrait")}}<div class="sig"><div class="rule"></div><img data-role="logo" src="{{asset "Lockups/ismii-lockup-horizontal-mono-ivory.svg"}}" alt="ISMII"></div>{{/if}}
{{#if (eq format.id "landscape")}}<div class="sig"><div class="rule"></div><img data-role="logo" src="{{asset "Lockups/ismii-lockup-horizontal-mono-ivory.svg"}}" alt="ISMII"></div>{{/if}}`,
    css: `${SHARED}
.ground { background-color: var(--sandstone-red); }
[data-format="square"] .ground { background-image: url('{{asset "Social-templates/ismii-post-frame-square-1080x1080-sandstone.png"}}'); }
[data-format="story"] .ground { background-color: var(--marble-ivory); background-image: url('{{asset "Social-templates/ismii-story-frame-1080x1920-ivory.png"}}'); }
.box, .eyebrow, .title, .speaker, .aff, .when { color: var(--marble-ivory); }
[data-format="story"] .eyebrow { color: var(--sandstone-red); }
[data-format="story"] .title, [data-format="story"] .speaker, [data-format="story"] .aff, [data-format="story"] .when { color: var(--india-ink); }
.title { font-family: var(--font-serif); font-weight: 600; font-size: 92px; line-height: 98px; margin: 36px 0 0; }
[data-format="landscape"] .title { font-size: 60px; line-height: 66px; margin-top: 20px; }
[data-format="story"] .title { font-size: 104px; line-height: 110px; }
.who { margin-top: auto; }
.speaker { font-family: var(--font-sans); font-weight: 600; font-size: 38px; line-height: 48px; }
.aff { font-family: var(--font-sans); font-size: 30px; line-height: 40px; margin-top: 4px; }
.when { font-family: var(--font-mono); font-size: 27px; line-height: 36px; letter-spacing: 0.04em; text-transform: uppercase; margin-top: 28px; }
[data-format="landscape"] .speaker { font-size: 28px; line-height: 36px; }
[data-format="landscape"] .aff { font-size: 22px; line-height: 30px; }
[data-format="landscape"] .when { font-size: 20px; margin-top: 14px; }
.sig .rule { background: var(--rosette-gold); }`,
    slots: [
      { name: "kind", label: "Event label", type: "choice", description: "The kind of event.", required: true, options: ["ISMII Lecture", "ISMII Seminar", "ISMII Book Talk", "ISMII Workshop", "ISMII Conference"] },
      { name: "title", label: "Title", type: "text", description: "The lecture title, in sentence case, as the speaker gave it.", required: true, maxChars: 80, maxLines: 4 },
      { name: "speaker", label: "Speaker", type: "text", description: "Speaker's full name, with diacritics as the source has them.", required: true, maxChars: 40, maxLines: 1 },
      { name: "affiliation", label: "Affiliation", type: "text", description: "Department and university.", required: false, maxChars: 60, maxLines: 2 },
      { name: "when", label: "Date, time and venue", type: "text", description: "Like: SAT 9 JAN 2027 · 11:00 CT · ZOOM", required: true, maxChars: 48, maxLines: 1 },
    ],
    sample: { kind: "ISMII Lecture", title: "Coast before conquest: Islam on the Malabar shore", speaker: "Speaker Name", affiliation: "Department of History, University", when: "SAT 9 JAN 2027 · 11:00 CT · ZOOM" },
  },
  {
    name: "Text post",
    description: "A text-led post on the ivory frame: optional label, a headline and a supporting paragraph. For statements, research notes and announcements without a picture.",
    formats: ["square", "portrait", "story", "landscape"],
    theme: "ivory",
    role: "single",
    html: `<div class="ground"></div>
<div class="box">
  {{#if eyebrow}}<div class="eyebrow" data-slot="eyebrow">{{eyebrow}}</div>{{/if}}
  <h1 class="headline" data-slot="headline">{{headline}}</h1>
  {{#if body}}<p class="para" data-slot="body">{{body}}</p>{{/if}}
  {{#if source}}<div class="source" data-slot="source">{{source}}</div>{{/if}}
</div>
${IVORY_SIG}`,
    css: `${SHARED}${IVORY_GROUND}
.eyebrow { color: var(--sandstone-red); margin-bottom: 32px; }
.headline { font-family: var(--font-serif); font-weight: 600; font-size: 84px; line-height: 92px; color: var(--india-ink); margin: 0; }
[data-format="landscape"] .headline { font-size: 56px; line-height: 62px; }
.para { font-family: var(--font-sans); font-size: 34px; line-height: 50px; color: var(--india-ink); margin: 36px 0 0; max-width: 880px; }
[data-format="landscape"] .para { font-size: 24px; line-height: 34px; margin-top: 20px; }
.source { margin-top: auto; font-family: var(--font-sans); font-size: 24px; line-height: 32px; color: var(--india-ink); }`,
    slots: [
      { name: "eyebrow", label: "Label", type: "text", description: "Short label in capitals, e.g. RESEARCH NOTE. Two to four words.", required: false, maxChars: 28, maxLines: 1 },
      { name: "headline", label: "Headline", type: "text", description: "One clear statement, sentence case, no em dashes.", required: true, maxChars: 90, maxLines: 4 },
      { name: "body", label: "Paragraph", type: "text", description: "One or two plain sentences that support the headline.", required: false, maxChars: 220, maxLines: 5 },
      { name: "source", label: "Source", type: "text", description: "Where a fact or figure comes from, e.g. Source: Sachar Committee Report, 2006.", required: false, maxChars: 80, maxLines: 2 },
    ],
    sample: { eyebrow: "Research note", headline: "Islam reached the Malabar coast through trade, centuries before conquest", body: "Arab merchants settled in the port towns of Kerala from the seventh century. Their communities kept records we are still reading.", source: "" },
  },
  {
    name: "Pull quote",
    description: "A quotation in Spectral italic with the speaker and their role, on the ivory frame.",
    formats: ["square", "portrait", "story", "landscape"],
    theme: "ivory",
    role: "single",
    html: `<div class="ground"></div>
<div class="box">
  <div class="mark"></div>
  <blockquote class="quote" data-slot="quote">{{quote}}</blockquote>
  <div class="by">
    <div class="name" data-slot="attribution">{{attribution}}</div>
    {{#if role}}<div class="role" data-slot="role">{{role}}</div>{{/if}}
  </div>
</div>
${IVORY_SIG}`,
    css: `${SHARED}${IVORY_GROUND}
.mark { width: 96px; height: 3px; background: var(--deep-gold); }
.quote { font-family: var(--font-quote); font-style: italic; font-size: 64px; line-height: 88px; color: var(--india-ink); margin: 48px 0 0; }
[data-format="landscape"] .quote { font-size: 40px; line-height: 54px; margin-top: 24px; }
.by { margin-top: auto; }
.name { font-family: var(--font-sans); font-weight: 600; font-size: 34px; line-height: 44px; color: var(--india-ink); }
.role { font-family: var(--font-sans); font-size: 28px; line-height: 38px; color: var(--india-ink); margin-top: 4px; }
[data-format="landscape"] .name { font-size: 24px; line-height: 32px; }
[data-format="landscape"] .role { font-size: 20px; line-height: 28px; }`,
    slots: [
      { name: "quote", label: "Quotation", type: "text", description: "Verbatim from the source. Never paraphrase a quotation.", required: true, maxChars: 170, maxLines: 6 },
      { name: "attribution", label: "Who said it", type: "text", description: "Full name.", required: true, maxChars: 40, maxLines: 1 },
      { name: "role", label: "Role or source", type: "text", description: "Their role, or the work quoted.", required: false, maxChars: 70, maxLines: 2 },
    ],
    sample: { quote: "Memory held only by people ends with those people.", attribution: "ISMII", role: "From the Institute's launch film" },
  },
  {
    name: "Photo feature",
    description: "A photograph with a headline on an India Ink band and the reversed signature. For people, places, manuscripts and buildings.",
    formats: ["square", "portrait", "landscape"],
    theme: "ink",
    role: "single",
    html: `<div class="wrap">
  <div class="pic">{{#if (has "photo")}}<img src="{{image "photo"}}" style="object-position: {{focus "photo"}}" alt="">{{/if}}</div>
  <div class="band">
    {{#if eyebrow}}<div class="eyebrow" data-slot="eyebrow">{{eyebrow}}</div>{{/if}}
    <h1 class="headline" data-slot="headline">{{headline}}</h1>
    <div class="rule"></div>
    <img class="lockup" data-role="logo" src="{{asset "Lockups/ismii-lockup-horizontal-reversed.svg"}}" alt="ISMII">
  </div>
</div>`,
    css: `.wrap { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--india-ink); }
.pic { flex: 1 1 auto; min-height: 0; background: var(--warm-marble); }
.pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
.band { flex: none; padding: 48px 80px 56px; background: var(--india-ink); display: flex; flex-direction: column; }
.eyebrow { font-family: var(--font-sans); font-weight: 600; font-size: 24px; line-height: 30px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted-sand); margin-bottom: 18px; }
.headline { font-family: var(--font-serif); font-weight: 600; font-size: 64px; line-height: 70px; color: var(--marble-ivory); margin: 0; max-height: 210px; overflow: hidden; }
.rule { height: 2px; background: var(--rosette-gold); margin: 36px 0 30px; }
.lockup { height: 60px; width: auto; display: block; align-self: flex-start; }
[data-format="landscape"] .wrap { flex-direction: row; }
[data-format="landscape"] .pic { width: 560px; flex: none; }
[data-format="landscape"] .band { flex: 1; padding: 48px 56px; justify-content: center; }
[data-format="landscape"] .headline { font-size: 50px; line-height: 56px; max-height: 280px; }
[data-format="landscape"] .lockup { height: 48px; }`,
    slots: [
      { name: "photo", label: "Photo", type: "image", description: "Natural light, real places, documents and people at work. No heavy filters.", required: true, imageSource: "either" },
      { name: "eyebrow", label: "Label", type: "text", description: "Two to four words, e.g. FROM THE ARCHIVE.", required: false, maxChars: 28, maxLines: 1 },
      { name: "headline", label: "Headline", type: "text", description: "What the picture shows and why it matters.", required: true, maxChars: 70, maxLines: 3 },
    ],
    sample: { eyebrow: "From the archive", headline: "A reading room in Hyderabad, 1932" },
  },
  {
    name: "Key figure",
    description: "One statistic in Sandstone Red with what it measures and its source. Figures always carry a source.",
    formats: ["square", "portrait", "landscape"],
    theme: "ivory",
    role: "single",
    html: `<div class="ground"></div>
<div class="box">
  {{#if eyebrow}}<div class="eyebrow" data-slot="eyebrow">{{eyebrow}}</div>{{/if}}
  <div class="figure" data-slot="figure">{{figure}}</div>
  <p class="measure" data-slot="label">{{label}}</p>
  <div class="source" data-slot="source">{{source}}</div>
</div>
${IVORY_SIG}`,
    css: `${SHARED}${IVORY_GROUND}
.eyebrow { color: var(--sandstone-red); }
.figure { font-family: var(--font-serif); font-weight: 600; font-size: 240px; line-height: 240px; color: var(--sandstone-red); margin-top: 24px; }
[data-format="landscape"] .figure { font-size: 150px; line-height: 150px; margin-top: 8px; }
.measure { font-family: var(--font-serif); font-weight: 600; font-size: 56px; line-height: 64px; color: var(--india-ink); margin: 24px 0 0; }
[data-format="landscape"] .measure { font-size: 38px; line-height: 44px; margin-top: 12px; }
.source { margin-top: auto; font-family: var(--font-sans); font-size: 24px; line-height: 32px; color: var(--india-ink); }
[data-format="landscape"] .source { font-size: 18px; line-height: 24px; }`,
    slots: [
      { name: "eyebrow", label: "Label", type: "text", description: "Topic in two to four words.", required: false, maxChars: 28, maxLines: 1 },
      { name: "figure", label: "Figure", type: "text", description: "The number with its unit, as figures: 14.2%, 172M, 1857.", required: true, maxChars: 7, maxLines: 1 },
      { name: "label", label: "What it measures", type: "text", description: "Plain description; say projected or estimated when it is.", required: true, maxChars: 80, maxLines: 3 },
      { name: "source", label: "Source", type: "text", description: "Source: Publication, year.", required: true, maxChars: 80, maxLines: 2 },
    ],
    sample: { eyebrow: "Census", figure: "14.2%", label: "of India's population were Muslim in the 2011 census", source: "Source: Census of India, 2011" },
  },
  {
    name: "Carousel cover",
    description: "First page of a carousel on Sandstone Red with the mono-ivory lockup.",
    formats: ["portrait", "square"],
    theme: "ivory",
    role: "cover",
    html: `<div class="cover">
  {{#if eyebrow}}<div class="eyebrow" data-slot="eyebrow">{{eyebrow}}</div>{{/if}}
  <h1 class="headline" data-slot="headline">{{headline}}</h1>
  <div class="foot"><div class="rule"></div><img data-role="logo" src="{{asset "Lockups/ismii-lockup-horizontal-mono-ivory.svg"}}" alt="ISMII"></div>
</div>`,
    css: `.cover { position: absolute; inset: 0; background: var(--sandstone-red); padding: 104px 80px 0; display: flex; flex-direction: column; }
.eyebrow { font-family: var(--font-sans); font-weight: 600; font-size: 26px; line-height: 32px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--marble-ivory); }
.headline { font-family: var(--font-serif); font-weight: 600; font-size: 104px; line-height: 110px; color: var(--marble-ivory); margin: 36px 0 0; max-height: 660px; overflow: hidden; }
[data-format="square"] .headline { font-size: 92px; line-height: 98px; max-height: 500px; }
.foot { position: absolute; left: 80px; right: 80px; bottom: 96px; }
.rule { height: 2px; background: var(--rosette-gold); margin-bottom: 44px; }
.foot img { height: 72px; width: auto; display: block; }`,
    slots: [
      { name: "eyebrow", label: "Series", type: "text", description: "Series or topic, two to four words.", required: false, maxChars: 28, maxLines: 1 },
      { name: "headline", label: "Headline", type: "text", description: "What the carousel explains.", required: true, maxChars: 70, maxLines: 5 },
    ],
    sample: { eyebrow: "Explainer", headline: "Five ports that brought Islam to India" },
  },
  {
    name: "Carousel page",
    description: "A numbered content page of a carousel on Marble Ivory.",
    formats: ["portrait", "square"],
    theme: "ivory",
    role: "content",
    html: `<div class="pg">
  <div class="num">{{#if page}}{{pad2 page.index}}{{/if}}</div>
  <h2 class="title" data-slot="title">{{title}}</h2>
  <p class="text" data-slot="text">{{text}}</p>
  <div class="foot"><div class="rule"></div><img data-role="logo" src="{{asset "Mark/ismii-mark-sandstone.svg"}}" alt="ISMII"><span class="pageno">{{#if page}}{{page.index}} / {{page.count}}{{/if}}</span></div>
</div>`,
    css: `.pg { position: absolute; inset: 0; background: var(--marble-ivory); padding: 104px 80px 0; display: flex; flex-direction: column; }
.num { font-family: var(--font-serif); font-weight: 600; font-size: 96px; line-height: 96px; color: var(--sandstone-red); }
.title { font-family: var(--font-serif); font-weight: 600; font-size: 68px; line-height: 76px; color: var(--india-ink); margin: 32px 0 0; }
.text { font-family: var(--font-sans); font-size: 34px; line-height: 52px; color: var(--india-ink); margin: 32px 0 0; max-height: 520px; overflow: hidden; }
[data-format="square"] .text { max-height: 312px; }
[data-format="square"] .title { font-size: 56px; line-height: 64px; }
.foot { position: absolute; left: 80px; right: 80px; bottom: 80px; display: flex; align-items: center; gap: 24px; }
.rule { position: absolute; left: 0; right: 0; top: -40px; height: 2px; background: var(--deep-gold); }
.foot img { height: 56px; width: 56px; }
.pageno { margin-left: auto; font-family: var(--font-mono); font-size: 24px; color: var(--india-ink); letter-spacing: 0.04em; }`,
    slots: [
      { name: "title", label: "Point", type: "text", description: "The point of this page in a few words.", required: true, maxChars: 50, maxLines: 2 },
      { name: "text", label: "Explanation", type: "text", description: "Two or three plain sentences with one concrete detail.", required: true, maxChars: 260, maxLines: 10 },
    ],
    sample: { title: "Calicut", text: "Arab traders settled here long before any sultanate existed in the north. The Zamorin's port grew rich on the pepper trade and welcomed the merchants who brought their faith with them." },
  },
  {
    name: "Carousel end",
    description: "Closing page: one line and what to do next, with the stacked lockup.",
    formats: ["portrait", "square"],
    theme: "ivory",
    role: "end",
    html: `<div class="end">
  <h2 class="headline" data-slot="headline">{{headline}}</h2>
  {{#if cta}}<p class="cta" data-slot="cta">{{cta}}</p>{{/if}}
  <img class="lockup" data-role="logo" src="{{asset "Lockups/ismii-lockup-stacked-full-colour.svg"}}" alt="ISMII">
</div>`,
    css: `.end { position: absolute; inset: 0; background: var(--warm-marble); padding: 160px 80px 0; display: flex; flex-direction: column; align-items: center; text-align: center; }
.headline { font-family: var(--font-serif); font-weight: 600; font-size: 76px; line-height: 84px; color: var(--india-ink); margin: 0; max-height: 340px; overflow: hidden; }
.cta { font-family: var(--font-sans); font-size: 32px; line-height: 44px; color: var(--deccani-teal); margin: 32px 0 0; }
.lockup { position: absolute; bottom: 120px; left: 50%; transform: translateX(-50%); height: 220px; width: auto; }
[data-format="square"] .lockup { height: 180px; bottom: 90px; }
[data-format="square"] .end { padding-top: 120px; }`,
    slots: [
      { name: "headline", label: "Closing line", type: "text", description: "One sentence that closes the story.", required: true, maxChars: 70, maxLines: 4 },
      { name: "cta", label: "Next step", type: "text", description: "e.g. Read the full essay at ismii.org", required: false, maxChars: 60, maxLines: 2 },
    ],
    sample: { headline: "The coast kept a record the capital did not.", cta: "Read the full essay at ismii.org" },
  },
];
