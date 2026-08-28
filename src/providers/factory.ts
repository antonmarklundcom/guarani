/**
 * Chooses the provider a running process should use.
 *
 * WHY THERE IS NO HTTP TRANSPORT HERE. opus-1 left KNOWN-ISSUES #1 open: the
 * `HiggsfieldTransport` seam exists, but the wire format of Higgsfield's HTTP
 * API was never confirmed, because the docs host is not reachable from the
 * build environment. opus-2 re-checked and it is still refused at the egress
 * policy — `higgsfield.ai` and `docs.higgsfield.ai` both answer 403 to CONNECT.
 *
 * So this phase does not ship an HTTP transport. Writing one from memory would
 * produce code that looks production-ready, passes its own tests, and fails on
 * the first real call — and worse, it would let a future phase believe the
 * question was settled. An unregistered transport fails loudly instead, naming
 * what is missing.
 *
 * Registering one is a single call, from wherever the verified client lives:
 * a worker with an API key, or an agent session that holds the MCP tools (MCP
 * tools are part of an agent's tool surface, not of this Node process — see the
 * transport-seam note in higgsfield.ts).
 */

import { HiggsfieldAdapter, type HiggsfieldTransport, type RateConverter, type VoiceResolver } from "./higgsfield";
import { MockProvider } from "./mock";
import type { Provider, TTSProvider } from "./types";

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

let transportFactory: (() => HiggsfieldTransport) | null = null;

/** Installs the Higgsfield transport for this process. Call once at startup. */
export function registerHiggsfieldTransport(factory: () => HiggsfieldTransport): void {
  transportFactory = factory;
}

/** Test/CLI escape hatch — undoes `registerHiggsfieldTransport`. */
export function clearHiggsfieldTransport(): void {
  transportFactory = null;
}

export function isHiggsfieldTransportRegistered(): boolean {
  return transportFactory !== null;
}

export type ProviderDeps = { voices: VoiceResolver; rates: RateConverter };

/**
 * `GUARANI_TTS_PROVIDER=mock` selects the canned provider — that is how the
 * standalone route and the CLI scripts are exercised end to end without
 * spending credits, and it is the setting the test suite runs under.
 */
export function resolveProvider(deps: ProviderDeps): Provider {
  if ((process.env.GUARANI_TTS_PROVIDER ?? "higgsfield") === "mock") {
    return new MockProvider();
  }

  if (!transportFactory) {
    throw new ProviderUnavailableError(
      "No Higgsfield transport is registered, so no real generation can run in " +
        "this process. The HTTP wire format is still unverified (KNOWN-ISSUES #1: " +
        "the docs host is blocked by this environment's egress policy). Either " +
        "call registerHiggsfieldTransport() with a verified client, or set " +
        "GUARANI_TTS_PROVIDER=mock to use canned fixtures.",
    );
  }

  return new HiggsfieldAdapter(transportFactory(), deps.voices, deps.rates);
}

export function resolveTtsProvider(deps: ProviderDeps): TTSProvider {
  return resolveProvider(deps);
}
