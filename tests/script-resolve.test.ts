/**
 * The unresolved-terms detection rule — plan §5.2, clause by clause.
 *
 * The rule as written:
 *   any token in a GN/jopara script that (a) does not longest-match a lexicon
 *   entry and (b) is not on an explicit Spanish-passthrough allowlist → a row
 *   in `unresolved_terms`; the pipeline uses the raw form flagged `provisional`
 *   rather than blocking.
 *
 * Each behaviour below maps to a clause, plus the two subtleties the rule names
 * explicitly (multi-word terms, casing) and the one it implies (never blocking).
 */

import { describe, expect, it } from "vitest";
import {
  buildLexiconIndex,
  normalizeTerm,
  resolveSpeechText,
  shouldRecordUnresolved,
  type ResolvedLexiconEntry,
} from "@/script/resolve";
import { SPANISH_PASSTHROUGH } from "@/script/passthrough";

const PASSTHROUGH = new Set(SPANISH_PASSTHROUGH.map(normalizeTerm));

const entries: ResolvedLexiconEntry[] = [
  { termId: 1, term: "óga", language: "gn", speechForm: "oga" },
  { termId: 2, term: "óga porã", language: "jopara", speechForm: "oga porã" },
  { termId: 3, term: "koty", language: "gn", speechForm: "kotý" },
  { termId: 4, term: "mbohapy", language: "gn", speechForm: "mbohapɨ" },
  { termId: 5, term: "ha", language: "gn", speechForm: "ha" },
  { termId: 6, term: "oĩ", language: "gn", speechForm: "oĩ" },
  { termId: 7, term: "pe", language: "gn", speechForm: "pe" },
  { termId: 8, term: "reñe'ẽ", language: "gn", speechForm: "reñe'ẽ" },
  // A hyphenated multi-word term, of exactly the shape a reviewer promoting
  // "San Vicente-pe" out of the queue would create.
  { termId: 9, term: "San Vicente-pe", language: "jopara", speechForm: "san bisénte-pe" },
];

const index = buildLexiconIndex(entries);

function resolve(text: string, recordUnresolved = true) {
  return resolveSpeechText(text, { index, passthrough: PASSTHROUGH, recordUnresolved });
}

describe("clause (a): longest-match against the lexicon", () => {
  it("substitutes an entry's speech form", () => {
    // Sentence-initial capitalization is the template layer's job, not this
    // one's — the resolver only mirrors the casing of the token it replaces.
    expect(resolve("mbohapy koty").speechText).toBe("mbohapɨ kotý");
  });

  it("prefers the longer term when a shorter one also matches", () => {
    // "óga porã" must win over "óga" — one pronunciation decision, not two.
    const result = resolve("Ko óga porã.");
    expect(result.speechText).toBe("Ko oga porã.");
    expect(result.matchedTermIds).toContain(2);
    expect(result.matchedTermIds).not.toContain(1);
  });

  it("does not bridge punctuation when matching a multi-word term", () => {
    // "óga, porã" is two adjacent words, not the term "óga porã".
    const result = resolve("óga, porã");
    expect(result.matchedTermIds).toContain(1);
    expect(result.matchedTermIds).not.toContain(2);
  });

  it("matches regardless of casing and mirrors the capitalization back", () => {
    expect(resolve("Óga").speechText).toBe("Oga");
    expect(resolve("óga").speechText).toBe("oga");
  });

  it("does not fold diacritics — in Guaraní they are the word", () => {
    // "porã" and "pora" are different words; folding the tilde would merge them.
    const result = resolve("pora");
    expect(result.unresolved.map((u) => u.term)).toContain("pora");
  });

  it("treats the three glottal-stop apostrophes as one character", () => {
    // The orthography prescribes ʼ (U+02BC); real text uses ' and ’ too.
    expect(resolve("reñeʼẽ").speechText).toBe("reñe'ẽ");
    expect(resolve("reñe’ẽ").unresolved).toEqual([]);
  });

  it("splits on hyphens so a locative suffix is looked up on its own", () => {
    // "Vicente-pe" with no phrase entry: the suffix resolves, the noun does not.
    const result = resolve("Vicente-pe");
    expect(result.matchedTermIds).toContain(7);
    expect(result.unresolved.map((u) => u.term)).toEqual(["Vicente"]);
  });

  it("matches a multi-word term that contains a hyphen", () => {
    // The tokenizer splits hyphens, so a term keyed on its literal text would
    // be permanently unmatchable — the span loop counts tokens, and would never
    // try a three-token span for a key that looks two words long.
    const result = resolve("Oĩ San Vicente-pe.");
    // Capitalized from the surface form, as with any other match.
    expect(result.speechText).toBe("Oĩ San bisénte-pe.");
    expect(result.matchedTermIds).toContain(9);
    expect(result.unresolved).toEqual([]);
  });

  it("still refuses to bridge a comma inside a multi-word term", () => {
    const result = resolve("San, Vicente-pe");
    expect(result.matchedTermIds).not.toContain(9);
    expect(result.unresolved.map((u) => u.term)).toEqual(["San", "Vicente"]);
  });
});

describe("clause (b): the Spanish-passthrough allowlist", () => {
  it("lets allowlisted Spanish through without flagging it", () => {
    // Verbalization deliberately emits Spanish numerals into Guaraní speech.
    const result = resolve("ochocientos cincuenta millones de guaraníes");
    expect(result.unresolved).toEqual([]);
    expect(result.provisional).toBe(false);
  });

  it("still flags a proper noun, which never belongs on the allowlist", () => {
    const result = resolve("Barrio San Vicente");
    expect(result.unresolved.map((u) => u.term)).toEqual(["San", "Vicente"]);
  });
});

describe("the consequence: flag and continue, never block", () => {
  it("uses the raw form for an unresolved token", () => {
    const result = resolve("Ko óga Ñemby-pe.");
    expect(result.speechText).toContain("Ñemby");
    expect(result.provisional).toBe(true);
  });

  it("counts repeat sightings of the same term", () => {
    const result = resolve("Ñemby ha Ñemby");
    expect(result.unresolved).toEqual([{ term: "Ñemby", occurrences: 2 }]);
  });

  it("leaves punctuation and spacing untouched around substitutions", () => {
    expect(resolve("Orekóva mbohapy koty, ha koty.").speechText).toBe(
      "Orekóva mbohapɨ kotý, ha kotý.",
    );
  });

  it("marks nothing provisional when everything resolved", () => {
    expect(resolve("mbohapy koty ha koty").provisional).toBe(false);
  });
});

describe("scope of the rule", () => {
  it("records unresolved terms for Guaraní scripts", () => {
    expect(shouldRecordUnresolved("gn")).toBe(true);
  });

  it("does not fill the queue from Spanish scripts", () => {
    // The rule is scoped to GN/jopara. Spanish scripts still get lexicon
    // respellings — a Guaraní place name is one wherever it appears — but
    // ordinary Spanish must not be filed as needing pronunciation review.
    expect(shouldRecordUnresolved("es")).toBe(false);

    const result = resolve("Propiedad en Ñemby", false);
    expect(result.unresolved).toEqual([]);
    expect(result.provisional).toBe(false);
    expect(result.speechText).toContain("Ñemby");
  });
});

describe("digits reaching the resolver", () => {
  it("flags a bare numeral, because verbalization should have removed it", () => {
    const result = resolve("Ha 120 metros cuadrados");
    expect(result.unresolved.map((u) => u.term)).toEqual(["120"]);
  });
});
