/**
 * Drizzle implementations of the `src/ports.ts` repositories, plus the two
 * adapter collaborators opus-1 left as interfaces (`VoiceResolver` and
 * `RateConverter`).
 *
 * This is the only file in the phase that imports the schema. Services take
 * repositories as parameters and never reach for `db` themselves, which is what
 * lets the whole script/TTS/A/B layer be tested without a database — and what
 * keeps a future storage change from rippling through the business logic, the
 * same argument opus-1 made for the provider abstraction.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  generationJobs,
  joparaLexicon,
  listings,
  lexiconPronunciations,
  providerRates,
  scriptLines,
  scripts,
  unresolvedTerms,
  voices,
} from "@/db/schema";
import type { ProviderName } from "@/providers/types";
import type { RateConverter, VoiceResolver } from "@/providers/higgsfield";
import type {
  JobCompletion,
  JobCost,
  JobCreateInput,
  JobRepository,
  JobRow,
  LexiconRepository,
  PronunciationRepository,
  ScriptLineInput,
  ScriptRepository,
  StoredScriptLine,
  UnresolvedSightingInput,
  UnresolvedTermsRepository,
} from "@/ports";
import type { ResolvedLexiconEntry } from "@/script/resolve";
import type { ListingFacts } from "@/script/templates";

/** The row every term falls back to when an engine has no tuned form yet. */
const DEFAULT_ENGINE = "default";

/** `generation_jobs.output_url` / `provider_output_url` are varchar(1024). */
const MAX_URL_LENGTH = 1024;
/** `generation_jobs.error` is TEXT; well under the limit, and readable. */
const MAX_ERROR_LENGTH = 4000;

/**
 * Column widths are enforced here rather than trusted from callers. An
 * oversized value does not fail politely: MySQL rejects the write, and the
 * driver's error quotes the offending parameter, so the follow-up write that
 * records the failure carries the same oversized value and fails in turn —
 * losing the job row entirely. Clamping at the boundary that owns the schema
 * keeps one bad value from erasing its own evidence.
 */
function clamp(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export class DrizzleLexiconRepository implements LexiconRepository {
  async entriesForEngine(engine: string): Promise<ResolvedLexiconEntry[]> {
    const terms = await db
      .select({
        id: joparaLexicon.id,
        term: joparaLexicon.term,
        language: joparaLexicon.language,
      })
      .from(joparaLexicon);

    // Both candidate engines in one pass, resolved in memory. The lexicon is
    // small by nature — it is a hand-curated glossary, not a corpus — and a
    // correlated per-term subquery would be slower and much harder to read.
    const pronunciations = await db
      .select({
        termId: lexiconPronunciations.termId,
        engine: lexiconPronunciations.engine,
        speechForm: lexiconPronunciations.speechForm,
      })
      .from(lexiconPronunciations)
      .where(inArray(lexiconPronunciations.engine, [engine, DEFAULT_ENGINE]));

    const preferred = new Map<number, string>();
    const fallback = new Map<number, string>();
    for (const row of pronunciations) {
      if (row.engine === engine) preferred.set(row.termId, row.speechForm);
      else fallback.set(row.termId, row.speechForm);
    }

    return terms.map((term) => ({
      termId: term.id,
      term: term.term,
      language: term.language,
      // A term with no pronunciation row at all still has to MATCH, or the
      // detection rule would flag a word that is demonstrably in the lexicon.
      // Its own spelling is the honest speech form until someone tunes one.
      speechForm: preferred.get(term.id) ?? fallback.get(term.id) ?? term.term,
    }));
  }
}

export class DrizzlePronunciationRepository implements PronunciationRepository {
  async ensureForEngine(termId: number, engine: string, speechForm: string): Promise<number> {
    const existing = await db
      .select({ id: lexiconPronunciations.id })
      .from(lexiconPronunciations)
      .where(
        and(eq(lexiconPronunciations.termId, termId), eq(lexiconPronunciations.engine, engine)),
      )
      .limit(1);
    // Never overwrite: an existing row may carry a hand-tuned respelling and a
    // speaker's verification, and this runs on every harness pass.
    if (existing[0]) return existing[0].id;

    const [inserted] = await db
      .insert(lexiconPronunciations)
      .values({ termId, engine, speechForm, verified: false });
    return inserted.insertId;
  }

  async attachSample(termId: number, engine: string, sampleAudioUrl: string): Promise<void> {
    await db
      .update(lexiconPronunciations)
      .set({ sampleAudioUrl: clamp(sampleAudioUrl, MAX_URL_LENGTH) })
      .where(
        and(eq(lexiconPronunciations.termId, termId), eq(lexiconPronunciations.engine, engine)),
      );
  }
}

export class DrizzleUnresolvedTermsRepository implements UnresolvedTermsRepository {
  async record(sightings: UnresolvedSightingInput[]): Promise<void> {
    for (const sighting of sightings) {
      await db
        .insert(unresolvedTerms)
        .values({
          term: sighting.term,
          language: sighting.language,
          scriptLineId: sighting.scriptLineId,
          occurrences: sighting.occurrences,
        })
        .onDuplicateKeyUpdate({
          set: {
            occurrences: sql`${unresolvedTerms.occurrences} + ${sighting.occurrences}`,
            // `status` is deliberately untouched, so a term already promoted or
            // ignored is not silently reopened. `script_line_id` DOES move to
            // the newest sighting: regenerating a script deletes its old lines,
            // and a queue entry pointing at a deleted line gives the reviewer
            // no context at all.
            ...(sighting.scriptLineId === null ? {} : { scriptLineId: sighting.scriptLineId }),
          },
        });
    }
  }
}

export class DrizzleScriptRepository implements ScriptRepository {
  async replaceScript(input: {
    projectId: number;
    language: "es" | "gn";
    lines: ScriptLineInput[];
  }): Promise<{ scriptId: number; lines: StoredScriptLine[] }> {
    return db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: scripts.id })
        .from(scripts)
        .where(and(eq(scripts.projectId, input.projectId), eq(scripts.language, input.language)))
        .limit(1);

      let scriptId = existing[0]?.id;
      if (scriptId === undefined) {
        const [inserted] = await tx
          .insert(scripts)
          .values({ projectId: input.projectId, language: input.language });
        scriptId = inserted.insertId;
      }

      const oldLines = await tx
        .select({ id: scriptLines.id })
        .from(scriptLines)
        .where(eq(scriptLines.scriptId, scriptId));

      if (oldLines.length > 0) {
        const oldIds = oldLines.map((line) => line.id);
        // `unresolved_terms.script_line_id` is a real FK, so the queue has to
        // let go of these rows before they can be deleted. The term stays
        // queued — it is still unresolved — it just loses its line context.
        await tx
          .update(unresolvedTerms)
          .set({ scriptLineId: null })
          .where(inArray(unresolvedTerms.scriptLineId, oldIds));
        await tx.delete(scriptLines).where(inArray(scriptLines.id, oldIds));
      }

      const stored: StoredScriptLine[] = [];
      for (const [index, line] of input.lines.entries()) {
        const lineNumber = index + 1;
        const [inserted] = await tx.insert(scriptLines).values({
          scriptId,
          lineNumber,
          displayText: line.displayText,
          speechText: line.speechText,
          provisional: line.provisional,
        });
        stored.push({ id: inserted.insertId, lineNumber, ...line });
      }

      return { scriptId, lines: stored };
    });
  }

  async linesFor(scriptId: number): Promise<StoredScriptLine[]> {
    const rows = await db
      .select({
        id: scriptLines.id,
        lineNumber: scriptLines.lineNumber,
        displayText: scriptLines.displayText,
        speechText: scriptLines.speechText,
        provisional: scriptLines.provisional,
      })
      .from(scriptLines)
      .where(eq(scriptLines.scriptId, scriptId))
      .orderBy(asc(scriptLines.lineNumber));
    return rows;
  }
}

export class DrizzleJobRepository implements JobRepository {
  async create(input: JobCreateInput): Promise<number> {
    const [inserted] = await db.insert(generationJobs).values({
      kind: input.kind,
      provider: input.provider,
      engine: input.engine,
      inputRef: input.inputRef,
      status: "pending",
    });
    return inserted.insertId;
  }

  async markRunning(id: number, providerJobId?: string): Promise<void> {
    await db
      .update(generationJobs)
      .set({ status: "running", ...(providerJobId ? { providerJobId } : {}) })
      .where(eq(generationJobs.id, id));
  }

  async complete(id: number, completion: JobCompletion): Promise<void> {
    await db
      .update(generationJobs)
      .set({
        status: "completed",
        outputUrl: clamp(completion.outputUrl, MAX_URL_LENGTH),
        providerOutputUrl: clamp(completion.providerOutputUrl, MAX_URL_LENGTH),
        durationMs: completion.durationMs,
        // DECIMAL columns take strings: routing money through a float and back
        // is how a cost rollup stops adding up.
        costRawAmount: completion.costRawAmount.toFixed(4),
        costRawUnit: completion.costRawUnit,
        costUsd: completion.costUsd === null ? null : completion.costUsd.toFixed(6),
      })
      .where(eq(generationJobs.id, id));
  }

  async fail(id: number, error: string, cost?: JobCost): Promise<void> {
    await db
      .update(generationJobs)
      .set({
        status: "failed",
        error: clamp(error, MAX_ERROR_LENGTH),
        // A failure after the provider charged is still spend, and a cost
        // dashboard that only sums completed jobs would never see it.
        ...(cost
          ? {
              costRawAmount: cost.costRawAmount.toFixed(4),
              costRawUnit: cost.costRawUnit,
              costUsd: cost.costUsd === null ? null : cost.costUsd.toFixed(6),
            }
          : {}),
      })
      .where(eq(generationJobs.id, id));
  }

  async listByAbRun(abRunId: string): Promise<JobRow[]> {
    const rows = await db
      .select({
        id: generationJobs.id,
        kind: generationJobs.kind,
        provider: generationJobs.provider,
        engine: generationJobs.engine,
        status: generationJobs.status,
        inputRef: generationJobs.inputRef,
        outputUrl: generationJobs.outputUrl,
        durationMs: generationJobs.durationMs,
        costUsd: generationJobs.costUsd,
        error: generationJobs.error,
      })
      .from(generationJobs)
      // The run id lives in the JSON input_ref rather than a column: adding a
      // column would be a migration, and later phases are forbidden from
      // migrating (plan §5.1).
      .where(sql`JSON_UNQUOTE(JSON_EXTRACT(${generationJobs.inputRef}, '$.abRunId')) = ${abRunId}`)
      .orderBy(asc(generationJobs.engine), asc(generationJobs.id));
    return rows;
  }
}

/** Resolves our `voices.id` into Higgsfield's addressing tuple (opus-1 §2). */
export class DrizzleVoiceResolver implements VoiceResolver {
  async resolve(voiceRef: number) {
    const rows = await db
      .select({
        providerVoiceId: voices.providerVoiceId,
        providerParams: voices.providerParams,
      })
      .from(voices)
      .where(eq(voices.id, voiceRef))
      .limit(1);

    const row = rows[0];
    if (!row) throw new Error(`No voices row with id ${voiceRef}`);

    const params = (row.providerParams ?? {}) as {
      model?: string;
      variant?: string;
      voiceType?: "preset" | "element";
      voice_type?: "preset" | "element";
    };
    if (!params.model) {
      throw new Error(
        `voices row ${voiceRef} has no provider_params.model — seed it with ` +
          "scripts/seed-voices.ts before using it.",
      );
    }

    return {
      model: params.model,
      ...(params.variant ? { variant: params.variant } : {}),
      voiceType: params.voiceType ?? params.voice_type ?? ("preset" as const),
      voiceId: row.providerVoiceId,
    };
  }
}

/**
 * Credits → USD via `provider_rates`. Returns null when no rate is on file,
 * which is deliberate: an unknown cost must read as unknown. Raw credits are
 * recorded either way, so a rate added later can be applied retroactively.
 */
export class DrizzleRateConverter implements RateConverter {
  async toUsd(provider: ProviderName, unit: string, amount: number): Promise<number | null> {
    const rows = await db
      .select({ usdPerUnit: providerRates.usdPerUnit })
      .from(providerRates)
      .where(and(eq(providerRates.provider, provider), eq(providerRates.unit, unit)))
      .orderBy(desc(providerRates.effectiveFrom))
      .limit(1);

    const rate = rows[0]?.usdPerUnit;
    if (rate === undefined) return null;
    return Number((amount * Number(rate)).toFixed(6));
  }
}

/**
 * Loads the facts a script is allowed to state, for one project.
 *
 * The return type is `ListingFacts` rather than the row type on purpose: it is
 * the narrow set of columns the templates may read, so nothing downstream can
 * quietly start narrating a field that was never meant to be spoken.
 */
export async function loadListingFacts(projectId: number): Promise<ListingFacts | null> {
  const rows = await db
    .select({
      address: listings.address,
      neighborhood: listings.neighborhood,
      city: listings.city,
      price: listings.price,
      currency: listings.currency,
      rooms: listings.rooms,
      bathrooms: listings.bathrooms,
      areaM2: listings.areaM2,
      features: listings.features,
    })
    .from(listings)
    .where(eq(listings.projectId, projectId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { ...row, features: row.features ?? null };
}

/**
 * The stored Guaraní script lines for a project, in order.
 *
 * The A/B harness needs these so its job rows reference real `script_lines`
 * rows. Returns empty when no script has been generated yet, which the caller
 * handles by recording no reference rather than inventing one.
 */
export async function loadGuaraniScriptLines(
  projectId: number,
): Promise<StoredScriptLine[]> {
  const found = await db
    .select({ id: scripts.id })
    .from(scripts)
    .where(and(eq(scripts.projectId, projectId), eq(scripts.language, "gn")))
    .limit(1);

  if (!found[0]) return [];
  return new DrizzleScriptRepository().linesFor(found[0].id);
}

/** Convenience for CLI scripts and the standalone route: a voice for one engine. */
export async function findVoiceForEngine(
  engine: string,
  provider = "higgsfield",
): Promise<{ id: number; label: string } | null> {
  const rows = await db
    .select({ id: voices.id, label: voices.label })
    .from(voices)
    .where(and(eq(voices.engine, engine), eq(voices.provider, provider)))
    .orderBy(asc(voices.id))
    .limit(1);
  return rows[0] ?? null;
}
