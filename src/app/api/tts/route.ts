/**
 * POST /api/tts — the standalone Guaraní speech route (plan §5.2, API-level;
 * the UI for it is sonnet-2's §6.2 work).
 *
 * Body: { text, language?, voiceRef?, engine?, overrides? }
 *
 * AUTH. Plan §2 defers real auth to a single admin login gate, which does not
 * exist yet. This route spends credits and produces publishable audio, so it
 * cannot be left open in production: with ADMIN_API_TOKEN set it requires a
 * bearer token; without it, it serves only outside production and says so in a
 * warning. That is the graceful-degradation shape plan §4 asks for — a missing
 * env var never blocks local work — without leaving a metered endpoint exposed
 * on a deployed host.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  DrizzleJobRepository,
  DrizzleLexiconRepository,
  DrizzleRateConverter,
  DrizzleUnresolvedTermsRepository,
  DrizzleVoiceResolver,
  findVoiceForEngine,
} from "@/db/repositories";
import { ProviderUnavailableError, resolveTtsProvider } from "@/providers/factory";
import { synthesizeStandalone } from "@/tts/standalone";

// ffprobe, the S3 client and mysql2 all need Node APIs, and the route holds
// open a provider call for as long as synthesis takes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Roughly a long paragraph — far more than any single narration line needs. */
const MAX_TEXT_LENGTH = 2000;

type Body = {
  text?: unknown;
  language?: unknown;
  voiceRef?: unknown;
  engine?: unknown;
  overrides?: unknown;
};

function authorize(request: Request): { ok: true; warning?: string } | { ok: false; status: number; message: string } {
  const expected = process.env.ADMIN_API_TOKEN;

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return {
        ok: false,
        status: 503,
        message:
          "ADMIN_API_TOKEN is not set. This route spends provider credits, so " +
          "it stays closed in production until a token is configured.",
      };
    }
    return {
      ok: true,
      warning:
        "ADMIN_API_TOKEN is not set — this route is unauthenticated. Fine " +
        "locally, never on a deployed host.",
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!sameToken(token, expected)) {
    return { ok: false, status: 401, message: "Missing or invalid bearer token." };
  }
  return { ok: true };
}

/** Length-independent comparison, so timing does not leak the token. */
function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would leak length by
  // itself; hashing both to a fixed width removes that channel too.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function readOverrides(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("overrides must be an object of term → speech form");
  }
  const out: Record<string, string> = {};
  for (const [term, speechForm] of Object.entries(value as Record<string, unknown>)) {
    if (typeof speechForm !== "string") {
      throw new Error(`override for ${JSON.stringify(term)} must be a string`);
    }
    out[term] = speechForm;
  }
  return out;
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text === "") {
    return NextResponse.json({ error: "text is required." }, { status: 400 });
  }
  // Provider cost scales with text length, so an unbounded request is an
  // unbounded charge. This is a spend guard, not a validation nicety; a listing
  // narration line is a sentence, and anything near this cap is a mistake.
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      {
        error:
          `text is ${text.length} characters; the limit is ${MAX_TEXT_LENGTH}. ` +
          "Provider cost scales with length, so long inputs are refused rather " +
          "than charged. Split it into separate requests.",
      },
      { status: 413 },
    );
  }

  const language = body.language === "es" ? "es" : "gn";
  const engine = typeof body.engine === "string" ? body.engine : undefined;

  let overrides: Record<string, string> | undefined;
  try {
    overrides = readOverrides(body.overrides);
  } catch (error) {
    return NextResponse.json({ error: describe(error) }, { status: 400 });
  }

  // A caller may name a voice explicitly, or let the engine pick one. Guessing
  // is safe here because `voices` holds one row per (voice, engine) pair.
  let voiceRef = typeof body.voiceRef === "number" ? body.voiceRef : null;
  if (voiceRef === null) {
    const fallback = engine ? await findVoiceForEngine(engine) : null;
    if (!fallback) {
      return NextResponse.json(
        {
          error:
            "No voiceRef given and no voices row matches that engine. Run " +
            "`npm run seed:voices`, or pass voiceRef explicitly.",
        },
        { status: 400 },
      );
    }
    voiceRef = fallback.id;
  }

  try {
    const result = await synthesizeStandalone(
      { text, language, voiceRef, engine, overrides },
      {
        provider: resolveTtsProvider({
          voices: new DrizzleVoiceResolver(),
          rates: new DrizzleRateConverter(),
        }),
        lexicon: new DrizzleLexiconRepository(),
        unresolvedTerms: new DrizzleUnresolvedTermsRepository(),
        jobs: new DrizzleJobRepository(),
      },
    );

    return NextResponse.json({
      ...result,
      warnings: [...result.warnings, ...(auth.warning ? [auth.warning] : [])],
    });
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      // 503, not 500: nothing is wrong with the request, the process just has
      // no way to reach a provider yet.
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return NextResponse.json({ error: describe(error) }, { status: 500 });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
