/**
 * The standalone Guaraní TTS capability — plan §3.5: paste text, get speech.
 *
 * Deliberately NOT a second pipeline. It is the same lexicon resolution and the
 * same synthesis path a listing video uses, with the template step removed and
 * the text supplied directly. Plan §1 is explicit that this is "a thin exposure
 * of the same script/voice pipeline the video feature needs, not a second
 * product" — and the moment it forks, the lexicon stops compounding across both
 * uses, which is the whole asset.
 *
 * The one thing it adds is manual overrides: a caller who already knows how a
 * word should sound can say so for this request without first promoting it into
 * the lexicon. Overrides win over lexicon entries and are not persisted — the
 * path from "I typed a respelling once" to "the lexicon knows this word" runs
 * through the review queue on purpose, so nothing enters the lexicon unreviewed.
 */

import type { JobRepository, UnresolvedTermsRepository, LexiconRepository } from "@/ports";
import type { TTSProvider } from "@/providers/types";
import { SPANISH_PASSTHROUGH } from "@/script/passthrough";
import {
  buildLexiconIndex,
  normalizeTerm,
  resolveSpeechText,
  shouldRecordUnresolved,
  type ResolvedLexiconEntry,
  type UnresolvedSighting,
} from "@/script/resolve";
import type { ScriptLanguage } from "@/script/verbalize";
import { synthesizeLines } from "./synthesize";

const PASSTHROUGH_SET: ReadonlySet<string> = new Set(SPANISH_PASSTHROUGH.map(normalizeTerm));

export type StandaloneSpeechRequest = {
  text: string;
  language: ScriptLanguage;
  /** Our `voices.id`. */
  voiceRef: number;
  engine?: string;
  /** term → speech form, applied ahead of the lexicon for this request only. */
  overrides?: Record<string, string>;
};

export type StandaloneSpeechResult = {
  displayText: string;
  speechText: string;
  provisional: boolean;
  unresolved: UnresolvedSighting[];
  jobId: number;
  audioUrl: string;
  durationMs: number | null;
  durable: boolean;
  costUsd: number | null;
  credits: number;
  warnings: string[];
};

export type StandaloneSpeechDeps = {
  provider: TTSProvider;
  lexicon: LexiconRepository;
  unresolvedTerms: UnresolvedTermsRepository;
  jobs: JobRepository;
  keyPrefix?: string;
};

/**
 * Overrides are given negative ids so they can never be mistaken for lexicon
 * rows downstream — nothing should attach a verification sample to a form that
 * exists only for the length of one request.
 */
function overrideEntries(overrides: Record<string, string>): ResolvedLexiconEntry[] {
  return Object.entries(overrides).map(([term, speechForm], index) => ({
    termId: -(index + 1),
    term,
    language: "jopara" as const,
    speechForm,
  }));
}

export async function synthesizeStandalone(
  request: StandaloneSpeechRequest,
  deps: StandaloneSpeechDeps,
): Promise<StandaloneSpeechResult> {
  const text = request.text.trim();
  if (text === "") throw new Error("text is required");

  const entries = await deps.lexicon.entriesForEngine(request.engine ?? "default");
  // Overrides last so they replace any lexicon entry with the same key.
  const index = buildLexiconIndex([...entries, ...overrideEntries(request.overrides ?? {})]);

  const recordUnresolved = shouldRecordUnresolved(request.language);
  const resolution = resolveSpeechText(text, {
    index,
    passthrough: PASSTHROUGH_SET,
    recordUnresolved,
  });

  if (recordUnresolved && resolution.unresolved.length > 0) {
    await deps.unresolvedTerms.record(
      resolution.unresolved.map((sighting) => ({
        term: sighting.term,
        language: request.language,
        // No script line to point at — this text was typed, not generated.
        scriptLineId: null,
        occurrences: sighting.occurrences,
      })),
    );
  }

  const synthesis = await synthesizeLines(
    [{ lineId: null, lineNumber: 1, speechText: resolution.speechText }],
    {
      provider: deps.provider,
      jobs: deps.jobs,
      voiceRef: request.voiceRef,
      engine: request.engine ?? null,
      keyPrefix: deps.keyPrefix ?? `tts/standalone/${request.language}`,
      concurrency: 1,
    },
  );

  const [audio] = synthesis.audio;
  if (!audio) {
    const failure = synthesis.failures[0];
    throw new Error(failure ? failure.error : "synthesis produced no audio");
  }

  return {
    displayText: text,
    speechText: resolution.speechText,
    provisional: resolution.provisional,
    unresolved: resolution.unresolved,
    jobId: audio.jobId,
    audioUrl: audio.audioUrl,
    durationMs: audio.durationMs,
    durable: audio.durable,
    costUsd: audio.costUsd,
    credits: audio.creditsSpent,
    warnings: synthesis.warnings,
  };
}
