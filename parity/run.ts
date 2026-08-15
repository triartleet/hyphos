/**
 * Parity harness — the cutover gate. Runs a Node stage against a shared corpus,
 * then deep-compares every emitted file against a reference profiles directory
 * (produced by the original implementation). Numbers compare within a small
 * epsilon (cross-language float/rounding), everything else strict; array order is
 * significant (ranking parity).
 *
 * Configured entirely by env so nothing about a particular machine or the
 * reference checkout is baked into this repo:
 *   HYPHOS_CORPUS         shared corpus dir both implementations read
 *   HYPHOS_REF_PROFILES   reference (Python) profiles dir to compare against
 *   HYPHOS_PROFILES       (set internally) temp dir the Node run writes to
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runFingerprint } from "../src/stages/fingerprint.js";

const EPS = 1e-9;

interface Diff {
  file: string;
  keyPath: string;
  node: unknown;
  ref: unknown;
}

function walkJson(dir: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!fs.existsSync(dir)) return out;
  const rec = (d: string, rel: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) rec(full, r);
      else if (name.endsWith(".json"))
        out.set(r, JSON.parse(fs.readFileSync(full, "utf8")));
    }
  };
  rec(dir, "");
  return out;
}

function compare(
  node: unknown,
  ref: unknown,
  file: string,
  keyPath: string,
  diffs: Diff[],
): void {
  if (typeof node === "number" && typeof ref === "number") {
    if (!(Math.abs(node - ref) <= EPS))
      diffs.push({ file, keyPath, node, ref });
    return;
  }
  if (Array.isArray(node) && Array.isArray(ref)) {
    if (node.length !== ref.length) {
      diffs.push({
        file,
        keyPath: `${keyPath}.length`,
        node: node.length,
        ref: ref.length,
      });
      return;
    }
    for (let i = 0; i < node.length; i++)
      compare(node[i], ref[i], file, `${keyPath}[${i}]`, diffs);
    return;
  }
  if (node && ref && typeof node === "object" && typeof ref === "object") {
    const nk = Object.keys(node as object).sort();
    const rk = Object.keys(ref as object).sort();
    const all = new Set([...nk, ...rk]);
    for (const k of all) {
      if (!(k in (node as object))) {
        diffs.push({
          file,
          keyPath: `${keyPath}.${k}`,
          node: "<missing>",
          ref: (ref as Record<string, unknown>)[k],
        });
      } else if (!(k in (ref as object))) {
        diffs.push({
          file,
          keyPath: `${keyPath}.${k}`,
          node: (node as Record<string, unknown>)[k],
          ref: "<missing>",
        });
      } else {
        compare(
          (node as Record<string, unknown>)[k],
          (ref as Record<string, unknown>)[k],
          file,
          `${keyPath}.${k}`,
          diffs,
        );
      }
    }
    return;
  }
  if (node !== ref) diffs.push({ file, keyPath, node, ref });
}

function main(): number {
  const ref = process.env.HYPHOS_REF_PROFILES;
  if (!process.env.HYPHOS_CORPUS || !ref) {
    process.stderr.write("parity: set HYPHOS_CORPUS and HYPHOS_REF_PROFILES\n");
    return 2;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-parity-"));
  process.env.HYPHOS_PROFILES = tmp;

  process.stdout.write("parity: running Node fingerprint...\n");
  runFingerprint();

  const nodeFiles = walkJson(tmp);
  const refFiles = walkJson(ref);
  const allFiles = new Set([...nodeFiles.keys(), ...refFiles.keys()]);

  const diffs: Diff[] = [];
  const onlyNode: string[] = [];
  const onlyRef: string[] = [];
  for (const f of [...allFiles].sort()) {
    if (!nodeFiles.has(f)) {
      onlyRef.push(f);
      continue;
    }
    if (!refFiles.has(f)) {
      onlyNode.push(f);
      continue;
    }
    compare(nodeFiles.get(f), refFiles.get(f), f, "", diffs);
  }

  process.stdout.write(
    `\nfiles: ${nodeFiles.size} node / ${refFiles.size} ref\n`,
  );
  if (onlyRef.length)
    process.stdout.write(`MISSING in node: ${onlyRef.join(", ")}\n`);
  if (onlyNode.length)
    process.stdout.write(`EXTRA in node: ${onlyNode.join(", ")}\n`);
  if (diffs.length) {
    process.stdout.write(`\n${diffs.length} value mismatch(es):\n`);
    for (const d of diffs.slice(0, 40)) {
      process.stdout.write(
        `  ${d.file} ${d.keyPath}: node=${JSON.stringify(d.node)} ref=${JSON.stringify(d.ref)}\n`,
      );
    }
    if (diffs.length > 40)
      process.stdout.write(`  … and ${diffs.length - 40} more\n`);
  }

  const ok =
    diffs.length === 0 && onlyRef.length === 0 && onlyNode.length === 0;
  process.stdout.write(
    `\nparity: ${ok ? "PASS — outputs match the reference" : "FAIL"}\n`,
  );
  fs.rmSync(tmp, { recursive: true, force: true });
  return ok ? 0 : 1;
}

process.exit(main());
