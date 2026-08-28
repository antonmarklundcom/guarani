/**
 * Verbalization — plan §3.1.
 *
 * Number reading is the most common TTS failure in real-estate scripts, and the
 * failures are silent: the engine says something, it just says the wrong thing.
 * These cases are the ones that actually occur in Paraguayan listings, plus the
 * Spanish irregularities that are easy to get subtly wrong (cien vs ciento, the
 * missing "un" before mil, "de" before a millón noun, 10^9 not being a billón).
 */

import { describe, expect, it } from "vitest";
import {
  needsDeBeforeNoun,
  spellSpanishDecimal,
  spellSpanishInteger,
} from "@/script/numbers";
import {
  verbalizeArea,
  verbalizeCount,
  verbalizeEmbeddedNumbers,
  verbalizePrice,
} from "@/script/verbalize";
import { buildDraftLines } from "@/script/templates";

describe("Spanish integers", () => {
  it.each([
    [0, "cero"],
    [1, "uno"],
    [15, "quince"],
    [21, "veintiuno"],
    [31, "treinta y uno"],
    [100, "cien"],
    [101, "ciento uno"],
    [120, "ciento veinte"],
    [500, "quinientos"],
    [700, "setecientos"],
    [900, "novecientos"],
    [1000, "mil"],
    [1234, "mil doscientos treinta y cuatro"],
    [21000, "veintiún mil"],
    [100000, "cien mil"],
    [120000, "ciento veinte mil"],
    [1000000, "un millón"],
    [2000000, "dos millones"],
    [850000000, "ochocientos cincuenta millones"],
  ])("spells %i", (value, expected) => {
    expect(spellSpanishInteger(value)).toBe(expected);
  });

  it("says mil millones for 10^9 — Spanish has no word for it", () => {
    // The classic mistranslation: "billion" is 10^9 in English and 10^12 in
    // Spanish. An engine reading "un billón" for a price would be off by 1000x.
    expect(spellSpanishInteger(1_000_000_000)).toBe("mil millones");
    expect(spellSpanishInteger(1_000_000_000_000)).toBe("un billón");
  });

  it("never says 'un mil'", () => {
    expect(spellSpanishInteger(1000)).toBe("mil");
    expect(spellSpanishInteger(1500)).toBe("mil quinientos");
  });

  it("apocopates before a noun", () => {
    expect(spellSpanishInteger(1, { apocopate: true })).toBe("un");
    expect(spellSpanishInteger(21, { apocopate: true })).toBe("veintiún");
    expect(spellSpanishInteger(31, { apocopate: true })).toBe("treinta y un");
  });

  it("rejects values it cannot spell exactly", () => {
    expect(() => spellSpanishInteger(-1)).toThrow(RangeError);
    expect(() => spellSpanishInteger(1.5)).toThrow(RangeError);
  });
});

describe("Spanish decimals", () => {
  it("reads the fraction after 'coma'", () => {
    expect(spellSpanishDecimal("120.5")).toBe("ciento veinte coma cinco");
    expect(spellSpanishDecimal("120.25")).toBe("ciento veinte coma veinticinco");
  });

  it("treats trailing zeros as formatting, not precision", () => {
    expect(spellSpanishDecimal("120.00")).toBe("ciento veinte");
    expect(spellSpanishDecimal("120.50")).toBe("ciento veinte coma cinco");
  });

  it("speaks leading zeros in the fraction", () => {
    // 120.05 read as "coma cinco" would be ten times the real value.
    expect(spellSpanishDecimal("120.05")).toBe("ciento veinte coma cero cinco");
  });
});

describe("prices", () => {
  it("formats guaraníes the Paraguayan way and spells them out", () => {
    expect(verbalizePrice("850000000.00", "PYG")).toEqual({
      display: "Gs. 850.000.000",
      speech: "ochocientos cincuenta millones de guaraníes",
    });
  });

  it("inserts 'de' only after a millón scale word", () => {
    expect(needsDeBeforeNoun("ochocientos cincuenta millones")).toBe(true);
    expect(verbalizePrice("500000", "PYG").speech).toBe("quinientos mil guaraníes");
    expect(verbalizePrice("1000000", "PYG").speech).toBe("un millón de guaraníes");
  });

  it("drops guaraní decimals — the currency has no subunit in circulation", () => {
    expect(verbalizePrice("850000000.50", "PYG")).toEqual({
      display: "Gs. 850.000.000",
      speech: "ochocientos cincuenta millones de guaraníes",
    });
  });

  it("keeps USD cents when there are any", () => {
    expect(verbalizePrice("120000", "USD")).toEqual({
      display: "USD 120.000",
      speech: "ciento veinte mil dólares",
    });
    expect(verbalizePrice("1500.50", "USD")).toEqual({
      display: "USD 1.500,50",
      // "coma cinco dólares" is not how a price is said aloud.
      speech: "mil quinientos dólares con cincuenta centavos",
    });
    // "1500.5" means fifty cents, not five.
    expect(verbalizePrice("1500.5", "USD").display).toBe("USD 1.500,50");
  });

  it("uses the singular noun for exactly one unit", () => {
    expect(verbalizePrice("1", "PYG").speech).toBe("un guaraní");
    expect(verbalizePrice("1", "USD").speech).toBe("un dólar");
  });

  it("keeps exact precision on large values by never going through a float", () => {
    // 850000000.10 as a float and back is how a price loses a digit.
    expect(verbalizePrice("999999999999", "PYG").display).toBe("Gs. 999.999.999.999");
  });
});

describe("areas", () => {
  it("shows the symbol and speaks the unit", () => {
    expect(verbalizeArea("120.00")).toEqual({
      display: "120 m²",
      speech: "ciento veinte metros cuadrados",
    });
  });

  it("handles a fractional area", () => {
    expect(verbalizeArea("120.5")).toEqual({
      display: "120,5 m²",
      speech: "ciento veinte coma cinco metros cuadrados",
    });
  });

  it("uses the singular unit for one square metre", () => {
    expect(verbalizeArea("1").speech).toBe("un metro cuadrado");
  });
});

describe("counts", () => {
  it("uses native Guaraní numerals for low counts", () => {
    // Matches the plan's own gate sentence: "mbohapy koty ha mokõi baño".
    expect(verbalizeCount(1, "gn").speech).toBe("peteĩ");
    expect(verbalizeCount(3, "gn").speech).toBe("mbohapy");
    expect(verbalizeCount(5, "gn").speech).toBe("po");
  });

  it("falls back to Spanish above the native numerals", () => {
    // Guaraní speakers borrow Spanish numerals above the low counts; producing
    // a constructed pure-Guaraní numeral would sound wrong to the audience.
    expect(verbalizeCount(6, "gn").speech).toBe("seis");
    expect(verbalizeCount(12, "gn").speech).toBe("doce");
  });

  it("always spells Spanish counts in Spanish", () => {
    expect(verbalizeCount(3, "es").speech).toBe("tres");
  });

  it("keeps the digit in the caption regardless of language", () => {
    expect(verbalizeCount(3, "gn").display).toBe("3");
    expect(verbalizeCount(3, "es").display).toBe("3");
  });
});

describe("numbers embedded in free text", () => {
  it("spells a street number while the caption keeps the digits", () => {
    expect(verbalizeEmbeddedNumbers("Avenida Mariscal López 1234")).toEqual({
      display: "Avenida Mariscal López 1234",
      speech: "Avenida Mariscal López mil doscientos treinta y cuatro",
    });
  });

  it("leaves overlong digit runs alone", () => {
    // A phone number read as one cardinal is worse than one read as digits.
    expect(verbalizeEmbeddedNumbers("tel 0981123456").speech).toBe("tel 0981123456");
  });

  it("reads dot-grouped thousands as one number", () => {
    // Dot grouping is the local norm — this very file emits it — so "1.234" in
    // an address is expected input, and "un punto doscientos…" is not a reading.
    expect(verbalizeEmbeddedNumbers("Avda. España 1.234").speech).toBe(
      "Avda. España mil doscientos treinta y cuatro",
    );
    expect(verbalizeEmbeddedNumbers("Cnel. Bogado 1.503 c/ Dr. Insfrán").speech).toBe(
      "Cnel. Bogado mil quinientos tres c/ Dr. Insfrán",
    );
  });

  it("leaves ordinal suffixes and route codes alone", () => {
    // "5ta", "1ra", "2da" are ubiquitous in Asunción street names; blind digit
    // replacement turns them into "cincota", "unra", "dosda".
    expect(verbalizeEmbeddedNumbers("Calle 25 de Mayo esq. 5ta").speech).toBe(
      "Calle veinticinco de Mayo esq. 5ta",
    );
    expect(verbalizeEmbeddedNumbers("Estigarribia 890 e/ 1ra y 2da").speech).toBe(
      "Estigarribia ochocientos noventa e/ 1ra y 2da",
    );
    expect(verbalizeEmbeddedNumbers("Ruta PY02 Km 12").speech).toBe("Ruta PY02 Km doce");
  });

  it("leaves identifiers with leading zeros alone", () => {
    // "depto 007" is an identifier; reading it as "siete" drops the zeros and
    // silently disagrees with the caption.
    expect(verbalizeEmbeddedNumbers("depto 007").speech).toBe("depto 007");
  });
});

describe("Spanish conjunction before an i sound", () => {
  it("uses 'e' before i- and hi- words in a feature list", () => {
    // Feature lists are free text per listing, and "iluminación" / "internet"
    // are ordinary entries — so "garaje y iluminación" is a real output.
    const lines = buildDraftLines(
      {
        address: "Calle Palma 500",
        neighborhood: null,
        city: null,
        price: null,
        currency: "PYG",
        rooms: null,
        bathrooms: null,
        areaM2: null,
        features: ["garaje", "iluminación"],
      },
      "es",
      { callToAction: null },
    );

    expect(lines.some((l) => l.display.includes("garaje e iluminación"))).toBe(true);
  });
});
