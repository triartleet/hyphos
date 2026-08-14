#!/usr/bin/env python3
"""Ingest chat exports (Meta/Instagram JSON) as corpus material.

Reads corpus/inbox/*.zip archives containing Meta-style message threads
(`.../inbox/<thread>/message_*.json` with `participants` and `messages`
carrying `sender_name`, `timestamp_ms`, `content`), plus bare
`message_*.json` files dropped directly.

Authorship is structural: the owner is the one participant present across
(nearly) all threads — DMs always include you. Override with
CHAT_OWNER_NAME when the heuristic is not enough. Only the owner's messages
are kept, ever.

Two Meta quirks are handled:
- The mojibake: Meta writes UTF-8 bytes escaped as latin-1, so Greek (and
  emoji) arrive double-encoded. Decoded per string, with a plain fallback.
- Reactions/system rows have no `content` — skipped.

Messages are language-tagged per chunk (textlang.split_by_lang): English
feeds the voice corpus; Greek and greeklish stay rhythm-signal (D-004).
Writes corpus/chat-<source>.jsonl. Stdout aggregates only.
"""
import json
import os
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from textlang import split_by_lang  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
CORPUS = REPO / "corpus"
INBOX = CORPUS / "inbox"

URL_RE = re.compile(r"https?://\S+")


def demojibake(s: str) -> str:
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def iter_threads():
    """Yield (source, thread_json) for every Meta message file found."""
    for z in sorted(INBOX.glob("*.zip")):
        with zipfile.ZipFile(z) as zf:
            names = [n for n in zf.namelist()
                     if re.search(r"(inbox|messages)/.+/message_\d+\.json$", n)]
            if not names:
                continue
            for n in names:
                try:
                    yield z.stem, json.loads(zf.read(n))
                except Exception:
                    continue
    for f in sorted(INBOX.glob("message_*.json")):
        try:
            yield "chat", json.loads(f.read_text())
        except Exception:
            continue


def main():
    threads = list(iter_threads())
    if not threads:
        print("no chat exports found in corpus/inbox/ — nothing to do")
        return 0

    # Owner detection: the sender appearing in the most distinct threads.
    presence = Counter()
    for _, t in threads:
        senders = {demojibake(m.get("sender_name", ""))
                   for m in t.get("messages", []) if m.get("sender_name")}
        for s in senders:
            presence[s] += 1
    owner = os.environ.get("CHAT_OWNER_NAME") or (
        presence.most_common(1)[0][0] if presence else "")
    print(f"owner detected: present in {presence.get(owner, 0)}/{len(threads)} "
          f"threads (override with CHAT_OWNER_NAME)")

    outs = {}
    kept = 0
    words_by_lang = {}
    dropped_others = 0
    for source, t in threads:
        out = outs.get(source)
        if out is None:
            out = outs[source] = (CORPUS / f"chat-{source}.jsonl").open("w")
        for m in t.get("messages", []):
            if demojibake(m.get("sender_name", "")) != owner:
                dropped_others += 1
                continue
            text = demojibake(m.get("content", "") or "").strip()
            text = URL_RE.sub(" ", text).strip()
            if len(text.split()) < 3:
                continue
            for lang, chunk in split_by_lang(text):
                words = len(chunk.split())
                out.write(json.dumps({
                    "ts": m.get("timestamp_ms"), "source": f"chat:{source}",
                    "lang": lang, "words": words, "text": chunk,
                }, ensure_ascii=False) + "\n")
                kept += 1
                words_by_lang[lang] = words_by_lang.get(lang, 0) + words
    for out in outs.values():
        out.close()
    print(f"kept: {kept} messages (owner only; {dropped_others} others dropped)")
    for lang, w in sorted(words_by_lang.items()):
        print(f"  {lang}: {w} words")
    return 0


if __name__ == "__main__":
    sys.exit(main())
