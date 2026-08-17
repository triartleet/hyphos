/**
 * Stage 0 — ingest chat exports (Meta/Instagram JSON) as corpus material.
 *
 * Reads `corpus/inbox/*.zip` archives holding Meta-style message threads
 * (`.../inbox/<thread>/message_*.json` with `participants` and `messages`
 * carrying `sender_name`, `timestamp_ms`, `content`), plus bare
 * `message_*.json` files dropped directly into the inbox.
 *
 * Authorship is structural: the owner is the one participant present across
 * (nearly) all threads — DMs always include you. Override with CHAT_OWNER_NAME
 * when the heuristic is not enough. Only the owner's messages are ever kept.
 *
 * Two Meta quirks are handled:
 * - The mojibake: Meta writes UTF-8 bytes escaped as latin-1, so Greek (and
 *   emoji) arrive double-encoded. Undone per string via the shared `demojibake`,
 *   which reproduces Python's decode-with-fallback exactly.
 * - Reactions/system rows have no `content` — skipped.
 *
 * Messages are language-tagged per chunk (`splitByLang`): English feeds the
 * voice corpus; Greek and greeklish stay rhythm-signal. Writes
 * `corpus/chat-<source>.jsonl`. Stdout reports aggregates only — never names or
 * message content (privacy invariant).
 */
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { Counter } from "../lib/counter.js";
import { demojibake, whitespaceSplit } from "../lib/text.js";
import { splitByLang, type Lang } from "../lib/lang.js";
import { corpusDir } from "../lib/paths.js";

// `re.compile(r"https?://\S+")` — a run of non-whitespace after the scheme.
const URL_RE = /https?:\/\/\S+/gu;
// `re.search(r"(inbox|messages)/.+/message_\d+\.json$")` over each zip entry name.
const ENTRY_RE = /(inbox|messages)\/.+\/message_\d+\.json$/;
// `INBOX.glob("message_*.json")` — bare thread files dropped directly in inbox.
const BARE_FILE_RE = /^message_.*\.json$/;

// Export archives arrive date-and-hash-stamped (facebook-<user>-<date>-<id>); the
// platform is the stable identity, so a future export refreshes the same corpus
// file and profile bucket instead of spawning a new date-stamped one.
const PLATFORMS = [
  "facebook",
  "instagram",
  "messenger",
  "whatsapp",
  "telegram",
] as const;

function sourceName(stem: string): string {
  const low = stem.toLowerCase();
  for (const p of PLATFORMS) {
    if (low.startsWith(p)) return p;
  }
  return stem;
}

/** `Path(name).stem` — the filename with its final suffix removed. */
function zipStem(name: string): string {
  const ext = path.extname(name);
  return ext ? name.slice(0, name.length - ext.length) : name;
}

type ThreadEntry = [string, Record<string, unknown>];

/**
 * Yield `[source, thread]` for every Meta message file found, in a fixed
 * order: all `*.zip` archives first (sorted by name), then bare `message_*.json`
 * files (sorted). Within a zip, entries are visited in stored (central-directory)
 * order to match Python's `zf.namelist()` — adm-zip only sorts on write, and
 * `noSort` keeps that guarantee explicit.
 *
 * The archive open is deliberately UNGUARDED: a corrupt or
 * non-zip `*.zip` file raises and aborts the run rather than being silently
 * skipped. Only the per-entry read + JSON parse is guarded (bad entry → skip).
 */
function iterThreads(inbox: string): ThreadEntry[] {
  const out: ThreadEntry[] = [];
  // `Path.glob` on a missing directory yields nothing (no error).
  if (!fs.existsSync(inbox)) return out;
  const names = fs.readdirSync(inbox);

  const zips = names.filter((n) => n.endsWith(".zip")).sort();
  for (const zname of zips) {
    const zip = new AdmZip(path.join(inbox, zname), { noSort: true });
    const matching = zip.getEntries().filter((e) => ENTRY_RE.test(e.entryName));
    if (matching.length === 0) continue;
    const src = sourceName(zipStem(zname));
    for (const e of matching) {
      try {
        out.push([src, JSON.parse(e.getData().toString("utf8"))]);
      } catch {
        continue;
      }
    }
  }

  const bare = names.filter((n) => BARE_FILE_RE.test(n)).sort();
  for (const fname of bare) {
    try {
      out.push([
        "chat",
        JSON.parse(fs.readFileSync(path.join(inbox, fname), "utf8")),
      ]);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Serialize one JSONL record in the canonical format:
 *   `json.dumps({...}, ensure_ascii=False)` semantics.
 *
 * FORMAT NOTE: the corpus line format follows `json.dumps` with neither
 * `indent` nor `separators` — the defaults `(", ", ": ")`, a SPACE after every
 * comma and colon. A bare `JSON.stringify(obj)` emits none of those spaces, so
 * the line is assembled with the same
 * separators and the same key order (ts, source, lang, words, text). Each value
 * still goes through `JSON.stringify`, whose string escaping matches
 * `json.dumps(ensure_ascii=False)` for realistic text (short control-char forms
 * like \n/\t, literal non-ASCII, escaped `"` and `\`). Numbers/`null` likewise
 * render identically for integer timestamps and word counts.
 */
function jsonlLine(
  ts: unknown,
  source: string,
  lang: string,
  words: number,
  text: string,
): string {
  const tsJson = JSON.stringify(ts ?? null); // undefined/None → null
  return (
    `{"ts": ${tsJson}, "source": ${JSON.stringify(source)}, ` +
    `"lang": ${JSON.stringify(lang)}, "words": ${words}, ` +
    `"text": ${JSON.stringify(text)}}`
  );
}

export function runIngestChat(argv: string[]): number {
  void argv; // accepted for CLI uniformity; the stage takes no arguments.

  const corpus = corpusDir();
  const inbox = path.join(corpus, "inbox");
  const threads = iterThreads(inbox);
  if (threads.length === 0) {
    process.stdout.write(
      "no chat exports found in corpus/inbox/ — nothing to do\n",
    );
    return 0;
  }

  // Owner detection: the sender appearing in the most distinct threads. Insertion
  // order into the counter decides the (rare) count tie, matching Counter.
  const presence = new Counter<string>();
  for (const [, t] of threads) {
    const messages = (t["messages"] as unknown[] | undefined) ?? [];
    const senders = new Set<string>();
    for (const mu of messages) {
      const m = mu as Record<string, unknown>;
      const sn = m["sender_name"];
      if (sn) senders.add(demojibake(sn as string));
    }
    for (const s of senders) presence.add(s);
  }
  const owner =
    process.env.CHAT_OWNER_NAME ||
    (presence.size ? presence.mostCommon(1)[0]![0] : "");
  process.stdout.write(
    `owner detected: present in ${presence.get(owner)}/${threads.length} ` +
      `threads (override with CHAT_OWNER_NAME)\n`,
  );

  // One open file handle per source, created (and truncated) the first time a
  // thread of that source is seen — so a source that contributes no kept
  // messages still leaves an empty chat-<source>.jsonl.
  const fds = new Map<string, number>();
  let kept = 0;
  const wordsByLang = new Map<Lang, number>();
  let droppedOthers = 0;

  for (const [source, t] of threads) {
    let fd = fds.get(source);
    if (fd === undefined) {
      fd = fs.openSync(path.join(corpus, `chat-${source}.jsonl`), "w");
      fds.set(source, fd);
    }
    const messages = (t["messages"] as unknown[] | undefined) ?? [];
    for (const mu of messages) {
      const m = mu as Record<string, unknown>;
      if (
        demojibake((m["sender_name"] as string | null | undefined) ?? "") !==
        owner
      ) {
        droppedOthers++;
        continue;
      }
      let text = demojibake(
        ((m["content"] as string | null | undefined) ?? "") || "",
      ).trim();
      text = text.replace(URL_RE, " ").trim();
      if (whitespaceSplit(text).length < 3) continue;
      for (const [lang, chunk] of splitByLang(text)) {
        const words = whitespaceSplit(chunk).length;
        fs.writeSync(
          fd,
          jsonlLine(m["timestamp_ms"], `chat:${source}`, lang, words, chunk) +
            "\n",
        );
        kept++;
        wordsByLang.set(lang, (wordsByLang.get(lang) ?? 0) + words);
      }
    }
  }

  for (const fd of fds.values()) fs.closeSync(fd);

  process.stdout.write(
    `kept: ${kept} messages (owner only; ${droppedOthers} others dropped)\n`,
  );
  // sorted(words_by_lang.items()) — by language tag, in code-point order.
  const langs = [...wordsByLang.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const lang of langs) {
    process.stdout.write(`  ${lang}: ${wordsByLang.get(lang)} words\n`);
  }
  return 0;
}
