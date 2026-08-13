#!/usr/bin/env python3
"""Stage 0 — extract your own typed messages from Claude Code transcripts.

Reads a transcript root (default: ~/.claude/projects; CLAUDE_CONFIG_DIR is
honored; or pass a directory as the first argument) and keeps only human-typed
text: user-type, non-sidechain entries, text blocks only. Machine text is
dropped — tool results, command wrappers, caveats, system reminders, paste
placeholders (pasted text is not your writing), bare slash commands, and the
bare "+" continue marker. Exact duplicates are counted once.

Writes corpus/raw-sessions.jsonl and corpus/stats.md (both gitignored,
local-only). Stdout prints aggregates only — no project names — so it is safe
to quote anywhere.
"""
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "corpus"

PASTE_RE = re.compile(r"\[Pasted text #\d+ \+\d+ lines\]")


def transcript_root(argv) -> Path:
    if len(argv) > 1:
        return Path(argv[1]).expanduser()
    config_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    base = Path(config_dir).expanduser() if config_dir else Path.home() / ".claude"
    return base / "projects"


def project_name(d: Path) -> str:
    # Transcript dirs are path-munged ("-Users-...-projects-myrepo" -> "myrepo").
    name = d.name
    return name.split("-projects-")[-1] if "-projects-" in name else name


def iter_session_files(root: Path):
    if not root.is_dir():
        return
    for proj_dir in sorted(root.iterdir()):
        if not proj_dir.is_dir():
            continue
        if proj_dir.name == ".archive":
            for arch in sorted(proj_dir.iterdir()):
                if arch.is_dir():
                    yield from ((arch, f) for f in sorted(arch.glob("*.jsonl")))
            continue
        yield from ((proj_dir, f) for f in sorted(proj_dir.glob("*.jsonl")))


def text_blocks(content):
    if isinstance(content, str):
        yield content
        return
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                yield block.get("text", "")


def keep(text: str) -> str | None:
    text = PASTE_RE.sub("", text).strip()
    if not text or text == "+":
        return None
    if text.startswith("/"):  # slash commands are operations, not voice
        return None
    if text.startswith("Caveat:") or text.startswith("[Request interrupted"):
        return None
    if text.startswith("<") and ">" in text:  # command wrappers, reminders
        return None
    return text


def main():
    root = transcript_root(sys.argv)
    if not root.is_dir():
        print(f"transcript root not found: {root}", file=sys.stderr)
        return 1
    OUT_DIR.mkdir(exist_ok=True)
    seen: set[str] = set()
    per_project: Counter = Counter()
    per_project_words: Counter = Counter()
    hist = Counter()
    dupes = 0
    first_ts, last_ts = None, None
    out_path = OUT_DIR / "raw-sessions.jsonl"

    with out_path.open("w") as out:
        for proj_dir, f in iter_session_files(root):
            proj = project_name(proj_dir)
            try:
                lines = f.open(errors="replace")
            except OSError:
                continue
            with lines:
                for line in lines:
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    if obj.get("type") != "user" or obj.get("isSidechain"):
                        continue
                    msg = obj.get("message") or {}
                    for raw in text_blocks(msg.get("content")):
                        text = keep(raw)
                        if text is None:
                            continue
                        if text in seen:
                            dupes += 1
                            continue
                        seen.add(text)
                        ts = obj.get("timestamp")
                        if ts:
                            first_ts = min(first_ts or ts, ts)
                            last_ts = max(last_ts or ts, ts)
                        words = len(text.split())
                        per_project[proj] += 1
                        per_project_words[proj] += words
                        bucket = ("1-5" if words <= 5 else
                                  "6-20" if words <= 20 else
                                  "21-50" if words <= 50 else "51+")
                        hist[bucket] += 1
                        out.write(json.dumps({
                            "ts": ts, "project": proj, "session": f.stem,
                            "words": words, "text": text,
                        }, ensure_ascii=False) + "\n")

    total = sum(per_project.values())
    total_words = sum(per_project_words.values())
    stats = OUT_DIR / "stats.md"
    with stats.open("w") as s:
        s.write("# Corpus stats (local-only — contains project names)\n\n")
        s.write(f"Messages: {total}  ·  Words: {total_words}  ·  "
                f"Duplicates skipped: {dupes}\n")
        s.write(f"Range: {first_ts} → {last_ts}\n\n")
        s.write("| project | messages | words |\n|---|---|---|\n")
        for proj, n in per_project.most_common():
            s.write(f"| {proj} | {n} | {per_project_words[proj]} |\n")

    # Stdout: aggregates only — deliberately no project names.
    print(f"messages: {total}")
    print(f"words: {total_words}")
    print(f"duplicates skipped: {dupes}")
    print(f"range: {(first_ts or '?')[:10]} -> {(last_ts or '?')[:10]}")
    print(f"projects covered: {len(per_project)}")
    for bucket in ("1-5", "6-20", "21-50", "51+"):
        print(f"length {bucket} words: {hist[bucket]}")
    print(f"full table: {stats}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
