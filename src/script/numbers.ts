/**
 * Spanish cardinal numbers as words — the engine behind the plan §3.1
 * verbalization step.
 *
 * Why this exists at all: reading "Gs. 850.000.000" aloud is the single most
 * common TTS failure in real-estate scripts. Every engine we tested guesses,
 * and they guess differently — one says "ocho cinco cero...", another reads the
 * dots as decimal points. So numbers never reach the provider as digits: the
 * script's speech_text always carries words, and display_text keeps the
 * numerals for captions.
 *
 * Gender: every noun this module ever qualifies is masculine (guaraníes,
 * dólares, metros cuadrados, dormitorios, baños), so only the masculine forms
 * are implemented. A feminine caller would need "una"/"doscientas" — if that
 * day comes, add a gender option rather than special-casing at the call site.
 */

/** 0–29 are irregular enough to be worth a table rather than rules. */
const UNITS = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho",
  "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis",
  "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós",
  "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete",
  "veintiocho", "veintinueve",
];

const TENS = [
  "", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta",
  "ochenta", "noventa",
];

const HUNDREDS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

/**
 * `apocopate` renders 1 and 21 as "un"/"veintiún" — the form required directly
 * before a masculine noun ("un millón", "veintiún metros"). Standalone counts
 * ("uno") leave it off.
 */
export type SpellOptions = { apocopate?: boolean };

function spellUnder100(n: number, { apocopate }: SpellOptions): string {
  if (n < 30) {
    if (apocopate && n === 1) return "un";
    if (apocopate && n === 21) return "veintiún";
    return UNITS[n];
  }
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (unit === 0) return TENS[tens];
  const unitWord = apocopate && unit === 1 ? "un" : UNITS[unit];
  return `${TENS[tens]} y ${unitWord}`;
}

function spellUnder1000(n: number, options: SpellOptions): string {
  if (n === 0) return "";
  // "cien" only when it stands alone; 101 is "ciento uno", never "cien uno".
  if (n === 100) return "cien";
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]);
  if (rest > 0) parts.push(spellUnder100(rest, options));
  return parts.join(" ");
}

/**
 * Spells a non-negative integer. Spanish has no word for 10^9 — it is "mil
 * millones", not "un billón" (which is 10^12) — and this is a classic
 * mistranslation, so the scale table stops at millón and lets thousands stack
 * on top of it.
 */
export function spellSpanishInteger(value: number, options: SpellOptions = {}): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`spellSpanishInteger expects a non-negative integer, got ${value}`);
  }
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(
      `${value} exceeds the safe integer range; a price this large is almost ` +
        "certainly a data error rather than a listing.",
    );
  }
  if (value === 0) return "cero";

  const parts: string[] = [];
  let rest = value;

  const billones = Math.floor(rest / 1e12);
  rest %= 1e12;
  if (billones > 0) {
    parts.push(
      billones === 1 ? "un billón" : `${spellSpanishInteger(billones, { apocopate: true })} billones`,
    );
  }

  const millones = Math.floor(rest / 1e6);
  rest %= 1e6;
  if (millones > 0) {
    parts.push(
      millones === 1 ? "un millón" : `${spellSpanishInteger(millones, { apocopate: true })} millones`,
    );
  }

  const miles = Math.floor(rest / 1e3);
  rest %= 1e3;
  if (miles > 0) {
    // "mil", never "un mil".
    parts.push(miles === 1 ? "mil" : `${spellSpanishInteger(miles, { apocopate: true })} mil`);
  }

  if (rest > 0) parts.push(spellUnder1000(rest, options));

  return parts.join(" ");
}

/**
 * True when the spelled form ends in a millón/billón scale word, which is the
 * only case Spanish inserts "de" before the noun: "ochocientos cincuenta
 * millones DE guaraníes", but "quinientos mil guaraníes".
 */
export function needsDeBeforeNoun(spelled: string): boolean {
  return /\b(mill(ón|ones)|bill(ón|ones))$/.test(spelled);
}

/**
 * Spells a decimal value, reading the fractional part after "coma" as its own
 * number: 120.5 → "ciento veinte coma cinco".
 *
 * Takes the value as a string wherever possible — MySQL DECIMAL columns arrive
 * from the driver as strings, and routing them through a float first is how
 * "120.50" becomes "120.49999999".
 */
export function spellSpanishDecimal(
  value: string | number,
  options: SpellOptions = {},
): string {
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new RangeError(`spellSpanishDecimal cannot parse ${JSON.stringify(value)}`);
  }
  if (text.startsWith("-")) {
    throw new RangeError(`spellSpanishDecimal expects a non-negative value, got ${text}`);
  }

  const [whole, fractionRaw = ""] = text.split(".");
  // Trailing zeros are formatting, not precision: "120.50" reads as "ciento
  // veinte coma cinco", and "120.00" is just "ciento veinte".
  const fraction = fractionRaw.replace(/0+$/, "");

  const wholeWords = spellSpanishInteger(Number(whole), options);
  if (fraction === "") return wholeWords;

  // Leading zeros in the fraction are spoken: 120.05 is "coma cero cinco", not
  // "coma cinco". Dropping them silently changes the number by a factor of ten.
  const leadingZeros = fraction.length - fraction.replace(/^0+/, "").length;
  const significant = fraction.slice(leadingZeros);
  const fractionWords = [
    ...Array<string>(leadingZeros).fill("cero"),
    ...(significant === "" ? [] : [spellSpanishInteger(Number(significant))]),
  ].join(" ");

  return `${wholeWords} coma ${fractionWords}`;
}
