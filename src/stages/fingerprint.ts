/**
 * Stage 1b — stylometric fingerprints per register bucket. Model-free
 * measurements of how the user writes. Faithful port of the reference
 * `profile_fingerprint.py`; all numeric behavior goes through the parity-matched
 * helpers in ../lib.
 *
 * Non-English chat (greeklish + Greek) is pooled per source into a rhythm-only
 * fingerprint: it contributes rhythm, punctuation and casing habits, never
 * vocabulary.
 */
import fs from "node:fs";
import path from "node:path";
import { Counter } from "../lib/counter.js";
import { pyRound, mean, median } from "../lib/num.js";
import { words, typoTokens, sentencesOf } from "../lib/text.js";
import { corpusDir, profilesDir } from "../lib/paths.js";

const PUNCT = [".", ",", ";", ":", "!", "?", "—", "–", "-", "(", ")", '"', "'", "…"];
const CONNECTORS = [
  "so", "thus", "also", "then", "but", "though", "however", "actually",
  "basically", "anyway", "instead", "meaning", "plus", "regarding", "since",
  "therefore", "besides", "otherwise", "still", "yet",
];
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
const CONTRACTION_RE = /\b\w+'(s|t|re|ve|ll|d|m)\b/gi;
const ELLIPSIS_RE = /\.\.\.|…/g;

// The transferable subset (non-English contributes rhythm, never vocabulary).
const RHYTHM_KEYS = [
  "messages", "words", "sentence_len", "message_len_p50",
  "punct_per_1k_words", "lowercase_sentence_start_rate",
  "allcaps_word_per_1k", "emoji_per_1k", "ellipses_per_1k",
] as const;

export interface Fingerprint {
  messages: number;
  words: number;
  sentence_len: { mean: number; p50: number; p90: number };
  message_len_p50: number;
  punct_per_1k_words: Record<string, number>;
  lowercase_sentence_start_rate: number;
  allcaps_word_per_1k: number;
  emoji_per_1k: number;
  contractions_per_1k: number;
  ellipses_per_1k: number;
  avg_word_len: number;
  unique_word_ratio: number;
  top_sentence_openers: [string, number][];
  connector_use_per_1k: Record<string, number>;
  typo_per_1k?: number;
}

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

// Python str.isupper(): at least one cased char, and no lowercase cased chars.
function isUpperPy(w: string): boolean {
  return w !== w.toLowerCase() && w === w.toUpperCase();
}

// Python str.islower() for the leading char: a cased char that is lowercase.
function firstCharIsLower(s: string): boolean {
  const c = s.slice(0, 1);
  return c.length > 0 && c === c.toLowerCase() && c !== c.toUpperCase();
}

let DICT: Set<string> | null = null;
function dictionary(): Set<string> {
  if (DICT === null) {
    try {
      DICT = new Set(
        fs.readFileSync("/usr/share/dict/words", "utf8").split("\n").map((w) => w.trim().toLowerCase()),
      );
    } catch {
      DICT = new Set();
    }
  }
  return DICT;
}

const EDIT_LETTERS = "abcdefghijklmnopqrstuvwxyz'";

// Yields edit-distance-1 forms in the reference order: deletes, swaps, replaces,
// inserts. Order matters — the first dictionary hit wins.
function* edit1Forms(w: string): Generator<string> {
  const splits: [string, string][] = [];
  for (let i = 0; i <= w.length; i++) splits.push([w.slice(0, i), w.slice(i)]);
  for (const [a, b] of splits) if (b) yield a + b.slice(1); // delete
  for (const [a, b] of splits) if (b.length > 1) yield a + b[1] + b[0] + b.slice(2); // swap
  for (const [a, b] of splits) if (b) for (const c of EDIT_LETTERS) yield a + c + b.slice(1); // replace
  for (const [a, b] of splits) for (const c of EDIT_LETTERS) yield a + c + b; // insert
}

function typoCatalog(texts: string[]): { count: number; catalog: Record<string, string> } {
  const d = dictionary();
  if (d.size === 0) return { count: 0, catalog: {} };

  const known = (w: string): boolean => {
    if (w.includes("'") || d.has(w)) return true;
    for (const suf of ["s", "es", "ed", "ing", "ly", "er", "est"]) {
      if (w.endsWith(suf) && d.has(w.slice(0, w.length - suf.length))) return true;
    }
    if (w.endsWith("ing") && d.has(w.slice(0, -3) + "e")) return true; // staging, writing
    if (w.endsWith("ed") && d.has(w.slice(0, -1))) return true; // merged, shared
    return false;
  };

  const freq = new Counter<string>();
  for (const t of texts) for (const w of typoTokens(t)) freq.add(w);

  const catalog: Record<string, string> = {};
  let count = 0;
  for (const [w, n] of freq.entries()) {
    if (n > 2 || known(w)) continue;
    for (const form of edit1Forms(w)) {
      if (d.has(form) && freq.get(form) >= Math.max(3 * n, 3)) {
        catalog[w] = form;
        count += n;
        break;
      }
    }
  }
  return { count, catalog };
}

export function fingerprint(texts: string[]): Fingerprint {
  const nMsgs = texts.length;
  const wordsAll: string[] = [];
  const sentLens: number[] = [];
  const msgLens: number[] = [];
  const punct = new Counter<string>();
  const firstWords = new Counter<string>();
  const connectors = new Counter<string>();
  let lowerStarts = 0;
  let capsWords = 0;
  let emoji = 0;
  let contractions = 0;
  let ellipses = 0;

  for (const t of texts) {
    const ws = words(t);
    for (const w of ws) wordsAll.push(w.toLowerCase());
    msgLens.push(ws.length);
    for (const s of sentencesOf(t)) {
      const sw = words(s);
      if (sw.length === 0) continue;
      sentLens.push(sw.length);
      firstWords.add(sw[0]!.toLowerCase());
      if (firstCharIsLower(s)) lowerStarts++;
    }
    for (const p of PUNCT) punct.add(p, countOccurrences(t, p));
    for (const w of ws) if (w.length > 2 && isUpperPy(w)) capsWords++;
    emoji += (t.match(EMOJI_RE) ?? []).length;
    contractions += (t.match(CONTRACTION_RE) ?? []).length;
    ellipses += (t.match(ELLIPSIS_RE) ?? []).length;
    // Add every connector in list order (k may be 0) — Python's `counter[c] += k`
    // creates each key even at zero, so the canonical list order is the tie-break
    // for most_common. The zero entries are filtered from the OUTPUT below, not
    // from the ranking population.
    for (const c of CONNECTORS) {
      let k = 0;
      for (const w of ws) if (w.toLowerCase() === c) k++;
      connectors.add(c, k);
    }
  }

  const totalWords = wordsAll.length || 1;
  const totalSents = sentLens.length || 1;
  const per1k = (x: number): number => pyRound((x * 1000) / totalWords, 2);

  const sortedSent = [...sentLens].sort((a, b) => a - b);
  const punctOut: Record<string, number> = {};
  for (const [p, c] of punct.entries()) if (c) punctOut[p] = per1k(c);
  const connectorOut: Record<string, number> = {};
  for (const [c, k] of connectors.mostCommon(12)) if (k) connectorOut[c] = per1k(k);

  return {
    messages: nMsgs,
    words: totalWords,
    sentence_len: {
      mean: sentLens.length ? pyRound(mean(sentLens), 1) : 0,
      p50: sentLens.length ? median(sentLens) : 0,
      p90: sentLens.length ? sortedSent[Math.trunc(totalSents * 0.9) - 1]! : 0,
    },
    message_len_p50: msgLens.length ? median(msgLens) : 0,
    punct_per_1k_words: punctOut,
    lowercase_sentence_start_rate: pyRound(lowerStarts / totalSents, 3),
    allcaps_word_per_1k: per1k(capsWords),
    emoji_per_1k: per1k(emoji),
    contractions_per_1k: per1k(contractions),
    ellipses_per_1k: per1k(ellipses),
    avg_word_len: pyRound(wordsAll.reduce((s, w) => s + w.length, 0) / totalWords, 2),
    unique_word_ratio: pyRound(new Set(wordsAll).size / totalWords, 3),
    top_sentence_openers: firstWords.mostCommon(15),
    connector_use_per_1k: connectorOut,
  };
}

function rhythmOnly(fp: Fingerprint): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  const src = fp as unknown as Record<string, unknown>;
  for (const k of RHYTHM_KEYS) if (k in fp) r[k] = src[k];
  r["signal"] = "rhythm-only (D-004: non-English contributes rhythm, never vocabulary)";
  return r;
}

function emailYear(ts: string): number | null {
  for (const tok of ts.split(/\s+/)) {
    if (/^\d+$/.test(tok) && tok.length === 4) return parseInt(tok, 10);
  }
  return null;
}

function readJsonl(file: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.length === 0) continue;
    out.push(JSON.parse(line));
  }
  return out;
}

/** Python `json.dumps(obj, ensure_ascii=False, indent=1)` — 1-space indent. */
function dumpJson(obj: unknown): string {
  return JSON.stringify(obj, null, 1);
}

export function runFingerprint(): number {
  const corpus = corpusDir();
  const profiles = profilesDir();
  const buckets = new Map<string, string[]>();
  const rhythmBuckets = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string): void => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };

  for (const fname of ["tagged.jsonl", "salvaged.jsonl"]) {
    const f = path.join(corpus, fname);
    if (fs.existsSync(f)) {
      for (const o of readJsonl(f)) push(buckets, o["register"] as string, o["text"] as string);
    }
  }

  const listing = fs.existsSync(corpus) ? fs.readdirSync(corpus) : [];
  const emailFiles = listing.filter((f) => f.startsWith("email-") && f.endsWith(".jsonl")).sort();
  const chatFiles = listing.filter((f) => f.startsWith("chat-") && f.endsWith(".jsonl")).sort();
  for (const fname of [...emailFiles, ...chatFiles]) {
    const kind = fname.startsWith("email-") ? "email" : "chat";
    for (const o of readJsonl(path.join(corpus, fname))) {
      let stem = ((o["source"] as string) ?? `${kind}:x`).split(/:(.*)/s)[1] ?? "x";
      if (stem.endsWith("-account")) stem = stem.slice(0, -8);
      const bucket = `${kind}-${stem}`;
      if (o["lang"] !== "en") {
        if (kind === "chat") push(rhythmBuckets, bucket, o["text"] as string);
        continue;
      }
      push(buckets, bucket, o["text"] as string);
      const y = emailYear(String(o["ts"] ?? ""));
      if (y !== null && y < 2023) push(buckets, `${bucket}-pre2023`, o["text"] as string);
      else if (y !== null && y >= 2024) push(buckets, `${bucket}-recent`, o["text"] as string);
    }
  }

  if (buckets.size === 0 && rhythmBuckets.size === 0) {
    process.stderr.write("no corpus files found\n");
    return 1;
  }

  for (const [name, texts] of buckets) {
    const d = path.join(profiles, name);
    fs.mkdirSync(d, { recursive: true });
    const fp = fingerprint(texts);
    const { count: nTypos, catalog } = typoCatalog(texts);
    fp.typo_per_1k = pyRound((nTypos * 1000) / Math.max(fp.words, 1), 2);
    fs.writeFileSync(path.join(d, "fingerprint.json"), dumpJson(fp));
    if (Object.keys(catalog).length > 0) {
      fs.writeFileSync(path.join(d, "typos.json"), dumpJson(catalog));
    }
    process.stdout.write(
      `${name}: ${fp.messages} msgs, ${fp.words} words, sent p50 ${fp.sentence_len.p50}, ` +
        `typos/1k ${fp.typo_per_1k} (${Object.keys(catalog).length} distinct)\n`,
    );
  }

  for (const [name, texts] of rhythmBuckets) {
    const totalWords = texts.reduce((s, t) => s + t.split(/\s+/).filter(Boolean).length, 0);
    if (totalWords < 500) continue;
    const d = path.join(profiles, name);
    fs.mkdirSync(d, { recursive: true });
    const r = rhythmOnly(fingerprint(texts));
    fs.writeFileSync(path.join(d, "rhythm.json"), dumpJson(r));
    const sl = r["sentence_len"] as { p50: number };
    process.stdout.write(
      `${name} [rhythm-only]: ${r["messages"]} msgs, ${r["words"]} non-en words, sent p50 ${sl.p50}\n`,
    );
  }
  return 0;
}
