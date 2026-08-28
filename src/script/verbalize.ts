/**
 * Numbers, prices and units → the two forms a script line needs (plan §3.1).
 *
 * Every value comes out as a `Verbalized` pair, because the two audiences are
 * different and always have been (plan §2, the dual-string model):
 *   - `display` is what a viewer reads in the burned-in caption: "Gs. 850.000.000"
 *   - `speech` is what the TTS engine is fed: "ochocientos cincuenta millones
 *     de guaraníes"
 *
 * PARAGUAYAN CONVENTIONS ENCODED HERE (market facts, not style preferences):
 *
 * 1. Guaraní amounts are written with a "Gs." prefix and DOT thousands
 *    separators — "Gs. 850.000.000" — and never with decimals. The currency has
 *    no subunit in practical use; a listing priced in céntimos does not exist.
 *
 * 2. Numbers inside Guaraní speech are said in Spanish. Guaraní has native
 *    numerals only for the low counts; everything above them — and every price,
 *    area and year — is borrowed from Spanish by every speaker in the country.
 *    This is not a shortcut, it is how jopara is actually spoken, and the plan's
 *    own go/no-go sentences are written that way ("Ovende hína ochocientos
 *    cincuenta millones de guaraníes rehe"). Producing "correct" pure-Guaraní
 *    numerals for a price would sound wrong to the audience it is aimed at.
 *
 * 3. Low counts in Guaraní speech DO use the native numerals — peteĩ, mokõi,
 *    mbohapy, irundy, po — for things like rooms and bathrooms, which is again
 *    what the plan's S1 sentence does ("mbohapy koty ha mokõi baño").
 *
 * The boundary between 2 and 3 is `GUARANI_NUMERALS.length`: at or below it,
 * native; above it, Spanish. That threshold is the one judgement call in this
 * file and it is the thing a native speaker should be asked to confirm.
 */

import { needsDeBeforeNoun, spellSpanishDecimal, spellSpanishInteger } from "./numbers";

/** A value in both the forms a script line needs. Never collapse these. */
export type Verbalized = { display: string; speech: string };

export type ScriptLanguage = "es" | "gn";

export type Currency = "PYG" | "USD";

/**
 * Native Guaraní cardinals, index 1–5. Above this, Guaraní speech uses the
 * Spanish numeral — see convention 2 above.
 */
const GUARANI_NUMERALS = ["", "peteĩ", "mokõi", "mbohapy", "irundy", "po"];

const CURRENCY_WORDS: Record<Currency, { one: string; many: string }> = {
  PYG: { one: "guaraní", many: "guaraníes" },
  USD: { one: "dólar", many: "dólares" },
};

const CURRENCY_PREFIX: Record<Currency, string> = { PYG: "Gs.", USD: "USD" };

/** Dot thousands separators, per convention 1 — not the browser's locale. */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * DECIMAL columns arrive from mysql2 as strings. Keeping them as strings until
 * the last moment is deliberate: a price is an exact quantity and a float is
 * not, and "850000000.00" through a float and back is how a listing acquires a
 * price of 849.999.999.
 */
function splitDecimalString(value: string | number): { whole: string; fraction: string } {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new RangeError(`Not a non-negative decimal: ${JSON.stringify(value)}`);
  }
  const [whole, fraction = ""] = text.split(".");
  return { whole, fraction: fraction.replace(/0+$/, "") };
}

/**
 * A price, in both forms.
 *
 * Guaraní prices drop any fractional part, for display AND speech: PYG has no
 * subunit in circulation, so "Gs. 850.000.000,50" is a data error rather than a
 * price, and reading it aloud would advertise the error. The fraction is
 * truncated rather than rounded — at half a guaraní the distinction is
 * academic, and truncating never inflates an advertised price. USD keeps its
 * cents when it has any.
 */
export function verbalizePrice(
  amount: string | number,
  currency: Currency,
): Verbalized {
  const { whole, fraction } = splitDecimalString(amount);

  // Cents exist only for USD. "1500.5" means fifty cents, not five, so the
  // fraction is padded to two places before it means anything.
  const cents = currency === "USD" && fraction !== ""
    ? Number(fraction.padEnd(2, "0").slice(0, 2))
    : 0;

  const display = `${CURRENCY_PREFIX[currency]} ${groupThousands(whole)}${
    cents > 0 ? `,${String(cents).padStart(2, "0")}` : ""
  }`;

  const spelled = spellSpanishInteger(Number(whole), { apocopate: true });
  const noun = whole === "1" ? CURRENCY_WORDS[currency].one : CURRENCY_WORDS[currency].many;

  // "millones DE guaraníes", but "quinientos mil guaraníes" — the "de" appears
  // only after a millón/billón scale word.
  const joiner = needsDeBeforeNoun(spelled) ? " de " : " ";

  // Money is spoken as "con cincuenta centavos", never as a decimal — "coma
  // cinco dólares" is not how a price is said out loud in Spanish.
  const centavos = cents > 0
    ? ` con ${spellSpanishInteger(cents, { apocopate: true })} ${cents === 1 ? "centavo" : "centavos"}`
    : "";

  return { display, speech: `${spelled}${joiner}${noun}${centavos}` };
}

/** Floor area. Display uses the m² symbol; speech spells the unit out. */
export function verbalizeArea(areaM2: string | number): Verbalized {
  const { whole, fraction } = splitDecimalString(areaM2);
  const display = `${groupThousands(whole)}${fraction ? `,${fraction}` : ""} m²`;
  const spelled = fraction
    ? spellSpanishDecimal(`${whole}.${fraction}`, { apocopate: true })
    : spellSpanishInteger(Number(whole), { apocopate: true });
  const unit = whole === "1" && !fraction ? "metro cuadrado" : "metros cuadrados";
  return { display, speech: `${spelled} ${unit}` };
}

/**
 * Spells out numbers embedded in free text, leaving everything else untouched.
 *
 * This exists for street numbers: "Avenida Mariscal López 1234" is a listing
 * field, not a typed quantity, so the number inside it never passes through
 * `verbalizePrice` or `verbalizeArea` — and an engine handed a bare "1234"
 * reads it however it likes, usually digit by digit.
 *
 * The hard part is knowing what NOT to touch, because Paraguayan address fields
 * are full of digits that are not quantities:
 *
 *   "Avda. España 1.234"              dot-grouped thousands, the local norm —
 *                                     the same grouping `groupThousands` emits
 *   "esq. 5ta" / "e/ 1ra y 2da"       ordinal suffixes, ubiquitous in Asunción
 *   "Ruta PY02 Km 12"                 a route code, not a number
 *   "depto 007"                       an identifier; leading zeros are part of it
 *
 * So a digit run is spelled only when it stands alone as a number: not glued to
 * letters on either side, no leading zeros, and short enough to be an address
 * rather than a phone number. Dot-grouped thousands are recognised and read as
 * the single number they are. Everything else is left exactly as written, which
 * is at worst what the engine would have done anyway — and never turns "1.234"
 * into "un punto doscientos treinta y cuatro".
 */
const MAX_SPELLED_DIGITS = 6;

/**
 * A number token: optional dot-grouped thousands, not adjacent to a letter or
 * digit on either side. The lookarounds are what keep "5ta", "PY02" and the
 * "02" in "12,5" out of it.
 */
const EMBEDDED_NUMBER = /(?<![\p{L}\p{N}])\d{1,3}(?:\.\d{3})+(?![\p{L}\p{N}])|(?<![\p{L}\p{N}.,])\d+(?![\p{L}\p{N}.,])/gu;

export function verbalizeEmbeddedNumbers(text: string): Verbalized {
  const speech = text.replace(EMBEDDED_NUMBER, (token) => {
    const digits = token.replace(/\./g, "");
    // Leading zeros mean it is an identifier — a flat number, a route code —
    // not a quantity, and reading it as one drops the zeros silently.
    if (digits.length > 1 && digits.startsWith("0")) return token;
    if (digits.length > MAX_SPELLED_DIGITS) return token;
    return spellSpanishInteger(Number(digits), { apocopate: true });
  });
  return { display: text, speech };
}

/**
 * A plain count — rooms, bathrooms. This is the one place the two languages
 * diverge: Spanish always spells in Spanish, Guaraní uses a native numeral for
 * the low counts and falls back to Spanish above them (conventions 2 and 3).
 */
export function verbalizeCount(count: number, language: ScriptLanguage): Verbalized {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`verbalizeCount expects a non-negative integer, got ${count}`);
  }
  const display = String(count);

  if (language === "gn" && count >= 1 && count < GUARANI_NUMERALS.length) {
    return { display, speech: GUARANI_NUMERALS[count] };
  }

  return { display, speech: spellSpanishInteger(count, { apocopate: true }) };
}
