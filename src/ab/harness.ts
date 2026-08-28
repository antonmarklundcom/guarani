/**
 * A/B harness — plan §5.2, last clause: the same script and voice across
 * several `engine` values, logged as separate jobs, writing per-engine
 * `lexicon_pronunciations` rows as respellings get tuned.
 *
 * WHAT THIS IS FOR. opus-1 proved the four candidate engines will *accept*
 * jopara without erroring, and left the go/no-go table empty because nobody in
 * that session could listen (plan §9). Choosing between them is a listening
 * judgement made by a Guaraní speaker, and a judgement needs material: the same
 * sentences, the same voice, one variable. This produces that material and
 * files it where the verdict can be recorded against it.
 *
 * WHY IT RE-RESOLVES THE TEXT PER ENGINE. Respellings are engine-specific
 * (plan §2) — a form tuned to make one engine say "mbohapy" correctly makes
 * another say something else. So each engine gets the lexicon resolved through
 * ITS own pronunciation rows, and comparing engines on identical speech_text
 * would measure the wrong thing entirely once tuning starts.
 *
 * WHAT IT LEAVES BEHIND. For every lexicon term a run touches, a
 * (term, engine) pronunciation row with `sample_audio_url` pointing at the
 * audio that term was heard in. That is the evidence `verified` needs to mean
 * anything (plan §7); without it the flag is decoration.
 */

import { randomUUID } from "node:crypto";
import type { TTSProvider } from "@/providers/types";
import type { JobRepository, LexiconRepository, PronunciationRepository } from "@/ports";
import { SPANISH_PASSTHROUGH } from "@/script/passthrough";
import { buildLexiconIndex, normalizeTerm, resolveSpeechText } from "@/script/resolve";
import { synthesizeLines, type LineAudio, type LineFailure } from "@/tts/synthesize";

const PASSTHROUGH_SET: ReadonlySet<string> = new Set(SPANISH_PASSTHROUGH.map(normalizeTerm));

/** One engine under test, with the voice row that addresses it. */
export type AbEngine = {
  /** `lexicon_pronunciations.engine` and `generation_jobs.engine`. */
  engine: string;
  /** Our `voices.id` for this engine — the adapter resolves it to provider params. */
  voiceRef: number;
  provider: TTSProvider;
};

export type AbLine = {
  /** The real `script_lines.id`, or null when the text is not from a stored script. */
  lineId: number | null;
  lineNumber: number;
  /**
   * The verbalized text BEFORE lexicon resolution. Not `script_lines.speech_text`,
   * which has already been resolved through one engine's respellings — feeding
   * that back in would compare engines on another engine's output.
   */
  sourceText: string;
};

export type AbEngineResult = {
  engine: string;
  /** What was actually sent to the engine, after its own respellings. */
  speechTexts: Array<{ lineNumber: number; speechText: string }>;
  audio: LineAudio[];
  failures: LineFailure[];
  totalCostUsd: number | null;
  totalCredits: number;
  warnings: string[];
};

export type AbRunResult = {
  /** Query handle: `jobs.listByAbRun(abRunId)` returns every row this wrote. */
  abRunId: string;
  engines: AbEngineResult[];
  totalCostUsd: number | null;
  totalCredits: number;
};

export type AbHarnessDeps = {
  lexicon: LexiconRepository;
  pronunciations: PronunciationRepository;
  jobs: JobRepository;
};

export type AbHarnessInput = {
  lines: readonly AbLine[];
  engines: readonly AbEngine[];
  /**
   * Storage key prefix. The run id AND the engine are appended, so a second run
   * cannot overwrite the audio a `verified` pronunciation row already points at
   * — which would leave a speaker's sign-off attached to audio they never heard.
   */
  keyPrefix: string;
  abRunId?: string;
  concurrency?: number;
};

export async function runEngineComparison(
  input: AbHarnessInput,
  deps: AbHarnessDeps,
): Promise<AbRunResult> {
  const abRunId = input.abRunId ?? randomUUID();
  const engines: AbEngineResult[] = [];

  // Engines run one after another rather than all at once. A/B runs are the
  // burstiest thing this system does, and opus-1 already caught a 429 from
  // twelve parallel submissions (KNOWN-ISSUES #5); bounded concurrency within
  // an engine is enough parallelism to be quick without provoking it.
  for (const candidate of input.engines) {
    const entries = await deps.lexicon.entriesForEngine(candidate.engine);
    const index = buildLexiconIndex(entries);
    const speechFormByTerm = new Map(entries.map((e) => [e.termId, e.speechForm]));

    const resolved = input.lines.map((line) => ({
      line,
      resolution: resolveSpeechText(line.sourceText, {
        index,
        passthrough: PASSTHROUGH_SET,
        // The queue belongs to script generation; a harness pass over the same
        // text would only re-file terms that are already in it.
        recordUnresolved: false,
      }),
    }));

    const synthesis = await synthesizeLines(
      resolved.map(({ line, resolution }) => ({
        lineId: line.lineId,
        lineNumber: line.lineNumber,
        speechText: resolution.speechText,
      })),
      {
        provider: candidate.provider,
        jobs: deps.jobs,
        voiceRef: candidate.voiceRef,
        engine: candidate.engine,
        abRunId,
        keyPrefix: `${input.keyPrefix}/${abRunId}/${candidate.engine}`,
        concurrency: input.concurrency,
      },
    );

    await recordPronunciations({
      engine: candidate.engine,
      resolved,
      audio: synthesis.audio,
      speechFormByTerm,
      pronunciations: deps.pronunciations,
    });

    engines.push({
      engine: candidate.engine,
      speechTexts: resolved.map(({ line, resolution }) => ({
        lineNumber: line.lineNumber,
        speechText: resolution.speechText,
      })),
      audio: synthesis.audio,
      failures: synthesis.failures,
      totalCostUsd: synthesis.totalCostUsd,
      totalCredits: synthesis.totalCredits,
      warnings: synthesis.warnings,
    });
  }

  const costs = engines.map((e) => e.totalCostUsd);
  return {
    abRunId,
    engines,
    totalCostUsd: costs.every((c) => c !== null)
      ? costs.reduce((sum: number, c) => sum + (c as number), 0)
      : null,
    totalCredits: engines.reduce((sum, e) => sum + e.totalCredits, 0),
  };
}

/**
 * Ensures a pronunciation row per (term, engine) and points it at audio the
 * term can actually be heard in. Seeded from the form the resolver used, which
 * is the `default` row until someone tunes it — the row has to exist before it
 * can be tuned, and this is what creates it.
 */
async function recordPronunciations(args: {
  engine: string;
  resolved: Array<{ line: AbLine; resolution: { matchedTermIds: number[] } }>;
  audio: LineAudio[];
  speechFormByTerm: Map<number, string>;
  pronunciations: PronunciationRepository;
}): Promise<void> {
  // Keyed by line NUMBER, not id: the id may be null for text that has no
  // stored script line, and the number is always present and unique per run.
  const audioByLine = new Map(args.audio.map((a) => [a.lineNumber, a]));
  const sampleByTerm = new Map<number, string>();

  for (const { line, resolution } of args.resolved) {
    const rendered = audioByLine.get(line.lineNumber);
    // A `data:` URL is inline content, not a link a reviewer can open, and it
    // does not fit a URL column either. Recording one as evidence would make an
    // unverifiable row look verifiable — so those runs (the mock provider's)
    // create the pronunciation rows without pretending to have a sample.
    const sample = rendered && !rendered.audioUrl.startsWith("data:") ? rendered.audioUrl : "";
    for (const termId of resolution.matchedTermIds) {
      // First line the term was heard in wins; one sample per (term, engine) is
      // what a reviewer needs, and a later line is not a better one.
      if (!sampleByTerm.has(termId) || sampleByTerm.get(termId) === "") {
        sampleByTerm.set(termId, sample);
      }
    }
  }

  for (const [termId, sampleUrl] of sampleByTerm) {
    const speechForm = args.speechFormByTerm.get(termId);
    if (speechForm === undefined) continue;
    await args.pronunciations.ensureForEngine(termId, args.engine, speechForm);
    if (sampleUrl !== "") {
      await args.pronunciations.attachSample(termId, args.engine, sampleUrl);
    }
  }
}
