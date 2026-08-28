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

export class MockProvider implements Provider {
  readonly name: ProviderName = "mock";

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    return {
      audioUrl: `mock://audio/${encodeURIComponent(req.text.slice(0, 32))}.wav`,
      durationMs: Math.max(500, req.text.length * MS_PER_CHARACTER),
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
