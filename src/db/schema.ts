/**
 * Complete schema for the Guaraní video engine — plan §2.
 *
 * Every table the whole build needs is created in opus-1, on purpose: later
 * phases never migrate (plan §5.1), and Sonnet phases are forbidden from
 * touching schema at all (plan §6). If a later phase wants a column, it goes to
 * KNOWN-ISSUES.md and the Backlog, not into a migration.
 */

import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  decimal,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

const timestamps = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
};

/** Single admin role for MVP. Modeled as an enum so adding agent/client later is additive. */
export const users = mysqlTable("users", {
  id: int("id").primaryKey().autoincrement(),
  email: varchar("email", { length: 255 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["admin"]).notNull().default("admin"),
  ...timestamps,
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

/**
 * The shared root. Scripts and videos hang off projects, not listings, so the
 * §11 content-service reuse (kind='content_item') is additive, not a migration.
 */
export const projects = mysqlTable("projects", {
  id: int("id").primaryKey().autoincrement(),
  kind: mysqlEnum("kind", ["listing", "content_item"]).notNull().default("listing"),
  title: varchar("title", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["draft", "active", "archived"])
    .notNull()
    .default("draft"),
  ...timestamps,
}, (t) => [index("projects_kind_status_idx").on(t.kind, t.status)]);

/**
 * Typed detail table for kind='listing'. Source of truth for facts a script may
 * state — plan §3.1: nothing else may supply a fact.
 */
export const listings = mysqlTable("listings", {
  id: int("id").primaryKey().autoincrement(),
  projectId: int("project_id").notNull().references(() => projects.id),
  address: varchar("address", { length: 255 }).notNull(),
  neighborhood: varchar("neighborhood", { length: 128 }),
  city: varchar("city", { length: 128 }),
  price: decimal("price", { precision: 15, scale: 2 }),
  currency: mysqlEnum("currency", ["PYG", "USD"]).notNull().default("PYG"),
  rooms: int("rooms"),
  bathrooms: int("bathrooms"),
  areaM2: decimal("area_m2", { precision: 10, scale: 2 }),
  features: json("features").$type<string[]>(),
  status: mysqlEnum("status", ["draft", "available", "sold", "withdrawn"])
    .notNull()
    .default("draft"),
  ...timestamps,
}, (t) => [uniqueIndex("listings_project_idx").on(t.projectId)]);

/** Photos/clips supplied for a listing. opus-3 composites these; opus-4 adds generated b-roll. */
export const listingMedia = mysqlTable("listing_media", {
  id: int("id").primaryKey().autoincrement(),
  listingId: int("listing_id").notNull().references(() => listings.id),
  kind: mysqlEnum("kind", ["photo", "clip"]).notNull().default("photo"),
  url: varchar("url", { length: 1024 }).notNull(),
  sortOrder: int("sort_order").notNull().default(0),
  ...timestamps,
}, (t) => [index("listing_media_listing_idx").on(t.listingId)]);

export const scripts = mysqlTable("scripts", {
  id: int("id").primaryKey().autoincrement(),
  projectId: int("project_id").notNull().references(() => projects.id),
  language: mysqlEnum("language", ["es", "gn"]).notNull(),
  status: mysqlEnum("status", ["draft", "approved"]).notNull().default("draft"),
  ...timestamps,
}, (t) => [uniqueIndex("scripts_project_lang_idx").on(t.projectId, t.language)]);

/**
 * The dual-string model (plan §11.1). display_text is proper orthography for
 * captions and UI; speech_text is what gets fed to TTS. Never merge these.
 */
export const scriptLines = mysqlTable("script_lines", {
  id: int("id").primaryKey().autoincrement(),
  scriptId: int("script_id").notNull().references(() => scripts.id),
  lineNumber: int("line_number").notNull(),
  displayText: text("display_text").notNull(),
  speechText: text("speech_text").notNull(),
  /** Set by opus-2 when any term in the line resolved only provisionally. */
  provisional: boolean("provisional").notNull().default(false),
  ...timestamps,
}, (t) => [uniqueIndex("script_lines_script_no_idx").on(t.scriptId, t.lineNumber)]);

/**
 * The compounding IP (plan §11 defensibility). One row per term; the actual
 * respellings live in lexicon_pronunciations because they are engine-specific.
 */
export const joparaLexicon = mysqlTable("jopara_lexicon", {
  id: int("id").primaryKey().autoincrement(),
  term: varchar("term", { length: 255 }).notNull(),
  language: mysqlEnum("language", ["gn", "es", "jopara"]).notNull(),
  /** Nullable — filled when known, so SSML-capable providers can derive pronunciation. */
  ipa: varchar("ipa", { length: 255 }),
  /**
   * Must record stress placement: Guaraní defaults to final-syllable stress,
   * Spanish engines to penultimate. That mismatch is the single most common
   * mispronunciation cause (plan §2).
   */
  notes: text("notes"),
  ...timestamps,
}, (t) => [uniqueIndex("jopara_lexicon_term_lang_idx").on(t.term, t.language)]);

/**
 * Respellings are ENGINE-specific: a form tuned for one engine mispronounces on
 * another. Hence per-engine rows, never one global speech_form column.
 * engine='default' is the fallback used when no engine-specific row exists.
 */
export const lexiconPronunciations = mysqlTable("lexicon_pronunciations", {
  id: int("id").primaryKey().autoincrement(),
  termId: int("term_id").notNull().references(() => joparaLexicon.id),
  engine: varchar("engine", { length: 64 }).notNull().default("default"),
  speechForm: varchar("speech_form", { length: 255 }).notNull(),
  /** True only once a competent Guaraní speaker listened to sampleAudioUrl and approved. */
  verified: boolean("verified").notNull().default(false),
  verifiedBy: varchar("verified_by", { length: 128 }),
  verifiedAt: timestamp("verified_at"),
  /** The evidence behind `verified`. Without it, `verified` is decoration (plan §7). */
  sampleAudioUrl: varchar("sample_audio_url", { length: 1024 }),
  ...timestamps,
}, (t) => [uniqueIndex("lexicon_pron_term_engine_idx").on(t.termId, t.engine)]);

/**
 * The operational safety valve for the project's biggest technical risk.
 * Populated by opus-2's detection rule (plan §5.2); promoted into the lexicon
 * through the sonnet-1 dashboard.
 */
export const unresolvedTerms = mysqlTable("unresolved_terms", {
  id: int("id").primaryKey().autoincrement(),
  term: varchar("term", { length: 255 }).notNull(),
  language: mysqlEnum("language", ["gn", "es", "jopara"]).notNull(),
  scriptLineId: int("script_line_id").references(() => scriptLines.id),
  occurrences: int("occurrences").notNull().default(1),
  status: mysqlEnum("status", ["open", "promoted", "ignored"])
    .notNull()
    .default("open"),
  ...timestamps,
}, (t) => [
  uniqueIndex("unresolved_terms_term_lang_idx").on(t.term, t.language),
  index("unresolved_terms_status_idx").on(t.status),
]);

/**
 * One row per (voice, engine) combination tested, so A/B results are queryable
 * rather than anecdotal. providerParams carries the full provider addressing
 * tuple — Higgsfield needs model + variant + voice_type + voice_id, and that
 * shape is provider-specific, so it stays JSON rather than leaking into columns.
 */
export const voices = mysqlTable("voices", {
  id: int("id").primaryKey().autoincrement(),
  provider: varchar("provider", { length: 64 }).notNull(),
  providerVoiceId: varchar("provider_voice_id", { length: 255 }).notNull(),
  engine: varchar("engine", { length: 64 }).notNull(),
  providerParams: json("provider_params").$type<Record<string, unknown>>(),
  language: mysqlEnum("language", ["es", "gn", "multi"]).notNull().default("multi"),
  label: varchar("label", { length: 128 }).notNull(),
  sampleUrl: varchar("sample_url", { length: 1024 }),
  ...timestamps,
}, (t) => [
  uniqueIndex("voices_provider_voice_engine_idx").on(
    t.provider,
    t.providerVoiceId,
    t.engine,
  ),
]);

/**
 * Polymorphic job log. Every provider call gets a row here — nothing calls a
 * provider without one.
 *
 * Cost is stored twice on purpose (plan §2): the raw provider unit for audit,
 * and normalized USD for the §8 pricing conversation. Credits-per-USD varies by
 * plan and provider, so credits alone cannot answer "what does a video cost".
 */
export const generationJobs = mysqlTable("generation_jobs", {
  id: int("id").primaryKey().autoincrement(),
  kind: mysqlEnum("kind", ["tts", "video", "image"]).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  engine: varchar("engine", { length: 64 }),
  providerJobId: varchar("provider_job_id", { length: 255 }),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed"])
    .notNull()
    .default("pending"),
  /** What was requested — e.g. {"scriptLineId":42} or {"listingId":7,"scene":2}. */
  inputRef: json("input_ref").$type<Record<string, unknown>>(),
  /** OUR storage URL, written after download. This is the durable one. */
  outputUrl: varchar("output_url", { length: 1024 }),
  /** Kept for reference and assumed to expire. Never depended on (plan §1). */
  providerOutputUrl: varchar("provider_output_url", { length: 1024 }),
  durationMs: int("duration_ms"),
  costRawAmount: decimal("cost_raw_amount", { precision: 12, scale: 4 }),
  costRawUnit: varchar("cost_raw_unit", { length: 32 }),
  costUsd: decimal("cost_usd", { precision: 12, scale: 6 }),
  error: text("error"),
  ...timestamps,
}, (t) => [
  index("generation_jobs_kind_status_idx").on(t.kind, t.status),
  index("generation_jobs_provider_idx").on(t.provider),
]);

/** Maps raw provider units → USD, so cost_usd is a computed fact, not a guess. */
export const providerRates = mysqlTable("provider_rates", {
  id: int("id").primaryKey().autoincrement(),
  provider: varchar("provider", { length: 64 }).notNull(),
  unit: varchar("unit", { length: 32 }).notNull(),
  usdPerUnit: decimal("usd_per_unit", { precision: 12, scale: 6 }).notNull(),
  planLabel: varchar("plan_label", { length: 64 }),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  ...timestamps,
}, (t) => [
  index("provider_rates_lookup_idx").on(t.provider, t.unit, t.effectiveFrom),
]);

/** The finished deliverable. Default aspect is 9:16 per the §1 delivery spec. */
export const videos = mysqlTable("videos", {
  id: int("id").primaryKey().autoincrement(),
  projectId: int("project_id").notNull().references(() => projects.id),
  language: mysqlEnum("language", ["es", "gn"]).notNull(),
  voiceId: int("voice_id").references(() => voices.id),
  scriptId: int("script_id").references(() => scripts.id),
  aspect: mysqlEnum("aspect", ["9:16", "16:9"]).notNull().default("9:16"),
  status: mysqlEnum("status", ["pending", "rendering", "completed", "failed"])
    .notNull()
    .default("pending"),
  finalVideoUrl: varchar("final_video_url", { length: 1024 }),
  /** Rollup in USD, summed from every generation_job that fed this video. */
  totalCostUsd: decimal("total_cost_usd", { precision: 12, scale: 6 }),
  ...timestamps,
}, (t) => [index("videos_project_lang_idx").on(t.projectId, t.language)]);
