/**
 * Lexicon resolution and the unresolved-terms detection rule — plan §5.2,
 * implemented exactly as specified there:
 *
 *   any token in a GN/jopara script that
 *     (a) does not longest-match a lexicon entry, and
 *     (b) is not on an explicit Spanish-passthrough allowlist
 *   → a row in `unresolved_terms`; the pipeline uses the raw form flagged
 *     `provisional` rather than blocking.
 *
 * The "rather than blocking" half is the important half. A missing
 * pronunciation must never stop a video from being produced — it must make
 * itself visible (plan §11.6). Everything here degrades to "say it the way it
 * is written, and tell someone".
 *
 * Two subtleties the rule names explicitly and this file therefore handles:
 *
 * - MULTI-WORD TERMS. "Barrio San Vicente" is one pronunciation decision, not
 *   three, so matching is longest-first across consecutive words. A match may
 *   bridge whitespace and hyphens — the locative in "San Vicente-pe" is part of
 *   the phrase — but not other punctuation: "óga, porã" is two terms with a
 *   comma between them, not the term "óga porã".
 *
 * - CASING. Lookups are case-folded, so a term seeded lowercase still matches
 *   at the start of a sentence. What is NOT folded is diacritics: in Guaraní a
 *   tilde is nasality and an acute is stress, both phonemic. Folding "porã" to
 *   "pora" would merge two different words.
 */

import type { ScriptLanguage } from "./verbalize";

/** A lexicon entry with its speech form already resolved for one engine. */
export type ResolvedLexiconEntry = {
  termId: number;
  term: string;
  language: "gn" | "es" | "jopara";
  /** From the engine-specific pronunciation row, or the `default` row. */
  speechForm: string;
};

export type LexiconIndex = {
  byKey: Map<string, ResolvedLexiconEntry>;
  maxWords: number;
};

export type UnresolvedSighting = {
  /** Surface form as it appeared, first-seen casing preserved for the reviewer. */
  term: string;
  occurrences: number;
};

export type ResolutionResult = {
  speechText: string;
  /** True when at least one token fell through to its raw form. */
  provisional: boolean;
  unresolved: UnresolvedSighting[];
  /** Lexicon rows actually used — the A/B harness attaches samples to these. */
  matchedTermIds: number[];
};

/**
 * The three apostrophes that all mean "glottal stop" in Guaraní writing:
 * ASCII ', typographic ’, and the modifier letter ʼ that the orthography
 * technically prescribes. Real text mixes them freely — the plan's own seed
 * data uses ʼ in `hepyʼỹ` while its gate sentence uses ' in `reñe'ẽ` — so they
 * are folded together for lookup or nothing would ever match.
 */
const APOSTROPHES = /['’ʼ]/g;

/**
 * A "word" is letters, combining marks (Guaraní's nasal g̃ is g + U+0303, which
 * has no precomposed form), digits, and internal apostrophes. Hyphens are
 * separators, so the locative "San Vicente-pe" yields "Vicente" and "pe" — the
 * suffix is its own pronunciation decision.
 *
 * Digits are included on purpose: a bare numeral reaching this stage means the
 * verbalization step missed one, and it is far better for that to surface in
 * the review queue than to reach an engine that will guess at it.
 */
const WORD_PATTERN = /[\p{L}\p{M}\p{N}'’ʼ]+/gu;

/** Whitespace and dashes may sit inside a multi-word term; other punctuation may not. */
const BRIDGEABLE_GAP = /^[\s\-\u2010-\u2015]+$/u;

/** Case-folded, apostrophe-unified, NFC-normalized. Diacritics survive. */
export function normalizeTerm(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(APOSTROPHES, "'")
    .replace(/\s+/g, " ")
    .trim();
}

type WordToken = { text: string; start: number; end: number };

function tokenize(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const raw = match[0];
    // Trim edge apostrophes: a quoted word should not carry the quote into the
    // lookup key, but an internal glottal stop must survive.
    const leading = raw.length - raw.replace(/^['’ʼ]+/, "").length;
    const trailing = raw.length - raw.replace(/['’ʼ]+$/, "").length;
    const trimmed = raw.slice(leading, raw.length - trailing);
    if (trimmed === "") continue;
    const start = match.index + leading;
    tokens.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return tokens;
}

/**
 * A term's lookup key is its TOKENS joined by single spaces — not its raw
 * normalized text.
 *
 * This matters because the tokenizer splits on hyphens: a term entered as
 * "San Vicente-pe" is three tokens, and keying it on its literal text would
 * make it permanently unmatchable — the span loop counts tokens, so it would
 * never even try a three-token span for a key that looks two words long.
 * Keying both sides the same way means however the reviewer punctuates a term,
 * it matches the same sequence of words in the text.
 */
function termTokens(text: string): string[] {
  return tokenize(text).map((token) => normalizeTerm(token.text));
}

export function buildLexiconIndex(entries: ResolvedLexiconEntry[]): LexiconIndex {
  const byKey = new Map<string, ResolvedLexiconEntry>();
  let maxWords = 1;
  for (const entry of entries) {
    const tokens = termTokens(entry.term);
    if (tokens.length === 0) continue;
    byKey.set(tokens.join(" "), entry);
    maxWords = Math.max(maxWords, tokens.length);
  }
  return { byKey, maxWords };
}

/** Mirrors the surface form's capitalization onto the speech form. */
function matchCapitalization(surface: string, speechForm: string): string {
  const first = surface[0];
  if (!first || first.toLowerCase() === first) return speechForm;
  return speechForm.charAt(0).toUpperCase() + speechForm.slice(1);
}

export type ResolveOptions = {
  index: LexiconIndex;
  passthrough: ReadonlySet<string>;
  /**
   * Whether unmatched tokens are reported for the review queue. The plan's rule
   * is scoped to GN/jopara scripts, so Spanish scripts still get the benefit of
   * lexicon respellings (a Guaraní place name in a Spanish sentence is still a
   * Guaraní place name) without filling the queue with ordinary Spanish.
   */
  recordUnresolved: boolean;
};

export function resolveSpeechText(text: string, options: ResolveOptions): ResolutionResult {
  const { index, passthrough, recordUnresolved } = options;
  const tokens = tokenize(text);

  const out: string[] = [];
  const unresolved = new Map<string, UnresolvedSighting>();
  const matchedTermIds = new Set<number>();
  let provisional = false;
  let cursor = 0;
  let i = 0;

  while (i < tokens.length) {
    const maxSpan = Math.min(index.maxWords, tokens.length - i);
    let matched: { entry: ResolvedLexiconEntry; span: number } | null = null;

    // Longest match first, so "óga porã" wins over "óga".
    for (let span = maxSpan; span >= 1 && !matched; span -= 1) {
      // A multi-word term may bridge whitespace and hyphens only. Hyphens are
      // word-internal in Guaraní — the locative in "San Vicente-pe" — while a
      // comma or a full stop means these are separate terms that merely happen
      // to be adjacent, and "óga, porã" is not the term "óga porã".
      let bridgeable = true;
      for (let k = 1; k < span && bridgeable; k += 1) {
        const between = text.slice(tokens[i + k - 1].end, tokens[i + k].start);
        bridgeable = BRIDGEABLE_GAP.test(between);
      }
      if (!bridgeable) continue;

      const key = tokens
        .slice(i, i + span)
        .map((token) => normalizeTerm(token.text))
        .join(" ");
      const entry = index.byKey.get(key);
      if (entry) matched = { entry, span };
    }

    if (matched) {
      const surface = text.slice(tokens[i].start, tokens[i + matched.span - 1].end);
      out.push(text.slice(cursor, tokens[i].start));
      out.push(matchCapitalization(surface, matched.entry.speechForm));
      cursor = tokens[i + matched.span - 1].end;
      matchedTermIds.add(matched.entry.termId);
      i += matched.span;
      continue;
    }

    const token = tokens[i];
    if (!passthrough.has(normalizeTerm(token.text))) {
      // Clause (a) and (b) both failed: use the raw form, flag the line, and
      // put the term in front of a human.
      if (recordUnresolved) {
        const key = normalizeTerm(token.text);
        const seen = unresolved.get(key);
        if (seen) seen.occurrences += 1;
        else unresolved.set(key, { term: token.text, occurrences: 1 });
        provisional = true;
      }
    }
    // Either way the raw form goes through untouched — nothing blocks.
    i += 1;
  }

  out.push(text.slice(cursor));

  return {
    speechText: out.join(""),
    provisional,
    unresolved: [...unresolved.values()],
    matchedTermIds: [...matchedTermIds],
  };
}

/** The rule is scoped to Guaraní/jopara scripts; Spanish ones only borrow respellings. */
export function shouldRecordUnresolved(language: ScriptLanguage): boolean {
  return language === "gn";
}
