/**
 * CLI: run the same Guaraní script across several engines and file the results.
 *
 *   npx tsx scripts/run-ab-harness.ts <projectId> [engine,engine,…]
 *
 * SPENDS CREDITS unless GUARANI_TTS_PROVIDER=mock. opus-1's preflight puts a
 * line at 0.1–0.5 credits depending on engine, so a 7-line script across four
 * engines is a few credits — but it is real spend on a real allowance, so the
 * run prints its cost and the engine list is explicit rather than "all".
 *
 * The material this produces is what the plan §9 go/no-go table needs and does
 * not have: the same sentences, the same voice, one variable. Filling that
 * table is a listening judgement, ideally the §7 Guaraní speaker's.
 */

import "dotenv/config";
import { runEngineComparison } from "@/ab/harness";
import {
  DrizzleJobRepository,
  DrizzleLexiconRepository,
  DrizzlePronunciationRepository,
  DrizzleRateConverter,
  DrizzleVoiceResolver,
  findVoiceForEngine,
  loadGuaraniScriptLines,
  loadListingFacts,
} from "@/db/repositories";
import { resolveTtsProvider } from "@/providers/factory";
import { buildDraftLines } from "@/script/templates";

const DEFAULT_ENGINES = ["elevenlabs", "minimax", "seed_speech", "seed_audio"];

/** The mock provider returns inline audio; printing 30KB of base64 helps nobody. */
function short(url: string): string {
  return url.length > 80 ? `${url.slice(0, 77)}…` : url;
}

async function main(): Promise<void> {
  const projectId = Number(process.argv[2]);
  const engineNames = (process.argv[3] ?? DEFAULT_ENGINES.join(",")).split(",").map((e) => e.trim());

  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new Error("Usage: tsx scripts/run-ab-harness.ts <projectId> [engine,engine,…]");
  }

  const facts = await loadListingFacts(projectId);
  if (!facts) throw new Error(`No listing found for project ${projectId}.`);

  // The harness resolves the lexicon itself, once per engine, so it is handed
  // the verbalized-but-unresolved draft rather than a stored speech_text that
  // was already resolved through one engine's respellings.
  const drafts = buildDraftLines(facts, "gn");

  // The REAL script_lines ids, matched to the drafts by line number. A job's
  // input_ref.scriptLineId is a reference: a positional 1..N would look
  // joinable while pointing at whatever rows happen to hold those ids.
  const stored = await loadGuaraniScriptLines(projectId);
  if (stored.length > 0 && stored.length !== drafts.length) {
    console.warn(
      `Stored GN script has ${stored.length} line(s) but the listing now ` +
        `generates ${drafts.length}. Re-run \`npm run script:generate ${projectId}\` ` +
        "so the A/B jobs reference the right lines.",
    );
  }

  const provider = resolveTtsProvider({
    voices: new DrizzleVoiceResolver(),
    rates: new DrizzleRateConverter(),
  });

  const engines = [];
  for (const engine of engineNames) {
    const voice = await findVoiceForEngine(engine);
    if (!voice) {
      throw new Error(
        `No voices row for engine ${engine}. Run \`npm run seed:voices\` first.`,
      );
    }
    engines.push({ engine, voiceRef: voice.id, provider });
  }

  const jobs = new DrizzleJobRepository();
  const result = await runEngineComparison(
    {
      lines: drafts.map((draft, index) => ({
        // Null when no stored line matches, never a placeholder.
        lineId: stored[index]?.id ?? null,
        lineNumber: index + 1,
        sourceText: draft.speech,
      })),
      engines,
      keyPrefix: `tts/ab/project-${projectId}`,
    },
    {
      lexicon: new DrizzleLexiconRepository(),
      pronunciations: new DrizzlePronunciationRepository(),
      jobs,
    },
  );

  console.log(`\nA/B run ${result.abRunId}`);
  for (const engine of result.engines) {
    console.log(`\n=== ${engine.engine} ===`);
    for (const line of engine.audio) {
      console.log(
        `  line ${line.lineNumber}: ${line.durationMs ?? "?"}ms  ${short(line.audioUrl)}` +
          `${line.durable ? "" : "  (not archived)"}`,
      );
    }
    for (const failure of engine.failures) {
      console.log(`  line ${failure.lineNumber}: FAILED — ${failure.error}`);
    }
    console.log(
      `  ${engine.totalCredits} credits, ` +
        `${engine.totalCostUsd === null ? "USD unknown (no rate on file)" : `USD ${engine.totalCostUsd}`}`,
    );
    for (const warning of engine.warnings) console.log(`  ! ${warning}`);
  }

  console.log(
    `\nTotal: ${result.totalCredits} credits, ` +
      `${result.totalCostUsd === null ? "USD unknown (no rate on file)" : `USD ${result.totalCostUsd}`}`,
  );

  const rows = await jobs.listByAbRun(result.abRunId);
  console.log(`${rows.length} generation_jobs rows written for this run.`);
  console.log(
    "Listen to the samples and fill the go/no-go table in plan §9. Per-engine " +
      "lexicon_pronunciations rows now carry sample_audio_url for verification.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
