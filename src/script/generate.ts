/**
 * Script generation service — plan §5.2: a `listings` row becomes `scripts` +
 * `script_lines` in both languages, with numbers verbalized and Guaraní terms
 * resolved through the lexicon.
 *
 * The pipeline, in the order the pieces have to run:
 *
 *   listing fields
 *     → templates.ts     fills both strings at once, verbalizing numbers
 *                        (display keeps "Gs. 850.000.000", speech gets words)
 *     → resolve.ts       rewrites the speech string through the lexicon and
 *                        flags anything it could not account for
 *     → repositories     script + lines persisted, unresolved terms queued
 *
 * Verbalization has to happen first, inside the templates, because that is the
 * only place with the typed field in hand — a price is a DECIMAL there and a
 * string everywhere after. Lexicon resolution has to happen second, because
 * verbalization emits Spanish number words into Guaraní sentences and those
 * words then have to survive the unresolved-terms rule (they are on the
 * passthrough allowlist for exactly this reason).
 */

import { SPANISH_PASSTHROUGH } from "./passthrough";
import {
  buildLexiconIndex,
  normalizeTerm,
  resolveSpeechText,
  shouldRecordUnresolved,
  type UnresolvedSighting,
} from "./resolve";
import { buildDraftLines, type ListingFacts, type TemplateOptions } from "./templates";
import type { ScriptLanguage } from "./verbalize";
import type {
  LexiconRepository,
  ScriptRepository,
  StoredScriptLine,
  UnresolvedTermsRepository,
} from "@/ports";

const PASSTHROUGH_SET: ReadonlySet<string> = new Set(
  SPANISH_PASSTHROUGH.map(normalizeTerm),
);

export type GenerateScriptsInput = {
  projectId: number;
  facts: ListingFacts;
  /** Defaults to both. A single-language run is how the standalone route reuses this. */
  languages?: ScriptLanguage[];
  /**
   * Which engine's respellings to bake into speech_text. `default` is the
   * fallback set; the A/B harness re-runs resolution per candidate engine.
   */
  engine?: string;
  templateOptions?: TemplateOptions;
};

export type GeneratedScript = {
  language: ScriptLanguage;
  scriptId: number;
  lines: StoredScriptLine[];
  /** Terms that fell through the lexicon and the allowlist, queued for review. */
  unresolved: UnresolvedSighting[];
};

export type GenerateScriptsDeps = {
  lexicon: LexiconRepository;
  scripts: ScriptRepository;
  unresolvedTerms: UnresolvedTermsRepository;
};

export async function generateScripts(
  input: GenerateScriptsInput,
  deps: GenerateScriptsDeps,
): Promise<GeneratedScript[]> {
  const engine = input.engine ?? "default";
  const languages = input.languages ?? (["es", "gn"] as ScriptLanguage[]);

  const index = buildLexiconIndex(await deps.lexicon.entriesForEngine(engine));
  const results: GeneratedScript[] = [];

  for (const language of languages) {
    const recordUnresolved = shouldRecordUnresolved(language);
    const drafts = buildDraftLines(input.facts, language, input.templateOptions ?? {});

    const resolved = drafts.map((draft) =>
      resolveSpeechText(draft.speech, {
        index,
        passthrough: PASSTHROUGH_SET,
        recordUnresolved,
      }),
    );

    const { scriptId, lines } = await deps.scripts.replaceScript({
      projectId: input.projectId,
      language,
      lines: drafts.map((draft, i) => ({
        displayText: draft.display,
        speechText: resolved[i].speechText,
        provisional: resolved[i].provisional,
      })),
    });

    // Queued only after the lines exist, so every sighting can point at the
    // line it came from — a reviewer needs the context, not just the word.
    const sightings = resolved.flatMap((result, i) =>
      result.unresolved.map((sighting) => ({
        term: sighting.term,
        // The script's language is the honest label: a token in a jopara
        // sentence may be Guaraní or an unfamiliar Spanish proper noun, and
        // deciding which is the reviewer's job at promotion time.
        language: language as "gn" | "es",
        scriptLineId: lines[i]?.id ?? null,
        occurrences: sighting.occurrences,
      })),
    );
    if (sightings.length > 0) await deps.unresolvedTerms.record(sightings);

    results.push({
      language,
      scriptId,
      lines,
      unresolved: mergeSightings(resolved.flatMap((r) => r.unresolved)),
    });
  }

  return results;
}

/** Same term on several lines is one queue entry with a higher count. */
function mergeSightings(sightings: UnresolvedSighting[]): UnresolvedSighting[] {
  const merged = new Map<string, UnresolvedSighting>();
  for (const sighting of sightings) {
    const key = normalizeTerm(sighting.term);
    const seen = merged.get(key);
    if (seen) seen.occurrences += sighting.occurrences;
    else merged.set(key, { ...sighting });
  }
  return [...merged.values()];
}
