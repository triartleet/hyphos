/**
 * JSONL parity helpers for the stage cutover gate. Compares two JSONL files as
 * PARSED records (order-significant): counts, then field-by-field per line, with
 * numbers within epsilon and everything else strict. Serialization differences
 * (separator style, key order) do not matter — only the data.
 */
import fs from "node:fs";

const EPS = 1e-9;

export interface RecordDiff {
  line: number;
  keyPath: string;
  node: unknown;
  ref: unknown;
}

function compare(a: unknown, b: unknown, kp: string, line: number, out: RecordDiff[]): void {
  if (typeof a === "number" && typeof b === "number") {
    if (!(Math.abs(a - b) <= EPS)) out.push({ line, keyPath: kp, node: a, ref: b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push({ line, keyPath: `${kp}.length`, node: a.length, ref: b.length }); return; }
    for (let i = 0; i < a.length; i++) compare(a[i], b[i], `${kp}[${i}]`, line, out);
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) {
      const av = (a as Record<string, unknown>)[k];
      const bv = (b as Record<string, unknown>)[k];
      if (!(k in (a as object))) out.push({ line, keyPath: `${kp}.${k}`, node: "<missing>", ref: bv });
      else if (!(k in (b as object))) out.push({ line, keyPath: `${kp}.${k}`, node: av, ref: "<missing>" });
      else compare(av, bv, `${kp}.${k}`, line, out);
    }
    return;
  }
  if (a !== b) out.push({ line, keyPath: kp, node: a, ref: b });
}

function readRecords(file: string): unknown[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
}

/** Compare two JSONL files as parsed records. Returns diffs (empty = parity). */
export function diffJsonl(nodeFile: string, refFile: string): RecordDiff[] {
  const n = readRecords(nodeFile);
  const r = readRecords(refFile);
  const diffs: RecordDiff[] = [];
  if (n.length !== r.length) diffs.push({ line: 0, keyPath: "<record count>", node: n.length, ref: r.length });
  const len = Math.min(n.length, r.length);
  for (let i = 0; i < len; i++) compare(n[i], r[i], "", i + 1, diffs);
  return diffs;
}

export function reportDiffs(label: string, diffs: RecordDiff[]): boolean {
  if (diffs.length === 0) {
    process.stdout.write(`  ${label}: PASS\n`);
    return true;
  }
  process.stdout.write(`  ${label}: FAIL (${diffs.length} diff(s))\n`);
  for (const d of diffs.slice(0, 20)) {
    process.stdout.write(`    line ${d.line} ${d.keyPath}: node=${JSON.stringify(d.node)} ref=${JSON.stringify(d.ref)}\n`);
  }
  return false;
}
