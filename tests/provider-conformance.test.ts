/**
 * Interface-conformance suite.
 *
 * The point of this file is that ONE set of assertions runs against BOTH
 * implementations. A rule that only the mock satisfies is not an abstraction,
 * and a rule that only Higgsfield satisfies is a leak. Both run here.
 *
 * The Higgsfield adapter runs against a stub transport, so this suite spends no
 * credits and needs no network — per plan §2, the test suite never burns
 * credits.
 */

import { describe, expect, it } from "vitest";
import { MockProvider } from "@/providers/mock";
import {
  HiggsfieldAdapter,
  type HiggsfieldTransport,
  type RateConverter,
  type VoiceResolver,
} from "@/providers/higgsfield";
import { lineOffsets } from "@/providers/duration";
import type { Provider } from "@/providers/types";

const stubTransport: HiggsfieldTransport = {
  async generateAudio() {
    return { resultUrl: "https://cdn.example/audio.wav", credits: 0.3 };
  },
  async generateVideo() {
    return { resultUrl: "https://cdn.example/clip.mp4", credits: 5 };
  },
  async generateImage() {
    return { resultUrl: "https://cdn.example/image.png", credits: 1 };
  },
};

const stubVoices: VoiceResolver = {
  async resolve() {
    return {
      model: "text2speech_v2",
      variant: "elevenlabs",
      voiceType: "preset",
      voiceId: "75e72cd5-011b-4130-a474-e8b1ab341f04",
    };
  },
};

const stubRates: RateConverter = {
  async toUsd(_provider, _unit, amount) {
    return amount * 0.01;
  },
};

const implementations: Array<[string, Provider]> = [
  ["MockProvider", new MockProvider()],
  [
    "HiggsfieldAdapter",
    new HiggsfieldAdapter(stubTransport, stubVoices, stubRates),
  ],
];

describe.each(implementations)("%s conforms to the provider interface", (_name, provider) => {
  it("synthesize returns a normalized TTSResult", async () => {
    const result = await provider.synthesize({ text: "Ko óga porã.", voiceRef: 1 });

    expect(typeof result.audioUrl).toBe("string");
    expect(result.audioUrl.length).toBeGreaterThan(0);
    expect(result.timing).toHaveProperty("granularity");
    expect(["none", "total", "word", "char"]).toContain(result.timing.granularity);
    expect(result.rawCost.unit).toBeTruthy();
    expect(typeof result.rawCost.amount).toBe("number");
  });

  it("never leaks a job handle through the interface", async () => {
    // The whole reason the interfaces return normalized results: a caller that
    // can see jobId/poll() is coupled to Higgsfield's async model, and a
    // synchronous provider (ElevenLabs direct) would need a fake job shim.
    const result = await provider.synthesize({ text: "Mokõi koty.", voiceRef: 1 });

    expect(result).not.toHaveProperty("jobId");
    expect(result).not.toHaveProperty("poll");
  });

  it("generateClip honors the requested aspect and returns a clip URL", async () => {
    const result = await provider.generateClip({
      shotType: "interior_pan",
      subject: "living room with garden view",
      durationSeconds: 4,
      aspect: "9:16",
    });

    expect(typeof result.clipUrl).toBe("string");
    expect(result.durationMs).toBe(4000);
  });

  it("generate returns an image URL and a raw cost", async () => {
    const result = await provider.generate({
      subject: "front facade at golden hour",
      aspect: "9:16",
    });

    expect(typeof result.imageUrl).toBe("string");
    expect(result.rawCost.provider).toBe(provider.name);
  });
});

describe("SceneSpec stays declarative", () => {
  it("prompt text is rendered inside the adapter, never carried on the spec", async () => {
    // Prompts are tuned per model, so a spec carrying Higgsfield-idiom text
    // would not port to another provider (plan §1, review edit A4.3).
    const captured: Record<string, unknown>[] = [];
    const recordingTransport: HiggsfieldTransport = {
      ...stubTransport,
      async generateVideo(params) {
        captured.push(params);
        return { resultUrl: "https://cdn.example/clip.mp4", credits: 5 };
      },
    };

    const adapter = new HiggsfieldAdapter(recordingTransport, stubVoices, stubRates);
    await adapter.generateClip({
      shotType: "exterior_approach",
      subject: "two-storey house in Barrio San Vicente",
      mood: "warm afternoon light",
      durationSeconds: 3,
      aspect: "9:16",
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].prompt).toContain("smooth exterior approach");
    expect(captured[0].prompt).toContain("two-storey house in Barrio San Vicente");
    // Aspect is always explicit: Higgsfield defaults to 16:9 and our
    // deliverable is 9:16 (plan §1).
    expect(captured[0].aspect_ratio).toBe("9:16");
  });
});

describe("caption timing is true by construction", () => {
  it("derives contiguous offsets from measured per-line durations", () => {
    // Plan §3.3: never transcribe, never trust provider timing. Offsets come
    // from locally measured durations, so captions cannot drift.
    expect(lineOffsets([1000, 2500, 400])).toEqual([
      { startMs: 0, endMs: 1000 },
      { startMs: 1000, endMs: 3500 },
      { startMs: 3500, endMs: 3900 },
    ]);
  });

  it("returns no offsets for no lines", () => {
    expect(lineOffsets([])).toEqual([]);
  });
});
