/**
 * Stage 1a — tag each curated message with a register (the mode the person is
 * writing in). Faithful port of the reference `tag_registers.py`.
 *
 * v1 buckets:
 * - technical-instruction — telling an agent/tool what to do: imperatives, task
 *   vocabulary, repo/tool nouns. The bulk of a chat corpus.
 * - informal — casual voice: casual tokens, short bursts.
 * - editorial — connected long-form prose: discourse markers, multi-sentence
 *   paragraphs, low imperative density.
 *
 * The scoring is rule-based on purpose: transparent, auditable and cheap to
 * re-run. Reads corpus/curated.jsonl, writes corpus/tagged.jsonl (adding
 * `register` and `register_scores`). Stdout is aggregate-only.
 *
 * `scores()` is exported because the salvage stage re-scores text fragments with
 * it; keep its signature and semantics stable.
 */
import fs from "node:fs";
import path from "node:path";
import { Counter } from "../lib/counter.js";
import { pyRound } from "../lib/num.js";
import { corpusDir } from "../lib/paths.js";

const IMPERATIVES = new Set([
  "add",
  "build",
  "change",
  "check",
  "clean",
  "close",
  "commit",
  "compare",
  "continue",
  "create",
  "delete",
  "deploy",
  "do",
  "ensure",
  "explain",
  "find",
  "fix",
  "generate",
  "give",
  "go",
  "implement",
  "install",
  "investigate",
  "keep",
  "list",
  "load",
  "make",
  "move",
  "open",
  "please",
  "proceed",
  "push",
  "read",
  "record",
  "refactor",
  "remove",
  "rename",
  "rerun",
  "resume",
  "run",
  "search",
  "show",
  "start",
  "stop",
  "test",
  "try",
  "update",
  "use",
  "verify",
  "write",
]);
const TECH_NOUNS = new Set([
  "agent",
  "api",
  "branch",
  "bug",
  "build",
  "cli",
  "code",
  "commit",
  "config",
  "deploy",
  "endpoint",
  "error",
  "file",
  "flag",
  "function",
  "hook",
  "log",
  "merge",
  "pipeline",
  "pr",
  "repo",
  "script",
  "session",
  "test",
  "token",
  "typescript",
  "ui",
  "workflow",
]);
const CASUAL_TOKENS = new Set([
  "ah",
  "btw",
  "cool",
  "haha",
  "hey",
  "hm",
  "hmm",
  "lol",
  "nah",
  "nope",
  "ok",
  "okay",
  "oops",
  "pls",
  "r",
  "thanks",
  "thx",
  "u",
  "wanna",
  "wtf",
  "yeah",
  "yep",
]);
const DISCOURSE = new Set([
  "actually",
  "although",
  "besides",
  "however",
  "indeed",
  "instead",
  "moreover",
  "nevertheless",
  "overall",
  "rather",
  "therefore",
  "though",
  "ultimately",
  "whereas",
  "while",
]);

// `\b(...)\b` from the reference. JS `\b` is ASCII-only, so the word boundaries
// are expressed as look-arounds over Python's `\w` class (`[\p{L}\p{N}_]`) to
// stay Unicode-aware; `i` = case-insensitive, `g` = count every match.
const INSTRUCTION_RE =
  /(?<![\p{L}\p{N}_])(i want|i need|i would like|can you|could you|let'?s|we (should|want|need)|please|make sure|instead of|proceed|continue)(?![\p{L}\p{N}_])/giu;
// `re.findall(r"[a-zA-Z']+", text.lower())` — ASCII letter/apostrophe runs. Kept
// distinct from the shared `words`/`latinLowerWords` helpers: the reference uses
// this exact class (it includes the apostrophe, which `latinLowerWords` omits).
const WORD_TOKEN_RE = /[a-zA-Z']+/g;
// `re.split(r"[.!?\n]+", text)` — sentence-ish fragments (not the shared
// `sentencesOf`, which splits differently).
const SENTENCE_SPLIT_RE = /[.!?\n]+/;

export interface RegisterScores {
  technical: number;
  informal: number;
  editorial: number;
}

/**
 * Score a text against the three registers. Deliberately ignores casing and
 * terminal punctuation (universal author habits, not register signal). Returns
 * three rounded scores; higher means a stronger fit.
 */
export function scores(text: string): RegisterScores {
  const wordsList = text.toLowerCase().match(WORD_TOKEN_RE) ?? [];
  if (wordsList.length === 0) {
    return { technical: 0.0, informal: 0.0, editorial: 0.0 };
  }
  const n = wordsList.length;
  const sentences = text
    .split(SENTENCE_SPLIT_RE)
    .filter((s) => s.trim().length > 0);
  const nSent = Math.max(sentences.length, 1);

  // Unique first word of each sentence (a `set` in the reference).
  const firstWords = new Set<string>();
  for (const s of sentences) {
    const toks = s.toLowerCase().match(WORD_TOKEN_RE);
    if (toks && toks.length > 0) firstWords.add(toks[0]!);
  }

  let techCount = 0;
  for (const w of wordsList) if (TECH_NOUNS.has(w)) techCount++;
  const techDensity = techCount / n;
  const instr = (text.match(INSTRUCTION_RE) ?? []).length / nSent;
  let imperCount = 0;
  for (const fw of firstWords) if (IMPERATIVES.has(fw)) imperCount++;
  const imper = imperCount / nSent;

  const tech = techDensity * 6 + instr * 1.5 + imper * 2;

  let casualCount = 0;
  for (const w of wordsList) if (CASUAL_TOKENS.has(w)) casualCount++;
  const informal = (casualCount / n) * 8 + (n < 8 ? 0.3 : 0);

  let discourseCount = 0;
  for (const w of wordsList) if (DISCOURSE.has(w)) discourseCount++;
  // Operation order matches the reference exactly for bit-identical float parity.
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

/** Read a JSONL file into raw line strings, skipping blank lines. */
function readLines(file: string): string[] {
  const out: string[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.length === 0) continue;
    out.push(line);
  }
  return out;
}

export function runTag(argv: string[]): number {
  void argv; // tag_registers.py takes no CLI arguments.
  const corpus = corpusDir();
  const src = path.join(corpus, "curated.jsonl");
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
    process.stderr.write(
      "missing curated.jsonl — run curate_corpus.py first\n",
    );
    return 1;
  }

  const outPath = path.join(corpus, "tagged.jsonl");
  const dist = new Counter<string>();
  const wordDist = new Counter<string>();
  const outLines: string[] = [];

  for (const line of readLines(src)) {
    const o = JSON.parse(line) as Record<string, unknown>;
    const s = scores(o.text as string);
    // `max(s, key=s.get)` — first key (technical, informal, editorial) with the
    // highest value wins ties; only switch on a strictly greater value.
    let argmaxKey = "technical";
    let argmaxVal = s.technical;
    if (s.informal > argmaxVal) {
      argmaxKey = "informal";
      argmaxVal = s.informal;
    }
    if (s.editorial > argmaxVal) {
      argmaxKey = "editorial";
      argmaxVal = s.editorial;
    }
    // Ties and dead heats (max <= 0) default toward technical (the corpus's nature).
    const register = argmaxVal > 0 ? argmaxKey : "technical";
    const label = register === "technical" ? "technical-instruction" : register;
    o.register = label;
    o.register_scores = s;
    dist.add(label, 1);
    wordDist.add(label, o.words as number);
    outLines.push(JSON.stringify(o) + "\n");
  }

  fs.writeFileSync(outPath, outLines.join(""));

  let total = 0;
  for (const [, c] of dist.entries()) total += c;
  for (const [reg, c] of dist.mostCommon()) {
    // `f"{100*c/total:.0f}"` uses round-half-to-even, so route through pyRound.
    const pct = String(pyRound((100 * c) / total, 0));
    process.stdout.write(
      `${reg}: ${c} msgs (${pct}%), ${wordDist.get(reg)} words\n`,
    );
  }
  process.stdout.write(`total: ${total}\n`);
  return 0;
}
