/**
 * Stage 0c — salvage typed fragments from quarantined messages.
 *
 * Quarantined messages (very long, mostly pasted material) usually still carry a
 * small amount of *typed* wrapper: an instruction at the top, sometimes a short
 * typed close. This pass recovers ONLY high-confidence typed fragments —
 * precision over recall, since one pasted paragraph pollutes a voice profile more
 * than fifty missed typed ones improve it.
 *
 * Rules: take the leading 1–2 paragraphs when each is <=120 words and
 * instruction-flavored; take the final paragraph when <=60 words and
 * instruction-flavored; drop anything that looks like correspondence or document
 * structure; dedupe against the curated corpus. Writes corpus/salvaged.jsonl with
 * a register tag. Stdout is aggregate-only (counts and word totals — never any
 * corpus text), preserving the privacy invariant.
 *
 * Faithful port of the reference `salvage_quarantine.py`. The register scorer
 * (`scores`) is imported from the register-tagging stage in Python; that stage is
 * not yet ported here, so its logic is inlined below verbatim. When it is ported,
 * this copy should be replaced by an import to keep a single source of truth.
 */
import fs from "node:fs";
import path from "node:path";
import { pyRound } from "../lib/num.js";
import { whitespaceSplit } from "../lib/text.js";
import { corpusDir } from "../lib/paths.js";

// --- salvage-side heuristics -------------------------------------------------

// Word character for boundary tests. Python's `\b` (and `\w`) on a `str` are
// Unicode-aware — letters, numbers, underscore — while JS `\b`/`\w` are ASCII
// only. We reconstruct Python's boundary with Unicode-property lookarounds so a
// keyword butting directly against a non-Latin letter behaves the same as in the
// reference. `\p{L}\p{N}_` is exactly Python's `\w` (str.isalnum() + underscore).
const WORD_CHAR = "[\\p{L}\\p{N}_]";

// Instruction-flavored phrasing (the salvage set — broader than the scorer's).
// Non-global so `.test()` stays stateless; `iu` = case-insensitive + Unicode.
const SALVAGE_INSTRUCTION_RE = new RegExp(
  `(?<!${WORD_CHAR})(?:i want|i need|i would like|can you|could you|let'?s|` +
    `we (?:should|want|need)|please|make sure|instead of|proceed|continue|` +
    `check|fix|add|create|update|run|investigate|consider|before you|now that)` +
    `(?!${WORD_CHAR})`,
  "iu",
);

// Openings that read as correspondence, not a typed instruction. Anchored at the
// start (Python `re.match`), case-insensitive.
const CORRESPONDENCE_RE =
  /^(?:dear |hi |hello |greetings|kind regards|best regards|thanks,|regards,)/i;

// Openings that read as document structure (markdown heading, list item, table
// row, quote). `\p{Nd}` matches Python `\d` (Unicode decimal digits); no `i`
// flag, matching the reference. Anchored at the start.
const DOCLIKE_RE = /^(?:#{1,6} |\p{Nd}+\.\s|\* |- |\||>)/u;

/**
 * A paragraph counts as typed-flavored when it is 4..max_words words long, does
 * not open like correspondence or document structure, and contains at least one
 * instruction phrase. Mirrors `typed_flavored` in the reference exactly:
 * the word-count and open-shape checks use the stripped paragraph, but the
 * instruction search runs over the paragraph as given.
 */
function typedFlavored(par: string, maxWords: number): boolean {
  const w = whitespaceSplit(par); // Python str.split() (no arg)
  if (!(w.length >= 4 && w.length <= maxWords)) return false;
  const stripped = par.trim();
  if (CORRESPONDENCE_RE.test(stripped) || DOCLIKE_RE.test(stripped)) return false;
  return SALVAGE_INSTRUCTION_RE.test(par);
}

/**
 * Recover the high-confidence typed fragment from one quarantined message, or
 * null if nothing qualifies. Take leading paragraphs (up to two) while each is
 * typed-flavored under a 120-word cap; then, if not everything was taken, take
 * the final paragraph under a 60-word cap. Require >=8 words in the result.
 */
function salvage(text: string): string | null {
  const paras = text
    .split(/\n\s*\n/) // blank-line paragraph split (matches the reference)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paras.length < 2) return null;

  const kept: string[] = [];
  for (const p of paras.slice(0, 2)) {
    if (typedFlavored(p, 120)) kept.push(p);
    else break;
  }
  // If we did not already keep every paragraph, consider the closing one.
  if (paras.length > kept.length && typedFlavored(paras[paras.length - 1]!, 60)) {
    kept.push(paras[paras.length - 1]!);
  }
  const out = kept.join("\n\n");
  return whitespaceSplit(out).length >= 8 ? out : null;
}

// --- register scorer (inlined from the register-tagging stage) ---------------
//
// Rule-based register scoring: buckets a fragment into technical-instruction,
// informal, or editorial. Casing and terminal punctuation are ignored on purpose
// (they are the author's universal habits, not register signal).

const IMPERATIVES = new Set([
  "add", "build", "change", "check", "clean", "close", "commit", "compare",
  "continue", "create", "delete", "deploy", "do", "ensure", "explain", "find",
  "fix", "generate", "give", "go", "implement", "install", "investigate",
  "keep", "list", "load", "make", "move", "open", "please", "proceed", "push",
  "read", "record", "refactor", "remove", "rename", "rerun", "resume", "run",
  "search", "show", "start", "stop", "test", "try", "update", "use", "verify",
  "write",
]);
const TECH_NOUNS = new Set([
  "agent", "api", "branch", "bug", "build", "cli", "code", "commit", "config",
  "deploy", "endpoint", "error", "file", "flag", "function", "hook", "log",
  "merge", "pipeline", "pr", "repo", "script", "session", "test", "token",
  "typescript", "ui", "workflow",
]);
const CASUAL_TOKENS = new Set([
  "ah", "btw", "cool", "haha", "hey", "hm", "hmm", "lol", "nah", "nope",
  "ok", "okay", "oops", "pls", "r", "thanks", "thx", "u", "wanna", "wtf",
  "yeah", "yep",
]);
const DISCOURSE = new Set([
  "actually", "although", "besides", "however", "indeed", "instead",
  "moreover", "nevertheless", "overall", "rather", "therefore", "though",
  "ultimately", "whereas", "while",
]);

// The scorer's own (narrower) instruction pattern. Global for match-counting.
const SCORES_INSTRUCTION_RE = new RegExp(
  `(?<!${WORD_CHAR})(?:i want|i need|i would like|can you|could you|let'?s|` +
    `we (?:should|want|need)|please|make sure|instead of|proceed|continue)` +
    `(?!${WORD_CHAR})`,
  "giu",
);

// ASCII letters plus apostrophe, on lowercased text — the scorer's tokenizer.
// (Distinct from the lib's `latinLowerWords`, which excludes the apostrophe, so
// it cannot be reused here without changing the token boundaries.)
const SCORE_TOKEN_RE = /[a-zA-Z']+/g;

interface Scores {
  technical: number;
  informal: number;
  editorial: number;
}

function scores(text: string): Scores {
  const wordToks = text.toLowerCase().match(SCORE_TOKEN_RE) ?? [];
  if (wordToks.length === 0) {
    return { technical: 0.0, informal: 0.0, editorial: 0.0 };
  }
  const n = wordToks.length;

  const sentences = text.split(/[.!?\n]+/).filter((s) => s.trim().length > 0);
  const nSent = Math.max(sentences.length, 1);

  // Distinct first-words across sentences (a set, as in the reference).
  const firstWords = new Set<string>();
  for (const s of sentences) {
    const toks = s.toLowerCase().match(SCORE_TOKEN_RE);
    if (toks && toks.length > 0) firstWords.add(toks[0]!);
  }

  let techCount = 0;
  let casualCount = 0;
  let discourseCount = 0;
  for (const w of wordToks) {
    if (TECH_NOUNS.has(w)) techCount++;
    if (CASUAL_TOKENS.has(w)) casualCount++;
    if (DISCOURSE.has(w)) discourseCount++;
  }

  const techDensity = techCount / n;
  const instr = (text.match(SCORES_INSTRUCTION_RE) ?? []).length / nSent;
  let imperCount = 0;
  for (const fw of firstWords) if (IMPERATIVES.has(fw)) imperCount++;
  const imper = imperCount / nSent;

  const tech = techDensity * 6 + instr * 1.5 + imper * 2;
  const informal = (casualCount / n) * 8 + (n < 8 ? 0.3 : 0);
  const editorial =
    (discourseCount / n) * 5 +
    (sentences.length >= 4 ? 0.4 : 0) +
    (n > 80 ? 0.3 : 0) -
    techDensity * 4 -
    instr * 1.0 -
    imper * 1.5;

  return {
    technical: pyRound(tech, 3),
    informal: pyRound(informal, 3),
    editorial: pyRound(Math.max(editorial, 0.0), 3),
  };
}

/**
 * Reduce a score set to the output register string. Argmax over the rounded
 * scores in insertion order (technical, informal, editorial) so ties resolve to
 * the earlier key — matching Python `max(dict, key=dict.get)`. If the top score
 * is not positive, default to technical (the corpus's nature). "technical" is
 * then emitted as "technical-instruction".
 */
function registerFor(s: Scores): string {
  let bestKey = "technical";
  let bestVal = s.technical;
  if (s.informal > bestVal) {
    bestVal = s.informal;
    bestKey = "informal";
  }
  if (s.editorial > bestVal) {
    bestVal = s.editorial;
    bestKey = "editorial";
  }
  const reg = bestVal > 0 ? bestKey : "technical";
  return reg === "technical" ? "technical-instruction" : reg;
}

// --- IO ----------------------------------------------------------------------

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Read a JSONL file into records, skipping blank lines (e.g. a trailing "\n"). */
function readJsonl(file: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.length === 0) continue;
    out.push(JSON.parse(line) as Record<string, unknown>);
  }
  return out;
}

/**
 * Stage entry point. `argv` is accepted for a uniform CLI signature but unused:
 * the reference takes no arguments and reads corpus paths from the environment.
 */
export function runSalvage(argv: string[]): number {
  void argv;
  const corpus = corpusDir();

  const qPath = path.join(corpus, "quarantine.jsonl");
  if (!isFile(qPath)) {
    process.stderr.write("no quarantine.jsonl — nothing to salvage\n");
    return 1;
  }

  // Seed the dedupe set from the curated corpus (if present), then from every
  // fragment we emit, so we never re-add text already in the profile source.
  const seen = new Set<string>();
  const curPath = path.join(corpus, "curated.jsonl");
  if (isFile(curPath)) {
    for (const o of readJsonl(curPath)) seen.add(o["text"] as string);
  }

  const outPath = path.join(corpus, "salvaged.jsonl");
  let kept = 0;
  let keptWords = 0;
  const lines: string[] = [];

  for (const o of readJsonl(qPath)) {
    const frag = salvage(o["text"] as string);
    if (!frag || seen.has(frag)) continue;
    seen.add(frag);

    const register = registerFor(scores(frag));
    const nWords = whitespaceSplit(frag).length;
    const record = {
      ts: o["ts"] ?? null,
      project: o["project"] ?? null,
      source: "salvage",
      words: nWords,
      register,
      text: frag,
    };
    lines.push(JSON.stringify(record));
    kept += 1;
    keptWords += nWords;
  }

  fs.writeFileSync(outPath, lines.map((l) => l + "\n").join(""));

  // Aggregate-only stdout. The "268-message" figure is a hardcoded literal in the
  // reference (not the live quarantine count); it is reproduced verbatim for
  // output parity.
  process.stdout.write(
    `salvaged: ${kept} fragments, ${keptWords} words (from 268-message quarantine)\n`,
  );
  return 0;
}
