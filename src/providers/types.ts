/**
 * The provider abstraction — plan §2, the load-bearing piece of the §1
 * provider-strategy decision.
 *
 * Two rules make a future Runway/ElevenLabs swap a new adapter file rather than
 * a rewrite, and both are enforced here in the types:
 *
 * 1. No job/poll leakage. Every method returns a normalized Promise<Result>.
 *    `{jobId, poll()}` is a Higgsfield-ism — ElevenLabs' direct TTS API hands
 *    back bytes in one call. If the interface exposed jobs, every caller would
 *    be coupled to the job model and a synchronous provider would need a fake
 *    job shim. Polling is each adapter's private business.
 *
 * 2. Specs are declarative, prompts are adapter-owned. A SceneSpec says shot
 *    type, subject, mood, duration, aspect — never prompt text. Prompt phrasing
 *    is tuned per model, so each adapter renders a spec into its own idiom.
 *
 * The result types ARE the abstraction; the method signatures are trivia.
 */

export type ProviderName = "higgsfield" | "mock";

export type Aspect = "9:16" | "16:9";

/** Raw provider cost, kept alongside USD because credits-per-USD varies by plan. */
export type RawCost = {
  provider: ProviderName;
  unit: string;
  amount: number;
};

export type TimingGranularity = "none" | "total" | "word" | "char";

/**
 * Higgsfield returns no timing metadata at all (granularity 'none'). Per plan
 * §3.3 and §11.4 we never depend on provider timing: durations are measured
 * locally with ffprobe. This field exists so a future provider that DOES return
 * word/char marks can be used without a schema or interface change.
 */
export type Timing = {
  granularity: TimingGranularity;
  marks?: Array<{ text: string; startMs: number; endMs: number }>;
};

export type TTSRequest = {
  text: string;
  /** Our voices.id — the adapter resolves it to provider params. Callers never
   *  hold provider voice ids, model names, or engine variants. */
  voiceRef: number;
};

export type TTSResult = {
  audioUrl: string;
  durationMs: number | null;
  timing: Timing;
  rawCost: RawCost;
  costUsd: number | null;
};

export type ShotType =
  | "establishing"
  | "interior_pan"
  | "detail"
  | "exterior_approach";

/** Declarative. No prompt text here, by design — see rule 2 above. */
export type SceneSpec = {
  shotType: ShotType;
  subject: string;
  mood?: string;
  durationSeconds: number;
  aspect: Aspect;
};

export type ClipResult = {
  clipUrl: string;
  durationMs: number | null;
  rawCost: RawCost;
  costUsd: number | null;
};

export type ImageSpec = {
  subject: string;
  mood?: string;
  aspect: Aspect;
  referenceUrls?: string[];
};

export type ImageResult = {
  imageUrl: string;
  rawCost: RawCost;
  costUsd: number | null;
};

export interface TTSProvider {
  readonly name: ProviderName;
  synthesize(req: TTSRequest): Promise<TTSResult>;
}

export interface VideoProvider {
  readonly name: ProviderName;
  generateClip(spec: SceneSpec): Promise<ClipResult>;
}

export interface ImageProvider {
  readonly name: ProviderName;
  generate(spec: ImageSpec): Promise<ImageResult>;
}

export interface Provider extends TTSProvider, VideoProvider, ImageProvider {}
