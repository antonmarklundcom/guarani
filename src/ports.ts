/**
 * Repository ports.
 *
 * opus-1 kept Higgsfield behind an interface so a provider swap is a new file
 * rather than a rewrite. These do the same job for persistence, for a smaller
 * but more immediate reason: the script, TTS and A/B services are the parts of
 * this system that most need to be tested exhaustively and cheaply, and a
 * service that reaches for `db` directly can only be tested with a database
 * standing behind it. Every service in this phase takes its storage as a
 * parameter; `src/db/repositories.ts` holds the Drizzle implementations and the
 * test suite supplies in-memory ones.
 *
 * The rule that keeps this honest, mirroring the provider abstraction: nothing
 * outside `src/db/` imports Drizzle or the schema.
 */

import type { ResolvedLexiconEntry } from "@/script/resolve";

export type TermLanguage = "gn" | "es" | "jopara";

export interface LexiconRepository {
  /**
   * Every lexicon term with the speech form that applies to `engine`.
   *
   * Falls back to the `default`-engine row where no engine-specific row exists.
   * Respellings are engine-specific (plan §2) — a form tuned for one engine
   * mispronounces on another — so this is always asked for a named engine, and
   * "no engine in particular" is spelled `default` rather than left implicit.
   */
  entriesForEngine(engine: string): Promise<ResolvedLexiconEntry[]>;
}

export interface PronunciationRepository {
  /**
   * Ensures a (term, engine) pronunciation row exists, seeding it from the
   * given speech form when it does not. Never overwrites an existing row —
   * a human may have tuned it, and this runs on every harness pass.
   * Returns the row id.
   */
  ensureForEngine(termId: number, engine: string, speechForm: string): Promise<number>;

  /**
   * Points a pronunciation row at rendered audio, so `verified` has evidence
   * behind it when a Guaraní speaker signs off (plan §7). Without the sample,
   * `verified` is decoration.
   */
  attachSample(termId: number, engine: string, sampleAudioUrl: string): Promise<void>;
}

export type UnresolvedSightingInput = {
  term: string;
  language: TermLanguage;
  scriptLineId: number | null;
  occurrences: number;
};

export interface UnresolvedTermsRepository {
  /** Upserts sightings, accumulating `occurrences` for terms already queued. */
  record(sightings: UnresolvedSightingInput[]): Promise<void>;
}

export type ScriptLineInput = {
  displayText: string;
  speechText: string;
  provisional: boolean;
};

export type StoredScriptLine = {
  id: number;
  lineNumber: number;
  displayText: string;
  speechText: string;
  provisional: boolean;
};

export interface ScriptRepository {
  /**
   * Writes the script for (project, language), replacing any lines already
   * there. Replacement rather than append is what makes script generation
   * re-runnable (plan §4): regenerating after a listing edit must converge on
   * one script, not accumulate copies.
   */
  replaceScript(input: {
    projectId: number;
    language: "es" | "gn";
    lines: ScriptLineInput[];
  }): Promise<{ scriptId: number; lines: StoredScriptLine[] }>;

  linesFor(scriptId: number): Promise<StoredScriptLine[]>;
}

export type JobCreateInput = {
  kind: "tts" | "video" | "image";
  provider: string;
  engine: string | null;
  inputRef: Record<string, unknown>;
};

/**
 * What a provider charged. Separated from the rest of a completion because a
 * job can fail *after* being charged — the download 404s, the bucket rejects
 * the upload — and that spend still has to reach the job row.
 */
export type JobCost = {
  costRawAmount: number;
  costRawUnit: string;
  costUsd: number | null;
};

export type JobCompletion = JobCost & {
  outputUrl: string;
  providerOutputUrl: string;
  durationMs: number | null;
};

export type JobRow = {
  id: number;
  kind: string;
  provider: string;
  engine: string | null;
  status: string;
  inputRef: Record<string, unknown> | null;
  outputUrl: string | null;
  durationMs: number | null;
  costUsd: string | null;
  error: string | null;
};

export interface JobRepository {
  /** Creates the row BEFORE the provider call, so a crashed call still leaves a trace. */
  create(input: JobCreateInput): Promise<number>;
  markRunning(id: number, providerJobId?: string): Promise<void>;
  complete(id: number, completion: JobCompletion): Promise<void>;
  /** `cost` is present when the provider had already charged before the failure. */
  fail(id: number, error: string, cost?: JobCost): Promise<void>;
  /** Every job written by one A/B run, for the per-engine comparison query. */
  listByAbRun(abRunId: string): Promise<JobRow[]>;
}
