/**
 * Seeds `voices` and `provider_rates` so the A/B harness has something to
 * address and costs can be normalized. Idempotent: safe to re-run.
 *
 * VOICES. opus-1's `list_voices` diagnostic found no cloned voice in the
 * workspace and barely any Spanish preset — the roster is overwhelmingly
 * Anglophone. `Marisol` was the Spanish-leaning preset every gate sample used,
 * held constant so engine was the only variable, and this seeds the same voice
 * across all six engines for the same reason. Plan §7 says a stock voice_id is
 * fine until the cloned voice exists; when it does, add an `element` row and
 * point the pipeline at it — nothing else changes.
 *
 * RATES. The USD-per-credit figure is NOT hardcoded, and deliberately so.
 * Credits are consumed from a monthly plan allowance that is already paid for,
 * so the honest marginal rate is that plan's price divided by its monthly
 * credit allowance — a number only the account holder knows. Baking in a
 * top-up pack price would be a different, larger number describing a purchase
 * that is not how these credits are bought.
 *
 *   HIGGSFIELD_USD_PER_CREDIT = <monthly plan price in USD> / <monthly credits>
 *
 * Without it, no rate row is written and `generation_jobs.cost_usd` stays null
 * while `cost_raw_amount` still records every credit. That is the intended
 * degradation (plan §4): an unknown cost reads as unknown, and setting the rate
 * later re-prices the whole history because the raw units were never lost.
 */

import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { providerRates, voices } from "@/db/schema";

const PROVIDER = "higgsfield";

/**
 * The Spanish-leaning preset opus-1 held constant across the go/no-go gate.
 * Keeping the same voice makes opus-2's A/B results directly comparable with
 * the gate samples already recorded in the plan §9 build log.
 */
const VOICE_ID = "75e72cd5-011b-4130-a474-e8b1ab341f04";
const VOICE_LABEL = "Marisol (preset, es-leaning)";

/**
 * The addressing tuple per engine, confirmed against the live tool schema in
 * opus-2: `seed_audio` is its own model, everything else is a variant of
 * `text2speech_v2`. Credits per ~90-character line are from opus-1's cost
 * preflight and are here as documentation, not as a stored rate.
 */
const ENGINES: Array<{ engine: string; model: string; variant?: string; creditsPerLine: number }> = [
  { engine: "seed_audio", model: "seed_audio", creditsPerLine: 0.5 },
  { engine: "elevenlabs", model: "text2speech_v2", variant: "elevenlabs", creditsPerLine: 0.3 },
  { engine: "minimax", model: "text2speech_v2", variant: "minimax", creditsPerLine: 0.3 },
  { engine: "seed_speech", model: "text2speech_v2", variant: "seed_speech", creditsPerLine: 0.2 },
  { engine: "vibe_voice", model: "text2speech_v2", variant: "vibe_voice", creditsPerLine: 0.2 },
  { engine: "cozy_voice", model: "text2speech_v2", variant: "cozy_voice", creditsPerLine: 0.1 },
];

async function seedVoices(): Promise<{ inserted: number; existing: number }> {
  let inserted = 0;
  let existing = 0;

  for (const candidate of ENGINES) {
    const found = await db
      .select({ id: voices.id })
      .from(voices)
      .where(
        and(
          eq(voices.provider, PROVIDER),
          eq(voices.providerVoiceId, VOICE_ID),
          eq(voices.engine, candidate.engine),
        ),
      )
      .limit(1);

    if (found[0]) {
      existing += 1;
      continue;
    }

    await db.insert(voices).values({
      provider: PROVIDER,
      providerVoiceId: VOICE_ID,
      engine: candidate.engine,
      providerParams: {
        model: candidate.model,
        ...(candidate.variant ? { variant: candidate.variant } : {}),
        voiceType: "preset",
        creditsPerLineObserved: candidate.creditsPerLine,
      },
      // A Spanish preset reading jopara is `multi` in the only sense that
      // matters here: it is not a Guaraní voice, and no Guaraní voice exists.
      language: "multi",
      label: `${VOICE_LABEL} — ${candidate.engine}`,
    });
    inserted += 1;
  }

  return { inserted, existing };
}

async function seedRate(): Promise<string> {
  const raw = process.env.HIGGSFIELD_USD_PER_CREDIT;
  if (!raw) {
    return (
      "No rate written: HIGGSFIELD_USD_PER_CREDIT is not set. Credits will be " +
      "recorded on every job and cost_usd will be null until it is. Compute it " +
      "as (monthly plan price in USD) / (monthly credit allowance)."
    );
  }

  const usdPerUnit = Number(raw);
  if (!Number.isFinite(usdPerUnit) || usdPerUnit <= 0) {
    throw new Error(`HIGGSFIELD_USD_PER_CREDIT must be a positive number, got ${JSON.stringify(raw)}`);
  }

  const existing = await db
    .select({ id: providerRates.id, usdPerUnit: providerRates.usdPerUnit })
    .from(providerRates)
    .where(and(eq(providerRates.provider, PROVIDER), eq(providerRates.unit, "credit")))
    .limit(1);

  if (existing[0] && Number(existing[0].usdPerUnit) === usdPerUnit) {
    return `Rate already on file: 1 credit = USD ${usdPerUnit}.`;
  }

  // A changed rate is inserted rather than updated: `effective_from` exists so
  // a re-price does not silently rewrite what past videos are recorded to have
  // cost. The converter reads the most recent row.
  await db.insert(providerRates).values({
    provider: PROVIDER,
    unit: "credit",
    usdPerUnit: usdPerUnit.toFixed(6),
    planLabel: process.env.HIGGSFIELD_PLAN_LABEL ?? "monthly plan allowance",
  });
  return `Rate written: 1 credit = USD ${usdPerUnit}.`;
}

async function main(): Promise<void> {
  const voiceResult = await seedVoices();
  const rateMessage = await seedRate();

  console.log(
    `Voices seed complete: ${voiceResult.inserted} inserted, ` +
      `${voiceResult.existing} already present (${ENGINES.length} engines).`,
  );
  console.log(rateMessage);
  console.log(
    "These are PRESET voices, not a cloned one. Plan §7 still wants voice " +
      "talent, written commercial-use consent, and one manual clone before " +
      "anything ships to a client.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
