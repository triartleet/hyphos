#!/usr/bin/env python3
"""Stage 0b — curate the raw corpus down to genuinely typed text.

Evidence behind the rules (measured on a real corpus, 2026-08-13): messages over
1,000 words were 100% machine-marked or pasted material; 401–1,000 words were
~93% marked; 51–150 words were ~85% clean typed prose. Nobody types 1,500-word
prompts — long text in a chat corpus is almost always pasted from elsewhere, and
pasted text is not the user's voice.

Pipeline: strip fenced code blocks, log-like lines, and lines carrying very long
tokens (paths, hashes, URLs); recount; keep messages that are 1–400 words after
stripping; quarantine the rest for a later, smarter salvage pass.

Reads corpus/raw-sessions.jsonl. Writes corpus/curated.jsonl,
corpus/quarantine.jsonl, corpus/stats-curated.md. Stdout is aggregate-only.
"""
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CORPUS = REPO / "corpus"

FENCE_RE = re.compile(r"```.*?```", re.S)
IMAGE_RE = re.compile(r"\[Image:[^\]]*\]")
LONG_TOKEN_RE = re.compile(r"\S{40,}")
LOG_LINE_RE = re.compile(
    r"^\s*(at |Error|error:|Traceback|\$ |> |\| |#|//|\d+[:.]\d|\d{1,4}[/-]\d{1,2}[/-]\d{1,4})")
MAX_TYPED_WORDS = 400


def strip_machine_text(text: str) -> str:
    text = FENCE_RE.sub(" ", text)
    text = IMAGE_RE.sub(" ", text)
    kept = []
    for line in text.splitlines():
        if LOG_LINE_RE.match(line):
            continue
        if LONG_TOKEN_RE.search(line):
            continue
        kept.append(line)
    return re.sub(r"[ \t]+", " ", "\n".join(kept)).strip()


def main():
    src = CORPUS / "raw-sessions.jsonl"
    if not src.is_file():
        print(f"missing {src} — run extract_corpus.py first", file=sys.stderr)
        return 1
    curated_path = CORPUS / "curated.jsonl"
    quarantine_path = CORPUS / "quarantine.jsonl"
    kept = kept_words = quarantined = q_words = dropped_empty = 0

    with curated_path.open("w") as cur, quarantine_path.open("w") as quar:
        for line in src.open():
            o = json.loads(line)
            stripped = strip_machine_text(o["text"])
            words = len(stripped.split())
            if words == 0:
                dropped_empty += 1
                continue
            rec = {**o, "text": stripped, "words": words, "raw_words": o["words"]}
            if words <= MAX_TYPED_WORDS:
                cur.write(json.dumps(rec, ensure_ascii=False) + "\n")
                kept += 1
                kept_words += words
            else:
                quar.write(json.dumps(rec, ensure_ascii=False) + "\n")
                quarantined += 1
                q_words += words

    stats = CORPUS / "stats-curated.md"
    stats.write_text(
        "# Curated corpus stats (local-only)\n\n"
        f"Kept: {kept} messages, {kept_words} words (typed voice)\n"
        f"Quarantined (>{MAX_TYPED_WORDS}w post-strip): {quarantined} messages, "
        f"{q_words} words\n"
        f"Dropped (empty after stripping): {dropped_empty}\n"
    )
    print(f"kept: {kept} messages, {kept_words} words")
    print(f"quarantined: {quarantined} messages ({q_words} words)")
    print(f"dropped empty after strip: {dropped_empty}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
