/**
 * The standalone Guaraní speech route — plan §3.5, §5.2.
 *
 * The property worth protecting is that this is not a second pipeline: the same
 * lexicon, the same resolution rule, the same job accounting. If it forked, the
 * lexicon would stop compounding across both uses, and the lexicon is the asset
 * (plan §11 defensibility).
 */

import { describe, expect, it } from "vitest";
import { MockProvider } from "@/providers/mock";
import { synthesizeStandalone } from "@/tts/standalone";
import {
  MemoryJobRepository,
  MemoryLexiconRepository,
  MemoryUnresolvedTermsRepository,
  type LexiconSeed,
} from "./helpers/memory-repos";

const LEXICON: LexiconSeed[] = [
  { termId: 1, term: "koty", language: "gn", forms: { default: "kotý", elevenlabs: "co-TEE" } },
  { termId: 2, term: "ha", language: "gn", forms: { default: "ha" } },
];

function deps() {
  return {
    provider: new MockProvider(),
    lexicon: new MemoryLexiconRepository(LEXICON),
    unresolvedTerms: new MemoryUnresolvedTermsRepository(),
    jobs: new MemoryJobRepository(),
  };
}

describe("typed text to speech", () => {
  it("resolves through the lexicon and returns measured audio", async () => {
    const shared = deps();
    const result = await synthesizeStandalone(
      { text: "koty ha koty", language: "gn", voiceRef: 1 },
      shared,
    );

    expect(result.speechText).toBe("kotý ha kotý");
    expect(result.displayText).toBe("koty ha koty");
    expect(result.durationMs).toBeGreaterThan(0);
    expect(shared.jobs.jobs).toHaveLength(1);
    expect(shared.jobs.jobs[0].status).toBe("completed");
  });

  it("uses the named engine's respelling", async () => {
    const result = await synthesizeStandalone(
      { text: "koty", language: "gn", voiceRef: 1, engine: "elevenlabs" },
      deps(),
    );
    expect(result.speechText).toBe("co-TEE");
  });

  it("files unknown terms in the same review queue, with no line to point at", async () => {
    const shared = deps();
    const result = await synthesizeStandalone(
      { text: "Ñemby koty", language: "gn", voiceRef: 1 },
      shared,
    );

    expect(result.provisional).toBe(true);
    expect(result.unresolved.map((u) => u.term)).toEqual(["Ñemby"]);
    expect(shared.unresolvedTerms.rows[0]).toMatchObject({
      term: "Ñemby",
      language: "gn",
      scriptLineId: null,
    });
  });

  it("does not file ordinary Spanish when the language is Spanish", async () => {
    const shared = deps();
    await synthesizeStandalone(
      { text: "Propiedad en Asunción", language: "es", voiceRef: 1 },
      shared,
    );
    expect(shared.unresolvedTerms.rows).toEqual([]);
  });
});

describe("manual overrides", () => {
  it("wins over the lexicon for this request", async () => {
    const result = await synthesizeStandalone(
      { text: "koty", language: "gn", voiceRef: 1, overrides: { koty: "ko-TEE" } },
      deps(),
    );
    expect(result.speechText).toBe("ko-TEE");
  });

  it("resolves a word the lexicon has never seen, without queueing it", async () => {
    const shared = deps();
    const result = await synthesizeStandalone(
      { text: "Ñemby", language: "gn", voiceRef: 1, overrides: { "Ñemby": "ñem-BUH" } },
      shared,
    );

    // Capitalized because the surface form was: the resolver mirrors casing.
    expect(result.speechText).toBe("Ñem-BUH");
    expect(result.provisional).toBe(false);
    // Overrides are not a back door into the lexicon: promotion goes through
    // review, so nothing enters the lexicon unreviewed.
    expect(shared.unresolvedTerms.rows).toEqual([]);
  });
});

describe("input handling", () => {
  it("rejects empty text rather than spending a credit on silence", async () => {
    await expect(
      synthesizeStandalone({ text: "   ", language: "gn", voiceRef: 1 }, deps()),
    ).rejects.toThrow("text is required");
  });
});
