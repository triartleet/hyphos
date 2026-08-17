/**
 * Stage 0b — curate the raw corpus down to genuinely typed text.
 *
 * The rules are evidence-based (measured on a real corpus): messages that stay
 * long after machine text is stripped are almost always pasted, not typed, so
 * they are not the author's voice. The pipeline strips fenced code blocks,
 * log-like lines, and lines carrying very long tokens (paths, hashes, URLs),
 * recounts words, keeps messages of 1–400 words, and quarantines the rest for a
 * later salvage pass.
 *
 * Reads corpus/raw-sessions.jsonl. Writes corpus/curated.jsonl,
 * corpus/quarantine.jsonl and corpus/stats-curated.md. Stdout is aggregate-only
 * (counts and word totals, never message text) — a privacy contract.
 */
import fs from "node:fs";
import path from "node:path";
import { corpusDir } from "../lib/paths.js";
import { whitespaceSplit } from "../lib/text.js";

// Fenced code block, non-greedy, DOTALL — `[\s\S]` matches newlines like Python
// `re.S`. Global so every block is removed (Python `re.sub` replaces all).
const FENCE_RE = /```[\s\S]*?```/g;
const IMAGE_RE = /\[Image:[^\]]*\]/g;
// A run of 40+ non-whitespace characters (a path/hash/URL). The `u` flag makes
// the `{40,}` quantifier count code points, matching Python's `\S{40,}` on a
// `str` — without it an astral char (emoji) would count as two UTF-16 units.
const LONG_TOKEN_RE = /\S{40,}/u;
// A line that looks machine-emitted. Anchored at the start like Python's
// `re.match`. `\p{Nd}` stands in for Python's Unicode-aware `\d` (JS `\d` is
// ASCII-only); the `u` flag is required for the property escape.
const LOG_LINE_RE =
  /^\s*(at |Error|error:|Traceback|\$ |> |\| |#|\/\/|\p{Nd}+[:.]\p{Nd}|\p{Nd}{1,4}[/-]\p{Nd}{1,2}[/-]\p{Nd}{1,4})/u;
// Collapse runs of spaces/tabs to a single space (Python `re.sub(r"[ \t]+", " ")`).
const COLLAPSE_RE = /[ \t]+/g;
const MAX_TYPED_WORDS = 400;

// Line boundaries recognised by Python `str.splitlines()`: LF, CR, CRLF, VT, FF,
// FS, GS, RS, NEL, LS, PS. Broader than a plain `\n` split, so replicated exactly.
const LINE_BOUNDARY_RE = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/g;

// Characters Python's argument-less `str.strip()` removes (where `c.isspace()`).
// Differs from JS `String.prototype.trim()`: this set includes FS/GS/RS/US and
// NEL but NOT the BOM (U+FEFF), matching Python — so a leading BOM is preserved.
const PY_WS =
  "\\t\\n\\v\\f\\r\\x1c\\x1d\\x1e\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_STRIP_RE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "gu");

/** Python `str.strip()` semantics, no argument. */
function pyStrip(s: string): string {
  return s.replace(PY_STRIP_RE, "");
}

/** Python `str.splitlines()` semantics (no keepends). */
function pySplitlines(s: string): string[] {
  if (s.length === 0) return [];
  const parts: string[] = [];
  LINE_BOUNDARY_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = LINE_BOUNDARY_RE.exec(s)) !== null) {
    parts.push(s.slice(last, m.index));
    last = m.index + m[0].length;
  }
  // No trailing empty element when the text ends on a boundary (Python behaviour).
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}

/** Count non-overlapping occurrences of `needle` — Python `str.count`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/** Strip machine-emitted text, line by line. */
function stripMachineText(text: string): string {
  let t = text.replace(FENCE_RE, " ");
  t = t.replace(IMAGE_RE, " ");
  const kept: string[] = [];
  for (const line of pySplitlines(t)) {
    if (LOG_LINE_RE.test(line)) continue;
    if (LONG_TOKEN_RE.test(line)) continue;
    kept.push(line);
  }
  return pyStrip(kept.join("\n").replace(COLLAPSE_RE, " "));
}

/** Read a JSONL file into raw line strings, skipping blank lines. */
function readLines(file: string): string[] {
  const out: string[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.length === 0) continue;
    out.push(line);
  }
  return out;
}

export function runCurate(argv: string[]): number {
  void argv; // curate_corpus.py takes no CLI arguments.
  const corpus = corpusDir();
  const src = path.join(corpus, "raw-sessions.jsonl");
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
    process.stderr.write(`missing ${src} — run hyphos extract first\n`);
    return 1;
  }

  const curatedPath = path.join(corpus, "curated.jsonl");
  const quarantinePath = path.join(corpus, "quarantine.jsonl");
  const aiMarkedPath = path.join(corpus, "ai-marked.jsonl");
  const curatedLines: string[] = [];
  const quarantineLines: string[] = [];
  const aiMarkedLines: string[] = [];
  let kept = 0;
  let keptWords = 0;
  let quarantined = 0;
  let qWords = 0;
  let droppedEmpty = 0;
  let aiMarked = 0;

  for (const line of readLines(src)) {
    const o = JSON.parse(line) as Record<string, unknown>;
    const stripped = stripMachineText(o.text as string);
    const wordCount = whitespaceSplit(stripped).length;
    if (wordCount === 0) {
      droppedEmpty++;
      continue;
    }
    // `stripped` is already whitespace-stripped, so its first char equals the
    // reference's `stripped.lstrip()[:1]`. Drop unfenced JSON/config pastes.
    const first = stripped.slice(0, 1);
    if (
      (first === "{" || first === "[") &&
      countOccurrences(stripped, '":') >= 2
    ) {
      droppedEmpty++;
      continue;
    }
    // Reassigning `text`/`words` keeps their original position (both Python dict
    // and JS object semantics); `raw_words` is appended last.
    const rec = { ...o, text: stripped, words: wordCount, raw_words: o.words };
    // Deliberate: a message carrying an
    // em-dash is excluded from the voice corpus entirely. The owner's typed
    // baseline measures ~0 of them per 1k words (see profiles/model-isms.md),
    // so a message that contains one is pasted or AI-influenced text riding in
    // a user turn — under the length ceiling it would otherwise pass straight
    // into the fingerprints. Measured before this guard existed: 121 of 3065
    // curated messages carried them, concentrated in one register bucket at
    // 20% of its rows and ~44% of its words. These rows go to their own file,
    // never to quarantine, so the salvage pass cannot recycle them.
    if (stripped.includes("—")) {
      aiMarkedLines.push(
        JSON.stringify({ ...rec, excluded: "ai-marker-emdash" }) + "\n",
      );
      aiMarked++;
      continue;
    }
    const encoded = JSON.stringify(rec) + "\n";
    if (wordCount <= MAX_TYPED_WORDS) {
      curatedLines.push(encoded);
      kept++;
      keptWords += wordCount;
    } else {
      quarantineLines.push(encoded);
      quarantined++;
      qWords += wordCount;
    }
  }

  // All output files are (re)created even when empty (`open("w")` truncation
  // semantics).
  fs.writeFileSync(curatedPath, curatedLines.join(""));
  fs.writeFileSync(quarantinePath, quarantineLines.join(""));
  fs.writeFileSync(aiMarkedPath, aiMarkedLines.join(""));

  const statsPath = path.join(corpus, "stats-curated.md");
  const stats =
    "# Curated corpus stats (local-only)\n\n" +
    `Kept: ${kept} messages, ${keptWords} words (typed voice)\n` +
    `Quarantined (>${MAX_TYPED_WORDS}w post-strip): ${quarantined} messages, ${qWords} words\n` +
    `AI-marked (em-dash carrier, excluded from voice): ${aiMarked} messages\n` +
    `Dropped (empty after stripping): ${droppedEmpty}\n`;
  fs.writeFileSync(statsPath, stats);

  process.stdout.write(`kept: ${kept} messages, ${keptWords} words\n`);
  process.stdout.write(
    `quarantined: ${quarantined} messages (${qWords} words)\n`,
  );
  process.stdout.write(`ai-marked (excluded from voice): ${aiMarked}\n`);
  process.stdout.write(`dropped empty after strip: ${droppedEmpty}\n`);
  return 0;
}
