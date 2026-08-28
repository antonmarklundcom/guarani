/**
 * Seeds jopara_lexicon with common real-estate terms so opus-2 has something to
 * test against (plan §5.1). Idempotent: safe to re-run.
 *
 * Every entry gets a `default`-engine pronunciation row. Engine-specific rows
 * are added by opus-2's A/B harness as respellings get tuned per engine — the
 * `default` row is only the fallback, never the final answer.
 *
 * IMPORTANT: `verified` is false on every row here and must stay false until a
 * competent Guaraní speaker has listened to a rendered sample and approved it
 * (plan §7). These speech forms are a starting point for that review, not
 * verified pronunciations. Confidently-wrong Guaraní is worse than none for a
 * product whose whole pitch is authenticity (plan §11.7).
 */

import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { joparaLexicon, lexiconPronunciations } from "@/db/schema";

type SeedTerm = {
  term: string;
  language: "gn" | "es" | "jopara";
  speechForm: string;
  notes: string;
};

/**
 * Stress notes matter: Guaraní stresses the final syllable by default, Spanish
 * engines stress the penultimate. That mismatch is the most common
 * mispronunciation cause, so every row records the intended stress.
 */
const TERMS: SeedTerm[] = [
  { term: "óga", language: "gn", speechForm: "oga", notes: "house. Stress on ó (first syllable) — irregular, marked by the accent." },
  { term: "koty", language: "gn", speechForm: "kotý", notes: "room/bedroom. Final-syllable stress. Final y is /ɨ/, not Spanish i." },
  { term: "kokue", language: "gn", speechForm: "kokue", notes: "field/plot of land. Final-syllable stress." },
  { term: "tapé", language: "gn", speechForm: "tapé", notes: "street/road. Final-syllable stress." },
  { term: "yvy", language: "gn", speechForm: "ɨvɨ", notes: "land/ground. Both vowels /ɨ/ — the hardest term for Spanish-tuned engines." },
  { term: "óga porã", language: "jopara", speechForm: "oga porã", notes: "nice house. Multi-word term — tokenizer must longest-match this before 'óga'." },
  { term: "tuicháva", language: "gn", speechForm: "tuicháva", notes: "big/large. Stress on chá." },
  { term: "michĩva", language: "gn", speechForm: "michĩva", notes: "small. Nasal ĩ." },
  { term: "mbohapy", language: "gn", speechForm: "mbohapɨ", notes: "three. Prenasalized mb. Final y is /ɨ/." },
  { term: "mokõi", language: "gn", speechForm: "mokõi", notes: "two. Nasal õ." },
  { term: "peteĩ", language: "gn", speechForm: "peteĩ", notes: "one. Nasal ĩ, final-syllable stress." },
  { term: "porã", language: "gn", speechForm: "porã", notes: "good/beautiful. Nasal ã, final-syllable stress." },
  { term: "pyahu", language: "gn", speechForm: "pɨahu", notes: "new. Initial /ɨ/." },
  { term: "hepy", language: "gn", speechForm: "hepɨ", notes: "expensive. Final /ɨ/." },
  { term: "hepyʼỹ", language: "gn", speechForm: "hepɨʼỹ", notes: "cheap. Glottal stop (ʼ) then nasal ỹ — most engines drop the glottal; check first." },
  { term: "ñemuha", language: "gn", speechForm: "ñemuha", notes: "shop/market." },
  { term: "róga", language: "gn", speechForm: "roga", notes: "his/her house (possessed form of óga)." },
  { term: "baño", language: "es", speechForm: "baño", notes: "bathroom. Spanish passthrough — kept so the allowlist and the lexicon agree." },
  { term: "garaje", language: "es", speechForm: "garaje", notes: "garage. Spanish passthrough." },
  { term: "avenida", language: "es", speechForm: "avenida", notes: "avenue. Spanish passthrough." },
  { term: "calle", language: "es", speechForm: "calle", notes: "street. Spanish passthrough." },
  { term: "dormitorio", language: "es", speechForm: "dormitorio", notes: "bedroom. Spanish passthrough." },
  { term: "jardín", language: "es", speechForm: "jardín", notes: "garden. Spanish passthrough." },
  { term: "guaraní", language: "es", speechForm: "guaraní", notes: "the currency and the language. Final-syllable stress in both." },

  // --- Added in opus-2: the vocabulary the Guaraní templates actually emit ---
  //
  // These are here for a structural reason, not for coverage. The §5.2
  // detection rule flags any token in a Guaraní script that neither matches the
  // lexicon nor sits on the Spanish-passthrough allowlist. Every Guaraní word a
  // template produces is therefore either a lexicon entry or a false alarm, and
  // a queue full of "ha" and "oĩ" would bury the terms that genuinely need a
  // human — the neighbourhood and street names that arrive with each listing.
  // Widening the allowlist instead was not an option: the rule names a SPANISH
  // allowlist, and a Guaraní word's pronunciation is exactly what the lexicon
  // is the single point of truth for.
  //
  // NOTE ON THESE SPEECH FORMS: they are the orthographic form, with stress
  // guidance in `notes` rather than baked into a respelling. That differs from
  // the opus-1 rows above, which carry IPA-flavoured guesses (`ɨvɨ`, `mbohapɨ`)
  // that no engine has been heard to interpret correctly — see KNOWN-ISSUES.
  // Respellings are engine-specific by design (plan §2), so the honest default
  // is "say what is written" and the tuned forms belong in per-engine rows the
  // A/B harness creates.
  { term: "ko", language: "gn", speechForm: "ko", notes: "this (demonstrative). Opens the standard listing sentence." },
  { term: "oĩ", language: "gn", speechForm: "oĩ", notes: "is/is located. Nasal ĩ; final-syllable stress." },
  { term: "pe", language: "gn", speechForm: "pe", notes: "locative suffix, written attached: 'San Vicente-pe'. The tokenizer splits on the hyphen, so it is looked up on its own." },
  { term: "orekóva", language: "gn", speechForm: "orekóva", notes: "which has. Stress on kó, marked by the accent." },
  { term: "oguereko", language: "gn", speechForm: "oguereko", notes: "it has. Final-syllable stress; a Spanish engine will want to stress 're' instead — first candidate for a per-engine respelling." },
  { term: "ovende", language: "gn", speechForm: "ovende", notes: "it is being sold. Jopara: Spanish 'vender' with the Guaraní o- prefix." },
  { term: "hína", language: "gn", speechForm: "hína", notes: "progressive marker. Stress on hí, marked." },
  { term: "rehe", language: "gn", speechForm: "rehe", notes: "for/at (postposition). Final-syllable stress." },
  { term: "ha", language: "gn", speechForm: "ha", notes: "and. The commonest word in any Guaraní script." },
  { term: "avei", language: "gn", speechForm: "avei", notes: "also/as well. Final-syllable stress." },
  { term: "ikatu", language: "gn", speechForm: "ikatu", notes: "it is possible / you can. Final-syllable stress." },
  { term: "reñe'ẽ", language: "gn", speechForm: "reñe'ẽ", notes: "you speak. Glottal stop then nasal ẽ — the hardest sequence in the call-to-action line; most engines drop the glottal. Check this one first." },
  { term: "oreve", language: "gn", speechForm: "oreve", notes: "to us. Final-syllable stress." },
  { term: "rupive", language: "gn", speechForm: "rupive", notes: "by means of / via. Used as 'WhatsApp rupive'." },
  { term: "irundy", language: "gn", speechForm: "irundy", notes: "four. Final y is /ɨ/. Emitted by the count verbalizer for 4 rooms." },
  { term: "po", language: "gn", speechForm: "po", notes: "five. Emitted by the count verbalizer for 5 rooms; also means 'hand'." },
];

async function main(): Promise<void> {
  let inserted = 0;
  let skipped = 0;

  for (const entry of TERMS) {
    const existing = await db
      .select({ id: joparaLexicon.id })
      .from(joparaLexicon)
      .where(
        and(
          eq(joparaLexicon.term, entry.term),
          eq(joparaLexicon.language, entry.language),
        ),
      )
      .limit(1);

    let termId = existing[0]?.id;

    if (termId === undefined) {
      const [result] = await db.insert(joparaLexicon).values({
        term: entry.term,
        language: entry.language,
        notes: entry.notes,
      });
      termId = result.insertId;
      inserted += 1;
    } else {
      skipped += 1;
    }

    const pronunciation = await db
      .select({ id: lexiconPronunciations.id })
      .from(lexiconPronunciations)
      .where(
        and(
          eq(lexiconPronunciations.termId, termId),
          eq(lexiconPronunciations.engine, "default"),
        ),
      )
      .limit(1);

    if (pronunciation.length === 0) {
      await db.insert(lexiconPronunciations).values({
        termId,
        engine: "default",
        speechForm: entry.speechForm,
        verified: false,
      });
    }
  }

  console.log(
    `Lexicon seed complete: ${inserted} term(s) inserted, ${skipped} already present, ` +
      `${TERMS.length} default-engine pronunciation(s) ensured.`,
  );
  console.log(
    "None are verified. A Guaraní speaker must listen to rendered samples " +
      "before any of these count as correct (plan §7).",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
