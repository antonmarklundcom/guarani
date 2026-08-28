/**
 * CLI: generate the ES and GN scripts for a project from its listing row.
 *
 *   npx tsx scripts/generate-script.ts <projectId> [engine]
 *
 * Re-runnable — regenerating replaces the lines rather than adding a second
 * copy — so this is the command to run after editing a listing.
 */

import "dotenv/config";
import {
  DrizzleLexiconRepository,
  DrizzleScriptRepository,
  DrizzleUnresolvedTermsRepository,
  loadListingFacts,
} from "@/db/repositories";
import { generateScripts } from "@/script/generate";

async function main(): Promise<void> {
  const projectId = Number(process.argv[2]);
  const engine = process.argv[3] ?? "default";

  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw new Error("Usage: tsx scripts/generate-script.ts <projectId> [engine]");
  }

  const facts = await loadListingFacts(projectId);
  if (!facts) throw new Error(`No listing found for project ${projectId}.`);

  const generated = await generateScripts(
    { projectId, facts, engine },
    {
      lexicon: new DrizzleLexiconRepository(),
      scripts: new DrizzleScriptRepository(),
      unresolvedTerms: new DrizzleUnresolvedTermsRepository(),
    },
  );

  for (const script of generated) {
    console.log(`\n=== ${script.language.toUpperCase()} — script ${script.scriptId} ===`);
    for (const line of script.lines) {
      console.log(`\n${line.lineNumber}. ${line.provisional ? "[provisional] " : ""}`);
      console.log(`   caption : ${line.displayText}`);
      console.log(`   speech  : ${line.speechText}`);
    }
    if (script.unresolved.length > 0) {
      console.log(
        `\n   unresolved terms queued: ${script.unresolved
          .map((u) => `${u.term} (×${u.occurrences})`)
          .join(", ")}`,
      );
    }
  }
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
