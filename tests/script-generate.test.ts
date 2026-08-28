/**
 * Script generation end to end — plan §3.1, §5.2.
 *
 * The behaviour that matters most here is negative: a script must not state
 * anything the listing does not say (plan §11.5). That is checked by leaving
 * fields null and asserting their lines are absent, and by asserting the two
 * strings stay in step — a caption showing "Gs. 850.000.000" beside narration
 * that says a different number is the failure this dual-string model exists to
 * prevent.
 */

import { describe, expect, it } from "vitest";
import { generateScripts } from "@/script/generate";
import type { ListingFacts } from "@/script/templates";
import { buildDraftLines } from "@/script/templates";
import {
  MemoryLexiconRepository,
  MemoryScriptRepository,
  MemoryUnresolvedTermsRepository,
  type LexiconSeed,
} from "./helpers/memory-repos";

const LEXICON: LexiconSeed[] = [
  { termId: 1, term: "ko", language: "gn", forms: { default: "ko" } },
  { termId: 2, term: "oĩ", language: "gn", forms: { default: "oĩ" } },
  { termId: 3, term: "pe", language: "gn", forms: { default: "pe" } },
  { termId: 4, term: "tapé", language: "gn", forms: { default: "tapé" } },
  { termId: 5, term: "orekóva", language: "gn", forms: { default: "orekóva" } },
  { termId: 6, term: "koty", language: "gn", forms: { default: "kotý" } },
  { termId: 7, term: "ha", language: "gn", forms: { default: "ha" } },
  { termId: 8, term: "oguereko", language: "gn", forms: { default: "oguereko" } },
  { termId: 9, term: "ovende", language: "gn", forms: { default: "ovende" } },
  { termId: 10, term: "hína", language: "gn", forms: { default: "hína" } },
  { termId: 11, term: "rehe", language: "gn", forms: { default: "rehe" } },
  { termId: 12, term: "ikatu", language: "gn", forms: { default: "ikatu" } },
  { termId: 13, term: "reñe'ẽ", language: "gn", forms: { default: "reñe'ẽ" } },
  { termId: 14, term: "oreve", language: "gn", forms: { default: "oreve" } },
  { termId: 15, term: "rupive", language: "gn", forms: { default: "rupive" } },
  { termId: 16, term: "mbohapy", language: "gn", forms: { default: "mbohapɨ" } },
  { termId: 17, term: "mokõi", language: "gn", forms: { default: "mokõi" } },
];

/** Matches the plan's gate sentences, so output can be compared against them. */
const SAN_VICENTE: ListingFacts = {
  address: "Avenida Mariscal López 1234",
  neighborhood: "Barrio San Vicente",
  city: "Asunción",
  price: "850000000.00",
  currency: "PYG",
  rooms: 3,
  bathrooms: 2,
  areaM2: "120.00",
  features: ["garaje", "jardín"],
};

function deps() {
  return {
    lexicon: new MemoryLexiconRepository(LEXICON),
    scripts: new MemoryScriptRepository(),
    unresolvedTerms: new MemoryUnresolvedTermsRepository(),
  };
}

describe("generating both languages from one listing", () => {
  it("writes a Spanish and a Guaraní script", async () => {
    const generated = await generateScripts({ projectId: 1, facts: SAN_VICENTE }, deps());
    expect(generated.map((s) => s.language)).toEqual(["es", "gn"]);
    expect(generated.every((s) => s.lines.length > 0)).toBe(true);
  });

  it("keeps numerals in the caption and words in the narration", async () => {
    const [spanish] = await generateScripts(
      { projectId: 1, facts: SAN_VICENTE, languages: ["es"] },
      deps(),
    );
    const price = spanish.lines.find((l) => l.displayText.includes("Gs."));

    expect(price?.displayText).toBe("Precio: Gs. 850.000.000.");
    expect(price?.speechText).toBe("Precio: ochocientos cincuenta millones de guaraníes.");
  });

  it("uses Guaraní numerals for counts and Spanish for the price", async () => {
    const [guarani] = await generateScripts(
      { projectId: 1, facts: SAN_VICENTE, languages: ["gn"] },
      deps(),
    );

    const rooms = guarani.lines.find((l) => l.displayText.includes("koty"));
    expect(rooms?.speechText).toBe("Orekóva mbohapɨ kotý ha mokõi baño.");

    const price = guarani.lines.find((l) => l.displayText.includes("Gs."));
    expect(price?.speechText).toBe(
      "Ovende hína ochocientos cincuenta millones de guaraníes rehe.",
    );
  });

  it("queues the proper nouns it could not resolve, and only those", async () => {
    const shared = deps();
    const [guarani] = await generateScripts(
      { projectId: 1, facts: SAN_VICENTE, languages: ["gn"] },
      shared,
    );

    expect(guarani.unresolved.map((u) => u.term).sort()).toEqual([
      "Asunción", "López", "Mariscal", "San", "Vicente",
    ]);
    expect(shared.unresolvedTerms.rows).toHaveLength(5);
    // Every queued sighting points at the line it came from.
    expect(shared.unresolvedTerms.rows.every((r) => r.scriptLineId !== null)).toBe(true);
  });

  it("flags exactly the lines carrying an unresolved term as provisional", async () => {
    const [guarani] = await generateScripts(
      { projectId: 1, facts: SAN_VICENTE, languages: ["gn"] },
      deps(),
    );
    const provisional = guarani.lines.filter((l) => l.provisional);

    // The neighbourhood line and the address line; nothing else.
    expect(provisional).toHaveLength(2);
    expect(provisional[0].displayText).toContain("Barrio San Vicente");
    expect(provisional[1].displayText).toContain("Mariscal López");
  });
});

describe("stating nothing the listing does not say", () => {
  it("drops the line for every absent field instead of inventing one", async () => {
    const sparse: ListingFacts = {
      address: "Calle Palma 500",
      neighborhood: null,
      city: null,
      price: null,
      currency: "PYG",
      rooms: null,
      bathrooms: null,
      areaM2: null,
      features: null,
    };

    const [spanish] = await generateScripts(
      { projectId: 2, facts: sparse, languages: ["es"] },
      deps(),
    );
    const text = spanish.lines.map((l) => l.displayText).join(" ");

    expect(text).toContain("Calle Palma 500");
    expect(text).not.toMatch(/dormitorio|baño|m²|Gs\.|Propiedad en/);
    // Address plus call to action, and nothing else.
    expect(spanish.lines).toHaveLength(2);
  });

  it("omits the call to action when the caller passes null", () => {
    const lines = buildDraftLines(SAN_VICENTE, "es", { callToAction: null });
    expect(lines.some((l) => l.display.includes("WhatsApp"))).toBe(false);
  });

  it("lets the caller replace the one line not drawn from the listing", () => {
    const lines = buildDraftLines(SAN_VICENTE, "gn", { callToAction: "Ehenói oreve." });
    expect(lines[lines.length - 1].display).toBe("Ehenói oreve.");
  });

  it("handles a single room and bathroom without pluralizing", () => {
    const lines = buildDraftLines({ ...SAN_VICENTE, rooms: 1, bathrooms: 1 }, "es");
    expect(lines.some((l) => l.display === "1 dormitorio y 1 baño.")).toBe(true);
  });
});

describe("re-running after a listing edit", () => {
  it("replaces the script rather than accumulating a second copy", async () => {
    const shared = deps();
    const first = await generateScripts(
      { projectId: 3, facts: SAN_VICENTE, languages: ["es"] },
      shared,
    );
    const second = await generateScripts(
      { projectId: 3, facts: { ...SAN_VICENTE, price: "900000000.00" }, languages: ["es"] },
      shared,
    );

    expect(second[0].scriptId).toBe(first[0].scriptId);
    expect(second[0].lines).toHaveLength(first[0].lines.length);
    expect(await shared.scripts.linesFor(second[0].scriptId)).toHaveLength(
      second[0].lines.length,
    );
    expect(second[0].lines.some((l) => l.displayText.includes("900.000.000"))).toBe(true);
  });
});

describe("engine-specific respellings", () => {
  it("bakes the named engine's speech form into speech_text", async () => {
    const tuned = new MemoryLexiconRepository([
      ...LEXICON.filter((s) => s.term !== "koty"),
      { termId: 6, term: "koty", language: "gn", forms: { default: "kotý", elevenlabs: "co-TEE" } },
    ]);

    const [guarani] = await generateScripts(
      { projectId: 4, facts: SAN_VICENTE, languages: ["gn"], engine: "elevenlabs" },
      { ...deps(), lexicon: tuned },
    );

    expect(guarani.lines.some((l) => l.speechText.includes("co-TEE"))).toBe(true);
  });
});
