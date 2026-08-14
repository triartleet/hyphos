#!/usr/bin/env python3
"""Stage 0c — salvage typed fragments from quarantined messages.

Quarantined messages (>400 words post-strip) are mostly pasted material, but
the paste usually rides inside a typed wrapper: an instruction at the top,
sometimes a short typed close. This pass recovers ONLY high-confidence typed
fragments — precision over recall, since one pasted paragraph pollutes a
voice profile more than fifty missed typed ones improve it.

Rules: take the leading 1–2 paragraphs when each is <=120 words and
instruction-flavored; take the final paragraph when <=60 words and
instruction-flavored; drop anything that looks like correspondence or
document structure; dedupe against the curated corpus.

Writes corpus/salvaged.jsonl (register-tagged via tag_registers.scores).
Stdout aggregates only.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tag_registers import scores  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
CORPUS = REPO / "corpus"

INSTRUCTION_RE = re.compile(
    r"\b(i want|i need|i would like|can you|could you|let'?s|we (should|want|"
    r"need)|please|make sure|instead of|proceed|continue|check|fix|add|create|"
    r"update|run|investigate|consider|before you|now that)\b", re.I)
CORRESPONDENCE_RE = re.compile(
    r"^(dear |hi |hello |greetings|kind regards|best regards|thanks,|regards,)", re.I)
DOCLIKE_RE = re.compile(r"^(#{1,6} |\d+\.\s|\* |- |\||>)")


def typed_flavored(par: str, max_words: int) -> bool:
    words = par.split()
    if not (4 <= len(words) <= max_words):
        return False
    if CORRESPONDENCE_RE.match(par.strip()) or DOCLIKE_RE.match(par.strip()):
        return False
    return bool(INSTRUCTION_RE.search(par))


def salvage(text: str) -> str | None:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(paras) < 2:
        return None
    kept = []
    for p in paras[:2]:
        if typed_flavored(p, 120):
            kept.append(p)
        else:
            break
    if len(paras) > len(kept) and typed_flavored(paras[-1], 60):
        kept.append(paras[-1])
    out = "\n\n".join(kept)
    return out if len(out.split()) >= 8 else None


def main():
    q = CORPUS / "quarantine.jsonl"
    if not q.is_file():
        print("no quarantine.jsonl — nothing to salvage", file=sys.stderr)
        return 1
    seen = set()
    cur = CORPUS / "curated.jsonl"
    if cur.is_file():
        for line in cur.open():
            seen.add(json.loads(line)["text"])
    out_path = CORPUS / "salvaged.jsonl"
    kept = kept_words = 0
    with out_path.open("w") as out:
        for line in q.open():
            o = json.loads(line)
            frag = salvage(o["text"])
            if not frag or frag in seen:
                continue
            seen.add(frag)
            s = scores(frag)
            register = max(s, key=s.get) if max(s.values()) > 0 else "technical"
            out.write(json.dumps({
                "ts": o.get("ts"), "project": o.get("project"),
                "source": "salvage", "words": len(frag.split()),
                "register": ("technical-instruction" if register == "technical"
                             else register),
                "text": frag,
            }, ensure_ascii=False) + "\n")
            kept += 1
            kept_words += len(frag.split())
    print(f"salvaged: {kept} fragments, {kept_words} words "
          f"(from 268-message quarantine)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
