/**
 * MockProvider — plan §2 / review edit A5.
 *
 * One adapter can never validate an abstraction: with a single implementation,
 * "the interface" is just that provider's shape with extra steps. This is the
 * cheap second implementation that keeps the interface honest from day one, and
 * it is what the test suite runs against, so no phase burns credits to test.
 *
 * Everything here is deterministic: same input, same fixture out.
 */

import type {
  ClipResult,
  ImageResult,
  ImageSpec,
  Provider,
  ProviderName,
  SceneSpec,
  TTSRequest,
  TTSResult,
} from "./types";

/** Rough speaking pace, used to fake a plausible duration from text length. */
const MS_PER_CHARACTER = 60;

const SAMPLE_RATE = 8000;

/**
 * A real, playable WAV of `durationMs` of silence, as a data: URL.
 *
 * Returning `mock://…` instead would make this provider useless for anything
 * past the first step: the TTS orchestrator downloads every artifact, measures
 * it with ffprobe and archives it, and an unfetchable URL fails all three. A
 * data: URL costs nothing, needs no server, and lets the whole pipeline —
 * including `GUARANI_TTS_PROVIDER=mock` in development — run end to end
 * without spending a credit, which is the point of this class.
 */
function silentWavDataUrl(durationMs: number): string {
  const samples = Math.max(1, Math.round((durationMs / 1000) * SAMPLE_RATE));
  const buffer = Buffer.alloc(44 + samples);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + samples, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // PCM header size
  buffer.writeUInt16LE(1, 20); // format: PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE, 28); // byte rate: 8-bit mono
  buffer.writeUInt16LE(1, 32); // block align
  buffer.writeUInt16LE(8, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(samples, 40);
  // 8-bit PCM is unsigned, so silence is 128 rather than 0.
  buffer.fill(128, 44);

  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}

export class MockProvider implements Provider {
  readonly name: ProviderName = "mock";

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const durationMs = Math.max(500, req.text.length * MS_PER_CHARACTER);
    return {
      audioUrl: silentWavDataUrl(durationMs),
      durationMs,
      // Deliberately 'none': matches the weakest contract any provider offers,
      // so callers written against the mock cannot come to depend on marks.
      timing: { granularity: "none" },
      rawCost: { provider: "mock", unit: "credit", amount: 0 },
      costUsd: 0,
    };
  }

  async generateClip(spec: SceneSpec): Promise<ClipResult> {
    return {
      clipUrl: `mock://clip/${spec.shotType}-${spec.aspect}.mp4`,
      durationMs: Math.round(spec.durationSeconds * 1000),
      rawCost: { provider: "mock", unit: "credit", amount: 0 },
      costUsd: 0,
    };
  }

  async generate(spec: ImageSpec): Promise<ImageResult> {
    return {
      imageUrl: `mock://image/${encodeURIComponent(spec.subject.slice(0, 32))}-${spec.aspect}.png`,
      rawCost: { provider: "mock", unit: "credit", amount: 0 },
      costUsd: 0,
    };
  }
}
