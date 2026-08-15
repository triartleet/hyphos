/**
 * Model-free fidelity scoring and register discovery.
 *
 * `score` measures how close a text sits to a register's stylometric
 * fingerprint (punctuation rates, sentence length, casing, contractions) and
 * folds in a model-ism penalty from the deterministic enforcement pass. It is a
 * faithful port of the reference `text_metrics`/`score`, including the
 * short-text damping and the honest low-confidence note. All rounding goes
 * through the parity-matched `pyRound`, and numbers that Python renders as
 * floats are wrapped in `PyFloat` so the JSON output matches byte-for-byte.
 *
 * `registers_info`/`infer_register` are ported here too since inference ranks
 * registers by their `score` fidelity.
 */
import fs from "node:fs";
import path from "node:path";
import { pyRound } from "../lib/num.js";
import { words as tokenize, sentencesOf } from "../lib/text.js";
import { profilesDir } from "../lib/paths.js";
import { enforce } from "./rules.js";
import { PyFloat, numOf, pyDumps, pyJsonParse } from "./pyjson.js";
import { SysExit } from "./sysexit.js";

const CONTRACTION_RE = /\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi;

// The six stylometric metrics, in the order the reference builds them (this
// order is the JSON key order of `metric_deltas`).
const METRIC_KEYS = [
  "emdash_per_1k",
  "comma_per_1k",
  "excl_per_1k",
  "contractions_per_1k",
  "sent_p50",
  "lower_start_rate",
] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

// Every metric is a float except sent_p50 (an integer word count).
const FLOAT_METRICS = new Set<MetricKey>([
  "emdash_per_1k",
  "comma_per_1k",
  "excl_per_1k",
  "contractions_per_1k",
  "lower_start_rate",
]);

const SCALES: Record<MetricKey, number> = {
  emdash_per_1k: 2.0,
  comma_per_1k: 20.0,
  excl_per_1k: 2.0,
  contractions_per_1k: 8.0,
  sent_p50: 6.0,
  lower_start_rate: 0.3,
};
const WEIGHTS: Record<MetricKey, number> = {
  emdash_per_1k: 3.0,
  comma_per_1k: 1.0,
  excl_per_1k: 1.0,
  contractions_per_1k: 1.5,
  sent_p50: 1.0,
  lower_start_rate: 1.0,
};
// Short texts give noisy rate estimates: these metrics are damped by length.
const NOISY = new Set<MetricKey>(["comma_per_1k", "excl_per_1k", "sent_p50", "lower_start_rate"]);

// Python `str[:1].islower()` for a single leading char: cased and lowercase.
function firstIsLower(s: string): boolean {
  const c = s.slice(0, 1);
  return c.length > 0 && c === c.toLowerCase() && c !== c.toUpperCase();
}

function countChar(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

/** The six raw stylometric measurements of a text (plain numbers). */
export function textMetrics(text: string): Record<MetricKey, number> {
  const n = tokenize(text).length || 1;
  const sents = sentencesOf(text);
  const slens = sents.map((s) => tokenize(s).length);
  const per1k = (c: number): number => (c * 1000) / n;
  const contractions = (text.match(CONTRACTION_RE) ?? []).length;
  const sortedSlens = [...slens].sort((a, b) => a - b);
  const lowerStarts = sents.filter((s) => firstIsLower(s)).length;
  return {
    emdash_per_1k: per1k(countChar(text, "—")),
    comma_per_1k: per1k(countChar(text, ",")),
    excl_per_1k: per1k(countChar(text, "!")),
    contractions_per_1k: per1k(contractions),
    sent_p50: slens.length ? sortedSlens[Math.floor(slens.length / 2)]! : 0,
    lower_start_rate: lowerStarts / (sents.length || 1),
  };
}

/** Read a register's fingerprint, preserving int/float distinction for parity. */
export function loadFingerprint(register: string): Record<string, unknown> {
  const fp = path.join(profilesDir(), register, "fingerprint.json");
  let raw: string;
  try {
    raw = fs.readFileSync(fp, "utf8");
  } catch {
    throw new SysExit(`no fingerprint for register '${register}' — run bin/profile_fingerprint.py`);
  }
  return pyJsonParse(raw) as Record<string, unknown>;
}

// `dict.get(key, default)` over a possibly-missing nested value.
function getOr(obj: unknown, key: string, dflt: number | PyFloat): number | PyFloat {
  if (obj && typeof obj === "object" && key in (obj as Record<string, unknown>)) {
    return (obj as Record<string, number | PyFloat>)[key]!;
  }
  return dflt;
}

// Python `round(v, nd)`: a float stays a float (PyFloat), an int stays an int.
function roundKeepType(v: number | PyFloat, nd: number): number | PyFloat {
  if (v instanceof PyFloat) return new PyFloat(pyRound(v.value, nd));
  return pyRound(v, nd);
}

export interface ScoreResult {
  fidelity: PyFloat;
  confidence: string;
  model_ism_signals: number;
  metric_deltas: Record<string, { text: number | PyFloat; register: number | PyFloat }>;
  note: string;
  judge?: unknown;
}

/** Compute the model-free fidelity score of a text against a register. */
export function score(text: string, register: string): ScoreResult {
  const fp = loadFingerprint(register);
  const m = textMetrics(text);
  const punct = fp["punct_per_1k_words"];
  const sentenceLen = fp["sentence_len"] as Record<string, number | PyFloat>;

  const ref: Record<MetricKey, number | PyFloat> = {
    emdash_per_1k: getOr(punct, "—", new PyFloat(0.0)),
    comma_per_1k: getOr(punct, ",", new PyFloat(0.0)),
    excl_per_1k: getOr(punct, "!", new PyFloat(0.0)),
    contractions_per_1k: fp["contractions_per_1k"] as number | PyFloat,
    sent_p50: sentenceLen["p50"]!,
    lower_start_rate: fp["lowercase_sentence_start_rate"] as number | PyFloat,
  };

  const nWords = tokenize(text).length || 1;
  const damp = Math.min(1.0, nWords / 250);

  let penalty = 0.0;
  let totalW = 0.0;
  const deltas: ScoreResult["metric_deltas"] = {};
  for (const k of METRIC_KEYS) {
    const mv = m[k];
    const rv = numOf(ref[k]);
    const d = Math.min(Math.abs(mv - rv) / SCALES[k], 1.0);
    deltas[k] = {
      text: FLOAT_METRICS.has(k) ? new PyFloat(pyRound(mv, 2)) : pyRound(mv, 2),
      register: roundKeepType(ref[k], 2),
    };
    const w = WEIGHTS[k] * (NOISY.has(k) ? damp : 1.0);
    penalty += d * w;
    totalW += w;
  }

  const [, rep] = enforce(text);
  const ismHits =
    Object.values(rep.applied).reduce((s, v) => s + v, 0) +
    Object.values(rep.flags).reduce((s, v) => s + v, 0);
  const ismPen = Math.min(ismHits * 0.06, 0.4);
  const fidelity = Math.max(0.0, (1 - penalty / totalW) * (1 - ismPen)) * 100;
  const confidence = nWords >= 250 ? "ok" : "low";

  return {
    fidelity: new PyFloat(pyRound(fidelity, 1)),
    confidence,
    model_ism_signals: ismHits,
    metric_deltas: deltas,
    note:
      "uncalibrated v1 — the model-ism count is the robust " +
      "signal on short texts; fidelity needs >=250 words and " +
      "blind-test calibration",
  };
}

export interface RegisterInfo {
  register: string;
  words: number;
  confidence: string;
  hint: string | null;
}

/**
 * Discover registers from profile buckets. A register exists because corpus
 * exists; confidence reflects sampling depth, and low confidence advertises its
 * cure (more samples). `-pre2023` buckets are excluded.
 */
export function registersInfo(): RegisterInfo[] {
  const out: RegisterInfo[] = [];
  const profiles = profilesDir();
  let entries: string[];
  try {
    if (!fs.statSync(profiles).isDirectory()) return out;
    entries = fs.readdirSync(profiles).sort();
  } catch {
    return out;
  }
  for (const name of entries) {
    const dir = path.join(profiles, name);
    const fp = path.join(dir, "fingerprint.json");
    let isDir = false;
    let fpIsFile = false;
    try {
      isDir = fs.statSync(dir).isDirectory();
    } catch {
      isDir = false;
    }
    try {
      fpIsFile = fs.statSync(fp).isFile();
    } catch {
      fpIsFile = false;
    }
    if (!isDir || !fpIsFile || name.endsWith("-pre2023")) continue;
    const data = JSON.parse(fs.readFileSync(fp, "utf8")) as { words?: number };
    const words = data.words ?? 0;
    const conf = words >= 30000 ? "high" : words >= 8000 ? "medium" : "low";
    out.push({
      register: name,
      words,
      confidence: conf,
      hint: conf !== "low" ? null : "low sampling — add source material to sharpen this voice",
    });
  }
  return out;
}

export interface InferResult {
  register: string;
  confidence: string;
  scores: Record<string, PyFloat> | Record<string, never>;
}

/**
 * Pick the closest register for a draft by stylometric proximity. Confidence
 * comes from the margin between the top two candidates. Low-sample registers are
 * skipped (their fingerprints are unstable and can win by accident).
 */
export function inferRegister(text: string): InferResult {
  const ranked: [number, string][] = [];
  for (const r of registersInfo()) {
    if (r.confidence === "low") continue;
    try {
      ranked.push([numOf(score(text, r.register).fidelity), r.register]);
    } catch (e) {
      if (e instanceof SysExit) continue;
      throw e;
    }
  }
  if (ranked.length === 0) return { register: "editorial", confidence: "none", scores: {} };
  // Python `list.sort(reverse=True)` on (fidelity, register) tuples: descending
  // by fidelity, then descending by register name for ties.
  ranked.sort((a, b) => (b[0] !== a[0] ? b[0] - a[0] : b[1] < a[1] ? -1 : b[1] > a[1] ? 1 : 0));
  const margin = ranked[0]![0] - (ranked.length > 1 ? ranked[1]![0] : 0);
  const scores: Record<string, PyFloat> = {};
  for (const [s, r] of ranked) scores[r] = new PyFloat(pyRound(s, 1));
  return {
    register: ranked[0]![1],
    confidence: margin >= 15 ? "high" : "low",
    scores,
  };
}

/**
 * `score` subcommand: score a file against a register and print the JSON result
 * (Python `json.dumps(..., indent=1)` — non-ASCII escaped). With `--judge`, the
 * model-judged half is added. Returns an exit code.
 */
export async function runScore(
  file: string,
  opts: { register: string; judge?: boolean },
): Promise<number> {
  const text = fs.readFileSync(file, "utf8");
  const result: ScoreResult = score(text, opts.register);
  if (opts.judge) {
    const { judge } = await import("./rewrite.js");
    result.judge = await judge(text, opts.register);
  }
  process.stdout.write(pyDumps(result, { indent: 1 }) + "\n");
  return 0;
}
