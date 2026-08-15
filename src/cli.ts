/**
 * hyphos command-line entry — rewrite AI drafts in your own voice, with receipts.
 *
 * This is the central wiring file. It maps subcommands to the run functions that
 * live in ./commands (the model-free and model-driven CLI features ported from
 * the reference Python) and ./stages (the corpus pipeline stages). The ported
 * native commands (rewrite, enforce, score, blind, serve, rules) mirror the
 * reference argparse setup — same flags, defaults, and choices. The pipeline
 * stages receive their raw argument list unchanged so each can parse its own
 * options, matching the convention `runX(argv): number`.
 *
 * Backends (D-005): "claude" drives the local claude CLI (your subscription);
 * "api" uses ANTHROPIC_API_KEY; "auto" prefers claude.
 */
import { Command, Option } from "commander";
import { runRules, runEnforce } from "./commands/rules.js";
import { runScore } from "./commands/score.js";
import { runRewrite } from "./commands/rewrite.js";
import { runBlind } from "./commands/blind.js";
import { runServe } from "./commands/serve.js";
import { SysExit } from "./commands/sysexit.js";
import { runExtract } from "./stages/extract.js";
import { runCurate } from "./stages/curate.js";
import { runTag } from "./stages/tag.js";
import { runSalvage } from "./stages/salvage.js";
import { runIngestChat } from "./stages/ingestChat.js";
import { runIngestEmail } from "./stages/ingestEmail.js";
import { runFingerprint } from "./stages/fingerprint.js";

const program = new Command();
program
  .name("hyphos")
  .description("rewrite AI drafts in your own voice, with receipts");

// ---- ported native commands (mirror the reference argparse) ----

program
  .command("rewrite")
  .description(
    "model pass guided by your profiles, then the deterministic enforcement pass",
  )
  .argument("<file>")
  .option("--register <register>", "voice register", "editorial")
  .addOption(
    new Option("--backend <backend>", "model backend")
      .choices(["auto", "claude", "api"])
      .default("auto"),
  )
  .addOption(
    new Option("--typos <typos>", "re-introduce your real typos")
      .choices(["none", "natural"])
      .default("none"),
  )
  .action(
    async (
      file: string,
      opts: { register: string; backend: string; typos: string },
    ) => {
      process.exitCode = await runRewrite(file, opts);
    },
  );

program
  .command("enforce")
  .description("deterministic de-model-isming, no model call")
  .argument("<file>")
  .option("--register <register>", "voice register", "editorial")
  .action((file: string, opts: { register: string }) => {
    process.exitCode = runEnforce(file, opts);
  });

program
  .command("score")
  .description("model-free fidelity score against a register's fingerprint")
  .argument("<file>")
  .option("--register <register>", "voice register", "editorial")
  .option("--judge", "add the model-judged half (slower, backend call)")
  .action(async (file: string, opts: { register: string; judge?: boolean }) => {
    process.exitCode = await runScore(file, opts);
  });

program
  .command("blind")
  .description("blind self-test: can you tell your writing from the rewrite?")
  .requiredOption("--generated <file>", "file of generated snippets")
  .option("--register <register>", "voice register", "technical-instruction")
  .option("-n <n>", "snippets per side", (v: string) => parseInt(v, 10), 5)
  .action(async (opts: { register: string; generated: string; n: number }) => {
    process.exitCode = await runBlind(opts);
  });

program
  .command("serve")
  .description("serve the local web UI (127.0.0.1 only)")
  .option("--port <port>", "port", (v: string) => parseInt(v, 10), 4177)
  .action((opts: { port: number }) => {
    runServe(opts);
  });

program
  .command("rules")
  .description("list the enforcement rules, or run their self-test")
  .option("--test", "run the rule self-test")
  .action((opts: { test?: boolean }) => {
    process.exitCode = runRules(opts);
  });

// ---- corpus pipeline stages ----
// Each stage parses its own arguments, so forward the raw tokens that follow the
// subcommand name untouched. `allowUnknownOption` keeps commander from rejecting
// stage-specific flags before the action runs.
function stage(name: string, fn: (argv: string[]) => number): void {
  program
    .command(name)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(() => {
      const idx = process.argv.indexOf(name, 2);
      const argv = idx >= 0 ? process.argv.slice(idx + 1) : [];
      process.exitCode = fn(argv);
    });
}

stage("extract", runExtract);
stage("curate", runCurate);
stage("tag", runTag);
stage("ingest-chat", runIngestChat);
stage("ingest-email", runIngestEmail);
stage("salvage", runSalvage);

program
  .command("fingerprint")
  .description("build stylometric fingerprints per register bucket")
  .allowExcessArguments(true)
  .action(() => {
    process.exitCode = runFingerprint();
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (e) {
    // Reproduce Python `sys.exit("message")`: print to stderr and exit 1.
    if (e instanceof SysExit) {
      process.stderr.write(e.message + "\n");
      process.exit(1);
    }
    throw e;
  }
}

void main();
