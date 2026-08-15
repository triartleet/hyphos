/**
 * Extract-stage parity driver. Runs the Node extractor against a frozen
 * transcript snapshot into a temp corpus, then diffs against a reference
 * (Python-produced) raw-sessions.jsonl + stats.md.
 *
 * Env: SNAPSHOT_PROJECTS (frozen transcript projects dir),
 *      HYPHOS_REF_EXTRACT (dir holding the reference raw-sessions.jsonl + stats.md)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runExtract } from "../src/stages/extract.js";
import { diffJsonl, reportDiffs } from "./jsonl.js";

function main(): number {
  const snap = process.env.SNAPSHOT_PROJECTS;
  const ref = process.env.HYPHOS_REF_EXTRACT;
  if (!snap || !ref) {
    process.stderr.write(
      "extract parity: set SNAPSHOT_PROJECTS and HYPHOS_REF_EXTRACT\n",
    );
    return 2;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hyphos-extract-"));
  process.env.HYPHOS_CORPUS = tmp;
  const saved = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: () => boolean }).write = () => true;
  try {
    // argv[1] is the transcript directory (mirrors the Python sys.argv contract).
    runExtract(["extract", snap]);
  } finally {
    (process.stdout as unknown as { write: typeof saved }).write = saved;
  }
  let ok = reportDiffs(
    "raw-sessions.jsonl",
    diffJsonl(
      path.join(tmp, "raw-sessions.jsonl"),
      path.join(ref, "raw-sessions.jsonl"),
    ),
  );
  const a = fs.existsSync(path.join(tmp, "stats.md"))
    ? fs.readFileSync(path.join(tmp, "stats.md"), "utf8")
    : "<missing>";
  const b = fs.existsSync(path.join(ref, "stats.md"))
    ? fs.readFileSync(path.join(ref, "stats.md"), "utf8")
    : "<missing>";
  const mdOk = a === b;
  process.stdout.write(
    `  stats.md: ${mdOk ? "PASS (byte-identical)" : "FAIL (differs)"}\n`,
  );
  ok = ok && mdOk;
  fs.rmSync(tmp, { recursive: true, force: true });
  process.stdout.write(`extract parity: ${ok ? "PASS" : "FAIL"}\n`);
  return ok ? 0 : 1;
}

process.exit(main());
