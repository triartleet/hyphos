/**
 * Text primitives shared across stages. Regexes are chosen to match Python's
 * `str`-mode `re` semantics, not JS defaults:
 *
 * - Word tokenization uses `\p{L}\p{N}_` under the `u` flag, because Python's
 *   `\w` on a `str` is Unicode-aware (letters, numbers, underscore) while JS
 *   `\w` is ASCII-only. This matters for Greek/greeklish rhythm counting.
 * - `demojibake` reproduces `s.encode("latin-1").decode("utf-8")` including its
 *   failure modes: Python raises (and the caller falls back to the original) when
 *   a character is outside latin-1 or the bytes are not valid UTF-8.
 */

const WORD_RE = /[\p{L}\p{N}_']+/gu;
const TYPO_RE = /[a-z']{4,14}/g;
const LATIN_LOWER_RE = /[a-z]+/g;

/** `re.findall(r"[\w']+", t)` — Unicode-aware word tokens. */
export function words(t: string): string[] {
  return t.match(WORD_RE) ?? [];
}

/** `re.findall(r"[a-z']{4,14}", t)` — ASCII typo-candidate tokens. */
export function typoTokens(t: string): string[] {
  return t.match(TYPO_RE) ?? [];
}

/** `re.findall(r"[a-z]+", s.lower())` — ASCII lowercase runs. */
export function latinLowerWords(s: string): string[] {
  return s.toLowerCase().match(LATIN_LOWER_RE) ?? [];
}

/**
 * `sentences_of`: newlines are layout, not punctuation. A blank line is a
 * boundary; a single newline reads as a space. Split on `.!?` and the blank-line
 * marker, trimming and dropping empties.
 */
export function sentencesOf(text: string): string[] {
  let t = text.replace(/\n\s*\n/g, "¶"); // blank line → ¶
  t = t.replace(/\n/g, " ");
  return t
    .split(/[.!?¶]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Python `str.split()` whitespace set (Py_UNICODE_ISSPACE): ASCII 0x09–0x0d,
// 0x1c–0x1f and 0x20, NEL 0x85, plus the Unicode White_Space characters — but
// NOT the BOM (0xFEFF), which JS `\s` wrongly includes. Matching this exactly
// keeps word counts identical to the reference.
const PY_WS = "\\t\\n\\x0b\\f\\r\\x1c\\x1d\\x1e\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_WS_SPLIT = new RegExp(`[${PY_WS}]+`);
const PY_WS_TRIM = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "g");

/** Python `str.split()` with no args: split on Python whitespace, drop empties. */
export function whitespaceSplit(s: string): string[] {
  const t = s.replace(PY_WS_TRIM, "");
  return t.length === 0 ? [] : t.split(PY_WS_SPLIT);
}

/**
 * Undo Meta's mojibake: it writes UTF-8 bytes escaped as latin-1, so text
 * arrives double-encoded. Faithful port of `s.encode("latin-1").decode("utf-8")`
 * with the Python fallback-on-error behavior.
 */
export function demojibake(s: string): string {
  // encode("latin-1") raises if any code point exceeds 0xFF — properly-encoded
  // Greek and emoji land here and are returned unchanged (as in Python).
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) return s;
    bytes[i] = c;
  }
  // decode("utf-8") is strict in Python (raises on invalid); Node inserts U+FFFD
  // and never throws, so treat a replacement char as the decode having failed.
  const decoded = Buffer.from(bytes).toString("utf8");
  if (decoded.includes("�")) return s;
  return decoded;
}
