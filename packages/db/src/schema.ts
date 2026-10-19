import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: created(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: created(),
});

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  createdAt: created(),
});

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const invites = pgTable("invites", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: created(),
});

export const providerKeys = pgTable(
  "provider_keys",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    encrypted: text("encrypted").notNull(),
    hint: text("hint").notNull().default(""),
    updatedAt: created(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.provider] })],
);

export const projects = pgTable("projects", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  handle: text("handle").notNull().default(""),
  settings: jsonb("settings").notNull().default({}),
  currentDesignSystemVersionId: uuid("current_ds_version_id"),
  createdAt: created(),
});

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const designSystemVersions = pgTable(
  "design_system_versions",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    namespace: text("namespace").notNull().default(""),
    tokens: jsonb("tokens").notNull(),
    readme: text("readme").notNull().default(""),
    sections: jsonb("sections").notNull().default([]),
    voice: text("voice").notNull().default(""),
    groupNotes: jsonb("group_notes").notNull().default({}),
    components: jsonb("components").notNull().default([]),
    warnings: jsonb("warnings").notNull().default([]),
    status: text("status").notNull().default("draft"),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("ds_versions_project_version").on(t.projectId, t.version)],
);

export const dsFiles = pgTable(
  "ds_files",
  {
    id: id(),
    versionId: uuid("version_id").notNull().references(() => designSystemVersions.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // font | asset
    path: text("path").notNull(),
    group: text("group").notNull().default(""),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
  },
  (t) => [uniqueIndex("ds_files_version_path").on(t.versionId, t.path)],
);

export const templates = pgTable("templates", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: text("role").notNull().default("single"),
  archived: boolean("archived").notNull().default(false),
  currentVersionId: uuid("current_version_id"),
  createdAt: created(),
});

export const templateVersions = pgTable(
  "template_versions",
  {
    id: id(),
    templateId: uuid("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    spec: jsonb("spec").notNull(),
    designSystemVersionId: uuid("ds_version_id").notNull(),
    /** format -> storage key of the golden snapshot PNG */
    golden: jsonb("golden").notNull().default({}),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [uniqueIndex("template_versions_tpl_version").on(t.templateId, t.version)],
);

export const assets = pgTable(
  "assets",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // upload | generated | website
    name: text("name").notNull().default(""),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256").notNull(),
    tags: jsonb("tags").notNull().default([]),
    generation: jsonb("generation"),
    paletteDistance: real("palette_distance"),
    approved: boolean("approved").notNull().default(false),
    sourceUrl: text("source_url"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [index("assets_project").on(t.projectId, t.createdAt)],
);

export const posts = pgTable(
  "posts",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    kind: text("kind").notNull().default("single"), // single | carousel
    status: text("status").notNull().default("draft"), // draft | ready | scheduled | published
    brief: text("brief").notNull().default(""),
    caption: text("caption").notNull().default(""),
    hashtags: jsonb("hashtags").notNull().default([]),
    altText: text("alt_text").notNull().default(""),
    sourceUrls: jsonb("source_urls").notNull().default([]),
    formats: jsonb("formats").notNull().default([]),
    /** The design-system version this post renders with (pinned for predictability). */
    designSystemVersionId: uuid("ds_version_id").notNull(),
    copyMeta: jsonb("copy_meta"),
    batchId: uuid("batch_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("posts_project").on(t.projectId, t.createdAt)],
);

export const postPages = pgTable(
  "post_pages",
  {
    id: id(),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    templateVersionId: uuid("template_version_id").notNull().references(() => templateVersions.id),
    slots: jsonb("slots").notNull().default({}),
  },
  (t) => [uniqueIndex("post_pages_post_index").on(t.postId, t.index)],
);

export const renders = pgTable(
  "renders",
  {
    id: id(),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").references(() => postPages.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    recipe: jsonb("recipe").notNull(),
    recipeHash: text("recipe_hash").notNull(),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    report: jsonb("report").notNull(),
    passed: boolean("passed").notNull(),
    saved: boolean("saved").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [index("renders_post").on(t.postId, t.createdAt), index("renders_hash").on(t.recipeHash)],
);

export const sources = pgTable("sources", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  maxPages: integer("max_pages").notNull().default(200),
  pathPrefix: text("path_prefix").notNull().default(""),
  renderJs: boolean("render_js").notNull().default(false),
  intervalHours: integer("interval_hours").notNull().default(24),
  /** {templateId, entityTypes, formats} — draft posts for new pages */
  autoDraft: jsonb("auto_draft"),
  status: text("status").notNull().default("idle"),
  lastError: text("last_error"),
  lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: created(),
});

export const webPages = pgTable(
  "web_pages",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    image: text("image"),
    publishedAt: text("published_at"),
    text: text("text").notNull().default(""),
    headings: jsonb("headings").notNull().default([]),
    contentHash: text("content_hash").notNull(),
    firstSeenAt: created(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("web_pages_project_url").on(t.projectId, t.url)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").notNull().references(() => webPages.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    text: text("text").notNull(),
    embedding: real("embedding").array(),
  },
  (t) => [index("chunks_fts").using("gin", sql`to_tsvector('simple', ${t.text})`), index("chunks_project").on(t.projectId)],
);

export const entities = pgTable(
  "entities",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").notNull().references(() => webPages.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    schemaType: text("schema_type").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    url: text("url"),
    image: text("image"),
    date: text("date"),
    data: jsonb("data").notNull().default({}),
  },
  (t) => [index("entities_project_type").on(t.projectId, t.type)],
);

export const channels = pgTable("channels", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // instagram | linkedin
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
  tokenEncrypted: text("token_encrypted").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: created(),
});

export const publications = pgTable(
  "publications",
  {
    id: id(),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    status: text("status").notNull().default("scheduled"), // scheduled | publishing | published | failed | cancelled
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    externalId: text("external_id"),
    url: text("url"),
    error: text("error"),
    jobId: uuid("job_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [index("publications_post").on(t.postId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("queued"), // queued | running | done | failed | cancelled
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    progress: text("progress").notNull().default(""),
    error: text("error"),
    result: jsonb("result"),
    projectId: uuid("project_id"),
    createdBy: uuid("created_by"),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobs_queue").on(t.status, t.runAt), index("jobs_project").on(t.projectId, t.createdAt)],
);

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: created(),
});
