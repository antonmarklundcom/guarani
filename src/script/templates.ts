/**
 * Listing fields → script lines, in both languages (plan §3.1, §5.2).
 *
 * THE GUARDRAIL: this module is a set of templates filled strictly from typed
 * listing fields. There is no free-text generation anywhere in the pipeline and
 * no LLM output is ever the source of truth for a fact (plan §11.5). A fact
 * that is not a `ListingFacts` field cannot appear in a script, and a field
 * that is null simply drops its line — the script gets shorter, it never gets
 * invented. The only string in a finished script that does not come from the
 * listing is the call to action, and that is an explicit caller-supplied option
 * with a documented default, precisely so it cannot arrive by accident.
 *
 * ON THE GUARANÍ TEMPLATES: they are modelled sentence-for-sentence on the
 * three jopara sentences the plan itself uses for the opus-1 go/no-go gate
 * (§9), rather than composed freely. That is a deliberate risk control —
 * confidently wrong Guaraní is worse for this product than no Guaraní at all
 * (plan §11.7) — but it is NOT a substitute for review. These templates are
 * unverified until the §7 native speaker signs off on them; see KNOWN-ISSUES.
 */

import {
  verbalizeArea,
  verbalizeCount,
  verbalizeEmbeddedNumbers,
  verbalizePrice,
  type Currency,
  type ScriptLanguage,
  type Verbalized,
} from "./verbalize";

/**
 * Exactly the facts a script may state. Mirrors the `listings` columns rather
 * than the Drizzle row type so this stays a pure function of listing data — and
 * so adding a script fact requires adding a listing column, which is the point.
 */
export type ListingFacts = {
  address: string;
  neighborhood: string | null;
  city: string | null;
  price: string | null;
  currency: Currency;
  rooms: number | null;
  bathrooms: number | null;
  areaM2: string | null;
  features: string[] | null;
};

/** One line, before lexicon resolution turns `speech` into final speech_text. */
export type DraftLine = { display: string; speech: string };

export type TemplateOptions = {
  /**
   * The one line not derived from listing data. Defaults below are WhatsApp-first
   * because that is how Paraguayan agents actually take enquiries (plan §1).
   * Pass null to omit the call to action entirely.
   */
  callToAction?: string | null;
};

const DEFAULT_CTA: Record<ScriptLanguage, string> = {
  es: "Escribinos por WhatsApp para agendar una visita.",
  gn: "Ikatu reñe'ẽ oreve WhatsApp rupive.",
};

/**
 * Joins literal text and verbalized values into a line's two forms at once.
 * Literals appear identically in both; a `Verbalized` contributes its display
 * form to one and its speech form to the other. This is what keeps the caption
 * and the narration from drifting apart as templates are edited.
 */
function line(...parts: Array<string | Verbalized>): DraftLine {
  let display = "";
  let speech = "";
  for (const part of parts) {
    if (typeof part === "string") {
      display += part;
      speech += part;
    } else {
      display += part.display;
      speech += part.speech;
    }
  }
  // The speech form often begins with a verbalized number ("tres dormitorios")
  // where the caption begins with a digit, so its first letter has to be
  // capitalized here rather than inherited from the template literal.
  return { display, speech: capitalizeFirst(speech) };
}

function capitalizeFirst(text: string): string {
  // Anchored, so a line that legitimately opens with something other than a
  // letter is left alone rather than having a letter mid-string capitalized.
  return text.replace(/^(\s*)(\p{L})/u, (_match, space, first) => space + first.toUpperCase());
}

/** "a, b y c" / "a, b ha c" — Spanish and Guaraní differ only in the conjunction. */
function joinList(items: string[], conjunction: string): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  const last = items[items.length - 1];
  return `${items.slice(0, -1).join(", ")} ${conjunctionFor(conjunction, last)} ${last}`;
}

/**
 * Spanish "y" becomes "e" before a word starting with an i sound — "garaje e
 * iluminación". Features are free text supplied per listing, and "iluminación",
 * "internet" and "instalación" are all ordinary entries, so this is a real case
 * rather than a grammar-pedantry one. "hie-" keeps "y" ("agua y hielo").
 */
function conjunctionFor(conjunction: string, nextWord: string): string {
  if (conjunction !== "y") return conjunction;
  const normalized = nextWord.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (/^hie/.test(normalized)) return "y";
  return /^h?i/.test(normalized) ? "e" : "y";
}

function spanishLines(facts: ListingFacts, options: TemplateOptions): DraftLine[] {
  const lines: DraftLine[] = [];

  const place = [facts.neighborhood, facts.city].filter(Boolean).join(", ");
  if (place) lines.push(line(`Propiedad en ${place}.`));

  lines.push(line("Ubicada en ", verbalizeEmbeddedNumbers(facts.address), "."));

  const rooms = facts.rooms === null ? null : verbalizeCount(facts.rooms, "es");
  const baths = facts.bathrooms === null ? null : verbalizeCount(facts.bathrooms, "es");
  if (rooms && baths) {
    lines.push(
      line(
        rooms, facts.rooms === 1 ? " dormitorio y " : " dormitorios y ",
        baths, facts.bathrooms === 1 ? " baño." : " baños.",
      ),
    );
  } else if (rooms) {
    lines.push(line(rooms, facts.rooms === 1 ? " dormitorio." : " dormitorios."));
  } else if (baths) {
    lines.push(line(baths, facts.bathrooms === 1 ? " baño." : " baños."));
  }

  if (facts.areaM2 !== null) {
    lines.push(line(verbalizeArea(facts.areaM2), " de superficie."));
  }

  const features = facts.features?.filter((f) => f.trim() !== "") ?? [];
  if (features.length > 0) {
    lines.push(line(`Cuenta con ${joinList(features, "y")}.`));
  }

  if (facts.price !== null) {
    lines.push(line("Precio: ", verbalizePrice(facts.price, facts.currency), "."));
  }

  const cta = options.callToAction === undefined ? DEFAULT_CTA.es : options.callToAction;
  if (cta) lines.push(line(cta));

  return lines;
}

/**
 * Guaraní/jopara lines. Each sentence shape below is taken from the plan's own
 * gate sentences:
 *   S1 "Ko óga porã oĩ Barrio San Vicente-pe, orekóva mbohapy koty ha mokõi baño."
 *   S2 "Ovende hína ochocientos cincuenta millones de guaraníes rehe, …"
 *   S3 "Oguereko ciento veinte metros cuadrados, garaje ha jardín tuicháva."
 *
 * The noun is "propiedad", not "óga" (house): `listings` has no property-type
 * column, so calling every listing a house would be inventing a fact — and
 * "propiedad" inside a Guaraní sentence is ordinary jopara, not a compromise.
 */
function guaraniLines(facts: ListingFacts, options: TemplateOptions): DraftLine[] {
  const lines: DraftLine[] = [];

  const places = [facts.neighborhood, facts.city].filter(Boolean) as string[];
  if (places.length > 0) {
    lines.push(line(`Ko propiedad oĩ ${places.map((p) => `${p}-pe`).join(", ")}.`));
  }

  lines.push(line("Tapé: ", verbalizeEmbeddedNumbers(facts.address), "."));

  const rooms = facts.rooms === null ? null : verbalizeCount(facts.rooms, "gn");
  const baths = facts.bathrooms === null ? null : verbalizeCount(facts.bathrooms, "gn");
  if (rooms && baths) {
    lines.push(line("Orekóva ", rooms, " koty ha ", baths, " baño."));
  } else if (rooms) {
    lines.push(line("Orekóva ", rooms, " koty."));
  } else if (baths) {
    lines.push(line("Orekóva ", baths, " baño."));
  }

  const features = facts.features?.filter((f) => f.trim() !== "") ?? [];
  if (facts.areaM2 !== null && features.length > 0) {
    lines.push(line("Oguereko ", verbalizeArea(facts.areaM2), `, ${joinList(features, "ha")}.`));
  } else if (facts.areaM2 !== null) {
    lines.push(line("Oguereko ", verbalizeArea(facts.areaM2), "."));
  } else if (features.length > 0) {
    lines.push(line(`Oguereko ${joinList(features, "ha")}.`));
  }

  if (facts.price !== null) {
    lines.push(line("Ovende hína ", verbalizePrice(facts.price, facts.currency), " rehe."));
  }

  const cta = options.callToAction === undefined ? DEFAULT_CTA.gn : options.callToAction;
  if (cta) lines.push(line(cta));

  return lines;
}

export function buildDraftLines(
  facts: ListingFacts,
  language: ScriptLanguage,
  options: TemplateOptions = {},
): DraftLine[] {
  return language === "es" ? spanishLines(facts, options) : guaraniLines(facts, options);
}
