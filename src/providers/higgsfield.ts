/**
 * HiggsfieldAdapter — the only file in the codebase that knows Higgsfield
 * exists. Nothing outside this file references Higgsfield models, engine
 * variants, voice-addressing tuples, or prompt idiom (plan §2).
 *
 * TRANSPORT SEAM — read before extending this file.
 *
 * The plan says this adapter drives Higgsfield "via the MCP tools". That is
 * true of an agent session, but MCP tools live in the agent's tool surface, not
 * in the Node process that runs this app: a render worker at 03:00 cannot call
 * `mcp__higgsfield_ai__generate_audio`. So the adapter talks to a
 * `HiggsfieldTransport`, and the transport is what varies:
 *
 *   - `HttpTransport` (below) is the production path — Higgsfield's HTTP API.
 *     Its exact request/response shapes are NOT verified in this phase (the API
 *     docs host is not reachable from the build environment), so it is written
 *     against the shapes the MCP tools expose and MUST be confirmed against
 *     real API docs in opus-2 before any production traffic. See KNOWN-ISSUES.
 *   - An agent-side transport can be supplied by a session that does have the
 *     MCP tools, without changing a line of adapter logic.
 *
 * Verified facts about Higgsfield, captured from live diagnostics in opus-1
 * (see plan §9 build log) rather than assumed:
 *   - TTS addressing needs up to four fields: model (`seed_audio` default, or
 *     `text2speech_v2`), variant (only for text2speech_v2), voice_type
 *     ('preset'|'element'), voice_id. Hence voices.provider_params is JSON.
 *   - Results carry NO timing metadata — only a URL. Timing is measured
 *     locally (plan §3.3).
 *   - Video defaults to 16:9, so aspect is always passed explicitly (plan §1).
 */

import type {
  Aspect,
  ClipResult,
  ImageResult,
  ImageSpec,
  Provider,
  ProviderName,
  RawCost,
  SceneSpec,
  TTSRequest,
  TTSResult,
} from "./types";

/** How the adapter reaches Higgsfield. Swappable; see the transport seam note. */
export interface HiggsfieldTransport {
  generateAudio(params: Record<string, unknown>): Promise<{
    resultUrl: string;
    credits: number;
  }>;
  generateVideo(params: Record<string, unknown>): Promise<{
    resultUrl: string;
    credits: number;
  }>;
  generateImage(params: Record<string, unknown>): Promise<{
    resultUrl: string;
    credits: number;
  }>;
}

/** Resolves our voices.id into Higgsfield's addressing tuple. */
export interface VoiceResolver {
  resolve(voiceRef: number): Promise<{
    model: string;
    variant?: string;
    voiceType: "preset" | "element";
    voiceId: string;
  }>;
}

/** Converts provider credits into USD via the provider_rates table. */
export interface RateConverter {
  toUsd(provider: ProviderName, unit: string, amount: number): Promise<number | null>;
}

export class HiggsfieldAdapter implements Provider {
  readonly name: ProviderName = "higgsfield";

  constructor(
    private readonly transport: HiggsfieldTransport,
    private readonly voices: VoiceResolver,
    private readonly rates: RateConverter,
  ) {}

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const voice = await this.voices.resolve(req.voiceRef);

    const { resultUrl, credits } = await this.transport.generateAudio({
      model: voice.model,
      ...(voice.variant ? { variant: voice.variant } : {}),
      voice_type: voice.voiceType,
      voice_id: voice.voiceId,
      prompt: req.text,
    });

    return {
      audioUrl: resultUrl,
      // Higgsfield returns no duration. The caller measures it with ffprobe
      // after download — never guessed, never taken from the provider.
      durationMs: null,
      timing: { granularity: "none" },
      ...(await this.cost(credits)),
    };
  }

  async generateClip(spec: SceneSpec): Promise<ClipResult> {
    const { resultUrl, credits } = await this.transport.generateVideo({
      prompt: this.renderScenePrompt(spec),
      aspect_ratio: this.aspectRatio(spec.aspect),
      duration: spec.durationSeconds,
    });

    return {
      clipUrl: resultUrl,
      durationMs: Math.round(spec.durationSeconds * 1000),
      ...(await this.cost(credits)),
    };
  }

  async generate(spec: ImageSpec): Promise<ImageResult> {
    const { resultUrl, credits } = await this.transport.generateImage({
      prompt: this.renderImagePrompt(spec),
      aspect_ratio: this.aspectRatio(spec.aspect),
      ...(spec.referenceUrls?.length
        ? { reference_urls: spec.referenceUrls }
        : {}),
    });

    return { imageUrl: resultUrl, ...(await this.cost(credits)) };
  }

  private async cost(credits: number): Promise<{ rawCost: RawCost; costUsd: number | null }> {
    const rawCost: RawCost = {
      provider: "higgsfield",
      unit: "credit",
      amount: credits,
    };
    return { rawCost, costUsd: await this.rates.toUsd("higgsfield", "credit", credits) };
  }

  /**
   * Higgsfield defaults to 16:9 when aspect is omitted, and our default
   * deliverable is 9:16 (plan §1) — so this is always passed, never defaulted.
   */
  private aspectRatio(aspect: Aspect): string {
    return aspect;
  }

  /**
   * Prompt rendering lives HERE, not in SceneSpec. Prompt phrasing is tuned per
   * model; a spec full of Higgsfield-idiom text would not port to Runway.
   */
  private renderScenePrompt(spec: SceneSpec): string {
    const shot: Record<SceneSpec["shotType"], string> = {
      establishing: "wide establishing shot",
      interior_pan: "slow interior pan",
      detail: "close detail shot",
      exterior_approach: "smooth exterior approach, camera moving forward",
    };
    return [shot[spec.shotType], spec.subject, spec.mood]
      .filter(Boolean)
      .join(", ");
  }

  private renderImagePrompt(spec: ImageSpec): string {
    return [spec.subject, spec.mood].filter(Boolean).join(", ");
  }
}
