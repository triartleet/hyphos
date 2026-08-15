/**
 * Blind self-test: shuffle real corpus snippets with lines from a generated
 * file, ask the user to mark which are theirs, and report the discrimination
 * rate. 50% means the rewrite is indistinguishable from the user; 100% means it
 * never fools them.
 *
 * This is interactive (reads stdin) and uses random sampling, so it is not
 * covered by the parity harness. The sampling/shuffle use JavaScript's PRNG,
 * matching the reference's non-determinism (Python seeds `random` from the OS).
 */
import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline/promises";
import { pyRound } from "../lib/num.js";
import { whitespaceSplit } from "../lib/text.js";
import { corpusDir } from "../lib/paths.js";

// random.sample(population, k): k distinct elements in random order.
function sample<T>(population: T[], k: number): T[] {
  const pool = [...population];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, k);
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

/** Run the interactive blind test. Returns an exit code. */
export async function blind(register: string, generatedFile: string, n: number): Promise<number> {
  const tagged = path.join(corpusDir(), "tagged.jsonl");
  const real: string[] = [];
  for (const line of fs.readFileSync(tagged, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const o = JSON.parse(line) as { register: string; words: number; text: string };
    if (o.register === register && o.words >= 25 && o.words <= 120) real.push(o.text);
  }
  const gen = fs
    .readFileSync(generatedFile, "utf8")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => whitespaceSplit(p).length >= 15);

  n = Math.min(n, real.length, gen.length);
  const items: [string, boolean][] = [
    ...sample(real, n).map((t): [string, boolean] => [t, true]),
    ...sample(gen, n).map((t): [string, boolean] => [t, false]),
  ];
  shuffle(items);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let correct = 0;
  process.stdout.write(`${2 * n} snippets. Answer y if YOU wrote it, n if not.\n\n`);
  let i = 0;
  for (const [text, isReal] of items) {
    i++;
    process.stdout.write(`--- ${i}/${2 * n} ---\n${text.slice(0, 400)}\n\n`);
    const ans = (await rl.question("yours? [y/n] ")).trim().toLowerCase();
    if ((ans === "y") === isReal) correct++;
  }
  rl.close();

  const rate = correct / (2 * n);
  const pct = `${pyRound(rate * 100, 0)}%`;
  process.stdout.write(`\ndiscrimination: ${correct}/${2 * n} = ${pct}\n`);
  process.stdout.write(
    "50% = the rewrite is indistinguishable from you; 100% = it fools you never.\n",
  );
  return 0;
}

/** `blind` subcommand entry. */
export async function runBlind(opts: {
  register: string;
  generated: string;
  n: number;
}): Promise<number> {
  return blind(opts.register, opts.generated, opts.n);
}
