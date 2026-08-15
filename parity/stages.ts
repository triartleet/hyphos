/**
 * Stage parity gate — runs each Node pipeline stage against inputs copied from a
 * reference corpus, into a temp corpus, and diffs the outputs against the
 * reference outputs. JSONL is compared as parsed records; .md outputs byte-for-byte.
 *
 * Config via env (nothing machine-specific baked in):
 *   HYPHOS_REF_CORPUS   reference corpus dir (holds both inputs and reference outputs)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runCurate } from "../src/stages/curate.js";
import { runTag } from "../src/stages/tag.js";
import { runSalvage } from "../src/stages/salvage.js";
import { runIngestChat } from "../src/stages/ingestChat.js";
import { runIngestEmail } from "../src/stages/ingestEmail.js";
import { diffJsonl, reportDiffs } from "./jsonl.js";

interface StageCfg {
  name: string;
  inputs: string[]; // files/dirs to copy from ref corpus
  run: () => number;
  jsonlOutputs: string[];
  globOutputs?: string; // diff every ref file with this prefix ending in .jsonl
  fileOutputs?: string[]; // byte-compared (e.g. .md)
}

const stages: StageCfg[] = [
  {
    name: "curate",
    inputs: ["raw-sessions.jsonl"],
    run: () => runCurate([]),
    jsonlOutputs: ["curated.jsonl", "quarantine.jsonl"],
    fileOutputs: ["stats-curated.md"],
  },
  {
    name: "tag",
    inputs: ["curated.jsonl"],
    run: () => runTag([]),
    jsonlOutputs: ["tagged.jsonl"],
  },
  {
    name: "salvage",
    inputs: ["quarantine.jsonl", "curated.jsonl"],
    run: () => runSalvage([]),
    jsonlOutputs: ["salvaged.jsonl"],
  },
  {
    name: "ingest-chat",
    inputs: ["inbox"],
    run: () => runIngestChat([]),
    jsonlOutputs: ["chat-facebook.jsonl"],
  },
  // ingest_email writes ONLY email-sent.jsonl; any email-formal/informal in a
  // corpus are stale artifacts from an older pipeline, not this stage's output.
  {
    name: "ingest-email",
    inputs: ["inbox"],
    run: () => runIngestEmail([]),
    jsonlOutputs: ["email-sent.jsonl"],
  },
];

function copyInto(src: string, dst: string): void {
  if (!fs.existsSync(src)) return;
  if (fs.statSync(src).isDirectory()) fs.cpSync(src, dst, { recursive: true });
  else fs.copyFileSync(src, dst);
}

function main(): number {
  const ref = process.env.HYPHOS_REF_CORPUS;
  if (!ref) {
    process.stderr.write("stages parity: set HYPHOS_REF_CORPUS\n");
    return 2;
  }
  let allOk = true;
  for (const st of stages) {
    process.stdout.write(`\n== ${st.name} ==\n`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `hyphos-${st.name}-`));
    for (const inp of st.inputs)
      copyInto(path.join(ref, inp), path.join(tmp, inp));
    process.env.HYPHOS_CORPUS = tmp;
    const savedStdout = process.stdout.write.bind(process.stdout);
    // Silence the stage's own aggregate stdout during the parity run.
    (process.stdout as unknown as { write: () => boolean }).write = () => true;
    let rc = 0;
    try {
      rc = st.run();
    } finally {
      (process.stdout as unknown as { write: typeof savedStdout }).write =
        savedStdout;
    }
    if (rc !== 0) {
      process.stdout.write(`  run exited ${rc}\n`);
      allOk = false;
    }
    const outs = [...st.jsonlOutputs];
    if (st.globOutputs) {
      const seen = new Set(outs);
      for (const dir of [ref, tmp]) {
        for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
          if (
            f.startsWith(st.globOutputs) &&
            f.endsWith(".jsonl") &&
            !seen.has(f)
          ) {
            seen.add(f);
            outs.push(f);
          }
        }
      }
    }
    for (const out of outs) {
      const ok = reportDiffs(
        out,
        diffJsonl(path.join(tmp, out), path.join(ref, out)),
      );
      allOk = allOk && ok;
    }
    for (const out of st.fileOutputs ?? []) {
      const a = fs.existsSync(path.join(tmp, out))
        ? fs.readFileSync(path.join(tmp, out), "utf8")
        : "<missing>";
      const b = fs.existsSync(path.join(ref, out))
        ? fs.readFileSync(path.join(ref, out), "utf8")
        : "<missing>";
      const ok = a === b;
      process.stdout.write(
        `  ${out}: ${ok ? "PASS (byte-identical)" : "FAIL (differs)"}\n`,
      );
      allOk = allOk && ok;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.stdout.write(`\nstages parity: ${allOk ? "ALL PASS" : "FAIL"}\n`);
  return allOk ? 0 : 1;
}

process.exit(main());
