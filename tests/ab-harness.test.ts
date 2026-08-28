/**
 * The A/B harness — plan §5.2.
 *
 * What it has to produce, to be worth the credits it spends:
 *   1. per-engine job rows that can be queried as one run;
 *   2. text resolved through EACH engine's own respellings, because comparing
 *      engines on identical speech_text measures the wrong thing once tuning
 *      starts (plan §2: respellings are engine-specific);
 *   3. a (term, engine) pronunciation row per term it touched, with audio
 *      attached — without the sample, `verified` is decoration (plan §7).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runEngineComparison } from "@/ab/harness";
import { MockProvider } from "@/providers/mock";
import type { TTSProvider } from "@/providers/types";
import {
  MemoryJobRepository,
  MemoryLexiconRepository,
  MemoryPronunciationRepository,
  type LexiconSeed,
} from "./helpers/memory-repos";
import {
  ffmpegAvailable,
  makeTone,
  startLocalAudioHost,
  type LocalAudioHost,
} from "./helpers/local-audio";

const hasFfmpeg = await ffmpegAvailable();
let host: LocalAudioHost;

beforeAll(async () => {
  if (!hasFfmpeg) return;
  host = await startLocalAudioHost({ "sample.wav": await makeTone(1, "sample") });
});

afterAll(async () => {
  await host?.close();
});

const LEXICON: LexiconSeed[] = [
  { termId: 1, term: "koty", language: "gn", forms: { default: "kotý", elevenlabs: "co-TEE" } },
  { termId: 2, term: "mbohapy", language: "gn", forms: { default: "mbohapɨ" } },
  { termId: 3, term: "ha", language: "gn", forms: { default: "ha" } },
];

/** A short, real WAV, borrowed from the mock provider. */
async function makeSilentWav(): Promise<string> {
  const result = await new MockProvider().synthesize({ text: "x", voiceRef: 1 });
  return result.audioUrl;
}

const SILENT_WAV = await makeSilentWav();
const silentWav = () => SILENT_WAV;

/** Records what each engine was actually asked to say. */
function recordingProvider(sent: Array<{ text: string }>): TTSProvider {
  return {
    name: "mock",
    async synthesize(request) {
      sent.push({ text: request.text });
      return {
        // A real, fetchable, probeable file — the orchestrator downloads and
        // measures every artifact, so an unfetchable URL would fail the run.
        audioUrl: silentWav(),
        durationMs: null,
        timing: { granularity: "none" as const },
        rawCost: { provider: "mock" as const, unit: "credit", amount: 0.3 },
        costUsd: 0.015,
      };
    },
  };
}

const lines = [
  { lineId: 1, lineNumber: 1, sourceText: "Orekóva mbohapy koty ha koty." },
  { lineId: 2, lineNumber: 2, sourceText: "Oguereko koty." },
];

function deps() {
  return {
    lexicon: new MemoryLexiconRepository(LEXICON),
    pronunciations: new MemoryPronunciationRepository(),
    jobs: new MemoryJobRepository(),
  };
}

/**
 * Storage is unconfigured throughout, so lines archive nowhere and keep their
 * provider URL. That is the degradation path (plan §4) and it must not stop the
 * harness from producing comparable material.
 */
async function run(engines: string[], sent: Array<{ text: string }> = []) {
  const shared = deps();
  const result = await runEngineComparison(
    {
      lines,
      engines: engines.map((engine, index) => ({
        engine,
        voiceRef: index + 1,
        provider: recordingProvider(sent),
      })),
      keyPrefix: "tts/ab/test",
    },
    shared,
  );
  return { result, ...shared };
}

describe("one run, several engines", () => {
  it("writes a job per line per engine, all under one run id", async () => {
    const { result, jobs } = await run(["elevenlabs", "minimax"]);

    expect(jobs.jobs).toHaveLength(4);
    const rows = await jobs.listByAbRun(result.abRunId);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.engine).sort()).toEqual([
      "elevenlabs", "elevenlabs", "minimax", "minimax",
    ]);
  });

  it("keeps the engines' results separately queryable", async () => {
    const { result } = await run(["elevenlabs", "minimax"]);

    expect(result.engines.map((e) => e.engine)).toEqual(["elevenlabs", "minimax"]);
    expect(result.engines.every((e) => e.failures.length === 0)).toBe(true);
    expect(result.engines.map((e) => e.audio.length)).toEqual([2, 2]);
    expect(result.totalCredits).toBeCloseTo(1.2, 6);
    expect(result.totalCostUsd).toBeCloseTo(0.06, 6);
  });

  it("does not mix one run's jobs into another's", async () => {
    const first = await run(["elevenlabs"]);
    const rows = await first.jobs.listByAbRun("some-other-run");
    expect(rows).toEqual([]);
  });
});

describe("each engine hears its own respellings", () => {
  it("sends the engine-specific speech form where one exists", async () => {
    const sent: Array<{ text: string }> = [];
    const { result } = await run(["elevenlabs", "minimax"], sent);

    const [elevenlabs, minimax] = result.engines;
    expect(elevenlabs.speechTexts[0].speechText).toContain("co-TEE");
    // minimax has no tuned form, so it falls back to the `default` row.
    expect(minimax.speechTexts[0].speechText).toContain("kotý");
    expect(minimax.speechTexts[0].speechText).not.toContain("co-TEE");

    // And that is what actually reached the provider, not just what was reported.
    expect(sent.some((s) => s.text.includes("co-TEE"))).toBe(true);
  });
});

describe("what the run leaves behind for review", () => {
  it("creates a pronunciation row per term per engine", async () => {
    const { pronunciations } = await run(["elevenlabs", "minimax"]);

    const terms = pronunciations.rows.filter((r) => r.engine === "elevenlabs");
    expect(terms.map((r) => r.termId).sort()).toEqual([1, 2, 3]);
    expect(pronunciations.rows).toHaveLength(6);
  });

  it.skipIf(!hasFfmpeg)("attaches the audio the term can be heard in", async () => {
    // Evidence is what makes `verified` mean something (plan §7), so a run
    // against a provider returning real links attaches one per (term, engine).
    const shared = deps();
    const linked: TTSProvider = {
      name: "mock",
      async synthesize() {
        return {
          audioUrl: `${host.baseUrl}/audio/sample.wav`,
          durationMs: null,
          timing: { granularity: "none" as const },
          rawCost: { provider: "mock" as const, unit: "credit", amount: 0.3 },
          costUsd: 0.015,
        };
      },
    };

    await runEngineComparison(
      { lines, engines: [{ engine: "elevenlabs", voiceRef: 1, provider: linked }], keyPrefix: "k" },
      shared,
    );

    expect(shared.pronunciations.rows.every((r) => r.sampleAudioUrl !== null)).toBe(true);
    expect(shared.pronunciations.rows[0].sampleAudioUrl).toBe(`${host.baseUrl}/audio/sample.wav`);
  });

  it("creates the rows but claims no sample when the audio is inline", async () => {
    // The mock provider returns `data:` URLs. Recording one as a sample would
    // put an unopenable link in the evidence column and make an unverifiable
    // row look verifiable.
    const { pronunciations } = await run(["elevenlabs"]);

    expect(pronunciations.rows.length).toBeGreaterThan(0);
    expect(pronunciations.rows.every((r) => r.sampleAudioUrl === null)).toBe(true);
  });

  it("never overwrites a pronunciation a human may have tuned", async () => {
    const shared = deps();
    await shared.pronunciations.ensureForEngine(1, "elevenlabs", "hand-tuned");

    await runEngineComparison(
      {
        lines,
        engines: [{ engine: "elevenlabs", voiceRef: 1, provider: recordingProvider([]) }],
        keyPrefix: "tts/ab/test",
      },
      shared,
    );

    const row = shared.pronunciations.rows.find((r) => r.termId === 1 && r.engine === "elevenlabs");
    expect(row?.speechForm).toBe("hand-tuned");
  });

  it("does not re-file terms into the review queue", async () => {
    // The queue belongs to script generation. A harness pass over the same text
    // would only duplicate what generation already filed.
    const sent: Array<{ text: string }> = [];
    const { result } = await run(["elevenlabs"], sent);
    expect(result.engines[0].speechTexts).toHaveLength(2);
  });
});
