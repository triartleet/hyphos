/**
 * Stage 0 — extract your own typed messages from Claude Code transcripts.
 *
 * Reads a transcript root and keeps only human-typed text: entries of type
 * "user" that are not sidechains, text blocks only. Machine text is dropped —
 * tool results, command wrappers, caveats, system reminders, paste placeholders
 * (pasted text is not your writing), bare slash commands, and the bare "+"
 * continue marker. Exact duplicates are counted once.
 *
 * The transcript root defaults to `<config dir>/projects`, where the config dir
 * is the CLAUDE_CONFIG_DIR environment variable if set, otherwise `~/.claude`.
 * A directory passed as the first positional argument overrides the default.
 *
 * Writes `<corpus>/raw-sessions.jsonl` and `<corpus>/stats.md` (both intended to
 * be gitignored, local-only). Stdout prints AGGREGATES ONLY — counts and a date
 * range, never project names or message text — so it is safe to quote anywhere.
 *
 * Faithful port of the reference `extract_corpus.py`. The transcript JSONL is a
 * scraped, undocumented format produced by another tool; the field access below
 * mirrors the reference exactly rather than trying to normalize or "improve" it.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Counter } from "../lib/counter.js";
import { whitespaceSplit } from "../lib/text.js";
import { corpusDir } from "../lib/paths.js";

// Claude Code's placeholder for elided pasted text, e.g. "[Pasted text #3 +42 lines]".
// Global flag so every occurrence in a message is removed (mirrors re.sub).
const PASTE_RE = /\[Pasted text #\d+ \+\d+ lines\]/g;

/**
 * Reproduce `pathlib.Path.expanduser`: a leading "~" (alone, or immediately
 * before a path separator) expands to the current user's home directory.
 * Anything else is returned unchanged — including a "~otheruser" form, which is
 * not resolved here (it does not arise for the config dir or the CLI argument in
 * practice) and a path with no leading tilde.
 */
function expanduser(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~" + path.sep)) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Resolve the transcript root, mirroring the reference `transcript_root(argv)`:
 *   - a positional argument, if present, wins (with "~" expansion);
 *   - else the base is CLAUDE_CONFIG_DIR (when set) or `<home>/.claude`, and the
 *     root is `<base>/projects`.
 *
 * `argv` mirrors the reference's `sys.argv`: element 0 is the program/command
 * name and element 1 is the optional transcript directory, so `argv.length > 1`
 * selects it. An empty CLAUDE_CONFIG_DIR is treated as unset (matching a falsy
 * environment lookup).
 */
function transcriptRoot(argv: string[]): string {
  if (argv.length > 1) return expanduser(argv[1]!);
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  const base = configDir ? expanduser(configDir) : path.join(os.homedir(), ".claude");
  return path.join(base, "projects");
}

/**
 * Transcript directories are path-munged, e.g. "-Users-...-projects-myrepo".
 * Keep the segment after the last "-projects-" so the readable repo name is used
 * as the project label; otherwise use the directory name as-is.
 */
function projectName(dir: string): string {
  const name = path.basename(dir);
  if (name.includes("-projects-")) {
    const parts = name.split("-projects-");
    return parts[parts.length - 1]!;
  }
  return name;
}

/** True if `p` is (or resolves through a symlink to) a directory. */
function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Code-unit string comparison, matching the reference `sorted()` over ASCII names. */
function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Equivalent of `Path.glob("*.jsonl")`: every entry whose name ends in ".jsonl"
 * — files, directories, and dotfiles alike — sorted by name. A directory that
 * matches is returned too; it later fails to open and is skipped, exactly as in
 * the reference (which relied on the same open-and-skip behavior).
 */
function globJsonl(dir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".jsonl"))
    .sort(byName)
    .map((n) => path.join(dir, n));
}

/**
 * Yield [projectDir, sessionFile] pairs. Top-level project directories are
 * scanned directly; the special ".archive" directory is descended one extra
 * level (its sub-directories are treated as project directories). Non-directory
 * entries at the top level are skipped.
 */
function* iterSessionFiles(root: string): Generator<[string, string]> {
  if (!isDir(root)) return;
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }
  for (const name of entries.sort(byName)) {
    const projDir = path.join(root, name);
    if (!isDir(projDir)) continue;
    if (name === ".archive") {
      let archEntries: string[];
      try {
        archEntries = fs.readdirSync(projDir);
      } catch {
        continue;
      }
      for (const archName of archEntries.sort(byName)) {
        const arch = path.join(projDir, archName);
        if (!isDir(arch)) continue;
        for (const f of globJsonl(arch)) yield [arch, f];
      }
      continue;
    }
    for (const f of globJsonl(projDir)) yield [projDir, f];
  }
}

/**
 * Yield the text of each usable content block. `content` is either a bare string
 * (yielded as-is) or a list of blocks, of which only `{ "type": "text" }` blocks
 * contribute their `text`. A missing `text` field yields "" (matching the
 * reference's `block.get("text", "")` default). A present-but-non-string `text`
 * would make the reference raise later; here it is treated as empty — this does
 * not occur in real transcripts.
 */
function* textBlocks(content: unknown): Generator<string> {
  if (typeof content === "string") {
    yield content;
    return;
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        !Array.isArray(block) &&
        (block as Record<string, unknown>).type === "text"
      ) {
        const t = (block as Record<string, unknown>).text;
        yield typeof t === "string" ? t : "";
      }
    }
  }
}

/**
 * Decide whether a raw block of text is human voice worth keeping, returning the
 * cleaned text or null to drop it. Paste placeholders are stripped and the result
 * trimmed; then empties, the bare "+" continue marker, slash commands, caveats,
 * interruption notices, and angle-bracket command wrappers / system reminders
 * are all dropped.
 */
function keep(raw: string): string | null {
  const text = raw.replace(PASTE_RE, "").trim();
  if (!text || text === "+") return null;
  if (text.startsWith("/")) return null; // slash commands are operations, not voice
  if (text.startsWith("Caveat:") || text.startsWith("[Request interrupted")) return null;
  if (text.startsWith("<") && text.includes(">")) return null; // command wrappers, reminders
  return text;
}

/** A plain (non-array) object, or undefined for anything else. */
function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** The file name with its final extension removed — matches `pathlib.Path.stem`. */
function stem(file: string): string {
  return path.basename(file, path.extname(file));
}

/**
 * Serialize a flat object exactly like `json.dumps(obj, ensure_ascii=False)` with
 * its default separators — ", " between items and ": " between key and value
 * (the default when no indent is given). JSON.stringify handles value escaping
 * (control characters, quotes) and leaves non-ASCII literal, matching
 * ensure_ascii=False; the manual separators reproduce the reference's spacing so
 * the JSONL is byte-for-byte identical. Values must be JSON scalars, which every
 * record field is.
 */
function dumpsFlat(obj: Record<string, unknown>): string {
  const parts = Object.entries(obj).map(
    ([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`,
  );
  return "{" + parts.join(", ") + "}";
}

/**
 * Extract the corpus. Returns a process exit code: 0 on success, 1 if the
 * transcript root does not exist. See the module docstring for argv semantics.
 */
export function runExtract(argv: string[]): number {
  const root = transcriptRoot(argv);
  if (!isDir(root)) {
    process.stderr.write(`transcript root not found: ${root}\n`);
    return 1;
  }
  const outDir = corpusDir();
  fs.mkdirSync(outDir, { recursive: true });

  const seen = new Set<string>();
  const perProject = new Counter<string>();
  const perProjectWords = new Counter<string>();
  const hist = new Counter<string>();
  let dupes = 0;
  let firstTs: string | null = null;
  let lastTs: string | null = null;
  const outLines: string[] = [];

  for (const [projDir, f] of iterSessionFiles(root)) {
    const proj = projectName(projDir);
    let content: string;
    try {
      // Node's utf8 decoder replaces malformed byte sequences with U+FFFD and
      // never throws, matching the reference's errors="replace". Reading a
      // directory (a matched *.jsonl dir) throws EISDIR here and is skipped,
      // matching the reference's open-raises-OSError path.
      content = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const sessionStem = stem(f);
    // Universal-newline split (\r\n, \r, or \n), matching text-mode iteration.
    for (const line of content.split(/\r\n|\r|\n/)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const obj = asRecord(parsed);
      if (!obj) continue; // non-object JSON line: nothing to read; skip it
      if (obj["type"] !== "user" || obj["isSidechain"]) continue;
      const msg = asRecord(obj["message"]) ?? {};
      for (const raw of textBlocks(msg["content"])) {
        const text = keep(raw);
        if (text === null) continue;
        if (seen.has(text)) {
          dupes += 1;
          continue;
        }
        seen.add(text);
        const tsRaw = obj["timestamp"];
        const ts = tsRaw === undefined ? null : (tsRaw as string | null);
        if (ts) {
          // Keep the lexicographically smallest/largest timestamp seen. ISO 8601
          // strings compare chronologically. The typed copies prevent the flow
          // analysis from collapsing the still-null accumulators to `never`.
          const f: string | null = firstTs;
          const l: string | null = lastTs;
          if (f === null || ts < f) firstTs = ts;
          if (l === null || ts > l) lastTs = ts;
        }
        const wordCount = whitespaceSplit(text).length;
        perProject.add(proj, 1);
        perProjectWords.add(proj, wordCount);
        const bucket =
          wordCount <= 5
            ? "1-5"
            : wordCount <= 20
              ? "6-20"
              : wordCount <= 50
                ? "21-50"
                : "51+";
        hist.add(bucket, 1);
        outLines.push(
          dumpsFlat({
            ts,
            project: proj,
            session: sessionStem,
            words: wordCount,
            text,
          }) + "\n",
        );
      }
    }
  }

  let total = 0;
  for (const [, n] of perProject.entries()) total += n;
  let totalWords = 0;
  for (const [, n] of perProjectWords.entries()) totalWords += n;

  const outPath = path.join(outDir, "raw-sessions.jsonl");
  fs.writeFileSync(outPath, outLines.join(""));

  const statsPath = path.join(outDir, "stats.md");
  const rangeFirst = firstTs === null ? "None" : firstTs;
  const rangeLast = lastTs === null ? "None" : lastTs;
  let statsOut = "";
  statsOut += "# Corpus stats (local-only — contains project names)\n\n";
  statsOut += `Messages: ${total}  ·  Words: ${totalWords}  ·  Duplicates skipped: ${dupes}\n`;
  statsOut += `Range: ${rangeFirst} → ${rangeLast}\n\n`;
  statsOut += "| project | messages | words |\n|---|---|---|\n";
  for (const [proj, n] of perProject.mostCommon()) {
    statsOut += `| ${proj} | ${n} | ${perProjectWords.get(proj)} |\n`;
  }
  fs.writeFileSync(statsPath, statsOut);

  // Stdout: aggregates only — deliberately no project names.
  const f10 = (firstTs ? String(firstTs) : "?").slice(0, 10);
  const l10 = (lastTs ? String(lastTs) : "?").slice(0, 10);
  const lines = [
    `messages: ${total}`,
    `words: ${totalWords}`,
    `duplicates skipped: ${dupes}`,
    `range: ${f10} -> ${l10}`,
    `projects covered: ${perProject.size}`,
  ];
  for (const bucket of ["1-5", "6-20", "21-50", "51+"]) {
    lines.push(`length ${bucket} words: ${hist.get(bucket)}`);
  }
  lines.push(`full table: ${statsPath}`);
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}
