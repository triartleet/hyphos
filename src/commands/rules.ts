/**
 * Deterministic quirk-enforcement engine (D-003: the post-model pass).
 *
 * Every content-adaptation operation is a declared rule with an id, a kind, a
 * regular-expression pattern, and its own test cases. The engine applies the
 * rules in listed order (deterministic), reports per-rule counts, and the
 * self-test verifies every rule against its cases. This is a faithful port of
 * the reference `RULES`/`load_rules`/`enforce`/`rules_selftest` — the patterns,
 * their order, and their tests are preserved exactly.
 *
 * Regex semantics match Python's `re`:
 *  - `remove`/`replace` rules run case-sensitively (Python uses `re.subn` with no
 *    flags); `flag` rules count case-insensitively (Python `re.findall(..., re.I)`).
 *  - Patterns keep Python's ASCII `\w`/`\b` behaviour (JavaScript's defaults),
 *    which is what the English-oriented model-ism rules target.
 *  - `replace` replacement strings use Python-style `\1` back-references, expanded
 *    manually so `$` stays literal (Python does not treat it specially).
 */
import fs from "node:fs";
import path from "node:path";
import { profilesDir } from "../lib/paths.js";
import { pyDumps } from "./pyjson.js";

export type RuleKind = "remove" | "replace" | "flag";

export interface RuleTest {
  in: string;
  out?: string;
  flags?: number;
}

export interface Rule {
  id: string;
  kind: RuleKind;
  pattern: string;
  replacement?: string;
  tests?: RuleTest[];
}

export interface EnforceReport {
  applied: Record<string, number>;
  flags: Record<string, number>;
  typos_injected?: number;
}

// The built-in rules, in application order. Preserved verbatim from the reference.
export const RULES: Rule[] = [
  {
    id: "opener-worth-noting",
    kind: "remove",
    pattern: "It(?:'|’)s worth noting that\\s+",
    tests: [{ in: "It's worth noting that X works.", out: "X works." }],
  },
  {
    id: "opener-importantly",
    kind: "remove",
    pattern: "Importantly,\\s+",
    tests: [{ in: "Importantly, it passed.", out: "it passed." }],
  },
  {
    id: "opener-notably",
    kind: "remove",
    pattern: "Notably,\\s+",
    tests: [{ in: "Notably, both fail.", out: "both fail." }],
  },
  {
    id: "flattery-standalone",
    kind: "remove",
    // standalone sentence only — mid-clause occurrences are flagged, not
    // amputated (learned from a dangling "to prioritize it." in testing)
    pattern: "You(?:'|’)re absolutely (?:right|correct)[.!]\\s*",
    tests: [
      { in: "You're absolutely right. Next point.", out: "Next point." },
      { in: "You're absolutely right to ask.", out: "You're absolutely right to ask." },
    ],
  },
  {
    id: "emdash-pair",
    kind: "replace",
    pattern: "\\s+—\\s+([^—\\n]{1,60})\\s+—\\s+",
    replacement: " (\\1) ",
    tests: [{ in: "a — the fix — b", out: "a (the fix) b" }],
  },
  {
    id: "emdash-single",
    kind: "replace",
    pattern: "\\s+—\\s+",
    replacement: ", ",
    tests: [{ in: "clear — mostly", out: "clear, mostly" }],
  },
  {
    id: "emdash-tight",
    kind: "replace",
    // letters only: \w includes digits, and the first self-test run caught
    // this rule mangling year ranges ("1990—1995") exactly as its own
    // docstring promised it wouldn't
    pattern: "(?<=[a-zA-Z])—(?=[a-zA-Z])",
    replacement: ", ",
    tests: [
      { in: "yes—no", out: "yes, no" },
      { in: "1990—1995", out: "1990—1995" },
    ],
  },
  {
    id: "contrast-flip",
    kind: "flag",
    pattern: "\\b(?:that|this|it)(?:'|’)s not (?:just )?\\w[\\w\\s]{0,30}[—,-]\\s*(?:it|that)(?:'|’)s\\b",
    tests: [{ in: "it's not just speed, it's design", flags: 1 }],
  },
  {
    id: "inflation-word",
    kind: "flag",
    pattern:
      "\\b(?:delve|crucial(?:ly)?|robust|seamless(?:ly)?|comprehensive|pivotal|testament to|tapestry|elevate|game-?changer)\\b",
    tests: [{ in: "a robust and seamless flow", flags: 2 }],
  },
  {
    id: "verdict-phrase",
    kind: "flag",
    pattern: "\\b(?:smoking gun|load-bearing|the single most|the sharpest)\\b",
    tests: [{ in: "that is the smoking gun", flags: 1 }],
  },
  {
    id: "flattery-clause",
    kind: "flag",
    pattern: "\\byou(?:'|’)re absolutely (?:right|correct)\\b",
    tests: [{ in: "you're absolutely right to ask", flags: 1 }],
  },
  {
    id: "bold-sprinkle",
    kind: "flag",
    pattern: "\\*\\*[^*\\n]{1,30}\\*\\*",
    tests: [{ in: "the **key** point", flags: 1 }],
  },
];

// Whole-pipeline fixtures: exercise `enforce` end to end, not one rule.
export const PIPELINE_FIXTURES: { in: string; out: string }[] = [
  { in: "Importantly, this — mostly — works.", out: "this (mostly) works." },
];

/**
 * Built-in rules plus any personal overlay in `profiles/rules.json` (same
 * schema, merged after the built-ins). A malformed or unreadable overlay is
 * ignored, matching the reference's silent fallback.
 */
export function loadRules(): Rule[] {
  const rules = [...RULES];
  const overlay = path.join(profilesDir(), "rules.json");
  try {
    if (fs.statSync(overlay).isFile()) {
      const extra = JSON.parse(fs.readFileSync(overlay, "utf8")) as Rule[];
      rules.push(...extra);
    }
  } catch {
    // missing or invalid overlay — keep the built-ins only
  }
  return rules;
}

// Expand a Python-style replacement string (\1..\9, \g<n>, \\) against the
// match's capture groups. Anything else, including `$`, is copied literally.
function expandReplacement(repl: string, match: string, groups: (string | undefined)[]): string {
  let out = "";
  for (let i = 0; i < repl.length; i++) {
    const ch = repl[i]!;
    if (ch === "\\" && i + 1 < repl.length) {
      const next = repl[i + 1]!;
      if (next >= "0" && next <= "9") {
        const g = next.charCodeAt(0) - 48;
        out += g === 0 ? match : (groups[g - 1] ?? "");
        i++;
        continue;
      }
      if (next === "g" && repl[i + 2] === "<") {
        const close = repl.indexOf(">", i + 3);
        if (close !== -1) {
          const g = parseInt(repl.slice(i + 3, close), 10);
          if (!Number.isNaN(g)) out += g === 0 ? match : (groups[g - 1] ?? "");
          i = close;
          continue;
        }
      }
      if (next === "\\") {
        out += "\\";
        i++;
        continue;
      }
      out += next;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

// Global substitution returning [newText, substitutionCount], like `re.subn`.
function subn(re: RegExp, replacement: string, text: string): [string, number] {
  let count = 0;
  const out = text.replace(re, (...args: unknown[]) => {
    count++;
    const match = args[0] as string;
    // args = [match, p1..pN, offset, string, (namedGroups?)]. Drop a trailing
    // named-groups object if present, then offset and string, leaving the groups.
    let end = args.length;
    if (typeof args[end - 1] === "object" && args[end - 1] !== null) end -= 1;
    const groups = args.slice(1, end - 2) as (string | undefined)[];
    return expandReplacement(replacement, match, groups);
  });
  return [out, count];
}

/** Apply one rule. Returns [text, count]; `flag` rules leave text unchanged. */
export function applyOne(rule: Rule, text: string): [string, number] {
  if (rule.kind === "remove") return subn(new RegExp(rule.pattern, "g"), "", text);
  if (rule.kind === "replace") return subn(new RegExp(rule.pattern, "g"), rule.replacement ?? "", text);
  const matches = text.match(new RegExp(rule.pattern, "gi"));
  return [text, matches ? matches.length : 0];
}

/**
 * Run the full deterministic pass: apply the remove/replace rules (recording
 * counts), tally the flag rules, then collapse runs of 2+ spaces/tabs. Returns
 * the cleaned text and a report of what fired.
 */
export function enforce(text: string): [string, EnforceReport] {
  const report: EnforceReport = { applied: {}, flags: {} };
  for (const rule of loadRules()) {
    if (rule.kind === "flag") {
      const [, n] = applyOne(rule, text);
      if (n) report.flags[rule.id] = n;
    } else {
      const [next, n] = applyOne(rule, text);
      text = next;
      if (n) report.applied[rule.id] = n;
    }
  }
  text = text.replace(/[ \t]{2,}/g, " ");
  return [text, report];
}

// Best-effort Python `repr()` for the failure diagnostics below (single-quoted,
// matching CPython's preference). Only printed when a test fails.
function pyRepr(s: string): string {
  const hasSingle = s.includes("'");
  const hasDouble = s.includes('"');
  const quote = hasSingle && !hasDouble ? '"' : "'";
  let body = "";
  for (const ch of s) {
    if (ch === "\\") body += "\\\\";
    else if (ch === quote) body += "\\" + quote;
    else if (ch === "\n") body += "\\n";
    else if (ch === "\r") body += "\\r";
    else if (ch === "\t") body += "\\t";
    else body += ch;
  }
  return quote + body + quote;
}

/**
 * Verify every rule against its own tests and the whole-pipeline fixtures.
 * Returns the number of failures (0 = all pass). Mirrors the reference output
 * so `hyphos rules --test` reads identically.
 */
export function rulesSelftest(verbose = true): number {
  let failures = 0;
  const rules = loadRules();
  for (const rule of rules) {
    for (const t of rule.tests ?? []) {
      const [out, n] = applyOne(rule, t.in);
      if (t.out !== undefined && out !== t.out) {
        failures++;
        console.log(`FAIL ${rule.id}: ${pyRepr(t.in)} -> ${pyRepr(out)}, expected ${pyRepr(t.out)}`);
      } else if (t.flags !== undefined && n !== t.flags) {
        failures++;
        console.log(`FAIL ${rule.id}: ${pyRepr(t.in)} flagged ${n}, expected ${t.flags}`);
      }
    }
  }
  for (const fx of PIPELINE_FIXTURES) {
    const [out] = enforce(fx.in);
    if (out !== fx.out) {
      failures++;
      console.log(`FAIL pipeline: ${pyRepr(fx.in)} -> ${pyRepr(out)}, expected ${pyRepr(fx.out)}`);
    }
  }
  if (verbose) {
    const nRules = rules.length;
    const nTests = rules.reduce((s, r) => s + (r.tests?.length ?? 0), 0) + PIPELINE_FIXTURES.length;
    console.log(`${nRules} rules, ${nTests} tests, ${failures} failure(s)`);
  }
  return failures;
}

/**
 * `rules` subcommand: with `--test`, run the self-test and return its exit code
 * (1 on any failure, else 0). Without it, list every rule. Returns an exit code.
 */
export function runRules(opts: { test?: boolean } = {}): number {
  if (opts.test) return rulesSelftest() ? 1 : 0;
  for (const rule of loadRules()) {
    const tests = rule.tests?.length ?? 0;
    process.stdout.write(`${rule.id.padEnd(22)} ${rule.kind.padEnd(8)} ${tests} test(s)\n`);
  }
  return 0;
}

/**
 * `enforce` subcommand: run the deterministic pass on a file, write the result
 * to stdout (no trailing newline, as the reference does) and the report to
 * stderr. The `--register` flag is accepted for symmetry but unused (enforcement
 * is register-independent). Returns an exit code.
 */
export function runEnforce(file: string, _opts: { register?: string } = {}): number {
  const text = fs.readFileSync(file, "utf8");
  const [out, report] = enforce(text);
  process.stdout.write(out);
  process.stderr.write("\n== enforcement ==\n" + pyDumps(report, { indent: 1 }) + "\n");
  return 0;
}
