/**
 * Language tagging for corpus ingest — including greeklish (Greek written in
 * Latin characters).
 *
 * Greeklish defeats script-based detection (all-Latin) and would poison English
 * vocabulary profiles if let through, so it gets its own tag via a function-word
 * density heuristic. Per the project's non-English rule, "el" and "gr-latn"
 * contribute rhythm/register signal only — never wording — and are never
 * transliterated.
 *
 * Tags: "en", "el" (Greek script), "gr-latn" (greeklish), "other".
 */
import { whitespaceSplit } from "./text.js";

export type Lang = "en" | "el" | "gr-latn" | "other";

// Greek and Coptic (U+0370–U+03FF) plus Greek Extended (U+1F00–U+1FFF).
const GREEK_SCRIPT_RE = /[Ͱ-Ͽἀ-῿]/g;
const LATIN_RE = /[a-zA-Z]/g;
const LATIN_LOWER_WORD_RE = /[a-z]+/g;

// Short, high-frequency Greek function words as typically romanized. STRONG
// markers are essentially never English tokens; WEAK ones collide with English
// ("re", "na", "file") and only count alongside a strong hit.
const STRONG_MARKERS = new Set([
  "kai",
  "einai",
  "eimai",
  "gia",
  "den",
  "tha",
  "apo",
  "oti",
  "alla",
  "edo",
  "ekei",
  "kala",
  "sou",
  "mou",
  "tou",
  "tis",
  "tora",
  "prin",
  "exo",
  "exei",
  "thelo",
  "thelei",
  "ksero",
  "xero",
  "pame",
  "ela",
  "oxi",
  "nai",
  "etsi",
  "opos",
  "vre",
  "loipon",
  "omos",
  "poly",
  "ligo",
  "kalimera",
  "kalispera",
  "efharisto",
  "eyxaristo",
]);
const WEAK_MARKERS = new Set([
  "re",
  "na",
  "file",
  "logo",
  "mia",
  "ena",
  "meta",
  "pio",
]);

export function detectLang(text: string): Lang {
  const greek = (text.match(GREEK_SCRIPT_RE) ?? []).length;
  const latin = (text.match(LATIN_RE) ?? []).length;
  if (greek > latin) return "el";
  if (latin === 0) return "other";
  const words = text.toLowerCase().match(LATIN_LOWER_WORD_RE) ?? [];
  if (words.length === 0) return "other";
  let strong = 0;
  let weak = 0;
  for (const w of words) {
    if (STRONG_MARKERS.has(w)) strong++;
    else if (WEAK_MARKERS.has(w)) weak++;
  }
  if (
    words.length >= 4 &&
    strong >= 1 &&
    (strong + weak) / words.length >= 0.12
  ) {
    return "gr-latn";
  }
  return "en";
}

/**
 * Split a message into per-language chunks. Classification is per paragraph;
 * adjacent same-language paragraphs merge; a minority side under 15 words does
 * NOT split the message. Returns [lang, chunkText] pairs.
 */
export function splitByLang(text: string): [Lang, string][] {
  const paras = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  if (paras.length === 0) return [[detectLang(text), text]];

  const tagged: [Lang, string][] = paras.map((p) => [detectLang(p), p]);

  // Insertion-ordered word totals per language (insertion order decides
  // the max-key tie-break below).
  const wordsByLang = new Map<Lang, number>();
  for (const [lang, p] of tagged) {
    wordsByLang.set(
      lang,
      (wordsByLang.get(lang) ?? 0) + whitespaceSplit(p).length,
    );
  }

  // max(dict, key=dict.get): first-inserted key wins a tie.
  let majority: Lang = tagged[0]![0];
  let best = -1;
  for (const [lang, n] of wordsByLang) {
    if (n > best) {
      best = n;
      majority = lang;
    }
  }

  const values = [...wordsByLang.values()].sort((a, b) => a - b);
  if (wordsByLang.size === 1 || values[values.length - 2]! < 15) {
    return [[majority, text]];
  }

  const chunks: [Lang, string][] = [];
  for (const [lang, p] of tagged) {
    const last = chunks[chunks.length - 1];
    if (last && last[0] === lang) last[1] = last[1] + "\n\n" + p;
    else chunks.push([lang, p]);
  }
  return chunks;
}
