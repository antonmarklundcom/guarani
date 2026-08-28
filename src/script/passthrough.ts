/**
 * The Spanish-passthrough allowlist — clause (b) of the plan §5.2
 * unresolved-terms rule.
 *
 * A token in a Guaraní/jopara script that fails to match the lexicon is flagged
 * for review UNLESS it is on this list. The list exists because jopara is a
 * mixed register: Spanish words appear inside Guaraní sentences constantly, and
 * a Spanish-tuned engine already pronounces them correctly. Flagging every one
 * would bury the terms that actually need a human.
 *
 * MEMBERSHIP RULE, so this list does not quietly become a dumping ground:
 * a word belongs here only if it is Spanish AND the correct pronunciation is
 * the ordinary Spanish one AND it carries no Guaraní phonology. Anything whose
 * pronunciation is a judgement call belongs in `jopara_lexicon` with a
 * per-engine speech form, not here. Proper nouns NEVER belong here — a
 * neighbourhood or street name is exactly what the review queue is for.
 *
 * Bulk of the list is Spanish number words, because the verbalization step
 * (plan §3.1) deliberately emits Spanish numerals into Guaraní speech: that is
 * how prices are actually spoken in Paraguay (see script/verbalize.ts).
 */

const NUMBER_WORDS = [
  "cero", "un", "uno", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete",
  "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince",
  "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiún",
  "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco",
  "veintiséis", "veintisiete", "veintiocho", "veintinueve", "treinta",
  "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa", "cien",
  "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos", "mil", "millón",
  "millones", "billón", "billones", "coma",
];

const UNITS_AND_CURRENCY = [
  "guaraní", "guaraníes", "dólar", "dólares", "metro", "metros", "cuadrado",
  "cuadrados",
];

/** Function words that glue Spanish fragments together inside jopara speech. */
const FUNCTION_WORDS = [
  "a", "al", "con", "de", "del", "el", "en", "la", "las", "lo", "los", "por",
  "y",
];

/**
 * Common Spanish real-estate nouns. Several of these are also seeded into
 * `jopara_lexicon` as `es` entries — deliberately, so the lexicon and this list
 * agree rather than contradicting each other. The lexicon is consulted first,
 * so a seeded entry always wins and this is only the floor.
 */
const REAL_ESTATE_WORDS = [
  "avenida", "baño", "baños", "barrio", "calle", "dormitorio", "dormitorios",
  "garaje", "jardín", "propiedad", "whatsapp",
];

export const SPANISH_PASSTHROUGH: readonly string[] = [
  ...NUMBER_WORDS,
  ...UNITS_AND_CURRENCY,
  ...FUNCTION_WORDS,
  ...REAL_ESTATE_WORDS,
];
