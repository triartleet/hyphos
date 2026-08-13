#!/usr/bin/env python3
"""Ingest sent e-mail as corpus material.

Reads Google Takeout archives (corpus/inbox/*.zip containing
Takeout/Mail/Sent.mbox) or bare .mbox files dropped in corpus/inbox/. A Sent
mailbox contains only messages the user wrote, so authorship is structural.

Per message: prefer the text/plain part (fall back to stripped HTML), remove
quoted reply chains ("On ... wrote:", lines starting with >), signatures
(after "-- "), long URLs and machine lines; skip forwards/empty bodies. Each
kept message is language-tagged (latin vs greek script ratio) — non-English
text stays rhythm-signal only, per D-004.

Writes corpus/email-sent.jsonl. Stdout aggregates only.
"""
import email
import email.policy
import json
import mailbox
import re
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CORPUS = REPO / "corpus"
INBOX = CORPUS / "inbox"
EXTRACT = INBOX / "extracted"

QUOTE_INTRO_RE = re.compile(
    r"(?im)^\s*(on .{5,80}wrote:|-{3,} ?forwarded message ?-{3,}|"
    r"from:\s.+|sent:\s.+|to:\s.+|subject:\s.+|στις .{5,80}έγραψε:)\s*$")
URL_RE = re.compile(r"https?://\S+")
TAG_RE = re.compile(r"<[^>]+>")


def html_to_text(html: str) -> str:
    html = re.sub(r"(?is)<(style|script).*?</\1>", " ", html)
    html = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", html)
    return TAG_RE.sub(" ", html)


def body_text(msg) -> str:
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    try:
        content = part.get_content()
    except Exception:
        return ""
    if part.get_content_type() == "text/html":
        content = html_to_text(content)
    return content


def clean(text: str) -> str:
    text = text.split("\n-- \n")[0]                # signature delimiter
    lines, done = [], False
    for line in text.splitlines():
        if QUOTE_INTRO_RE.match(line):
            done = True                            # reply chain begins
        if done or line.lstrip().startswith(">"):
            continue
        lines.append(line)
    text = "\n".join(lines)
    text = URL_RE.sub(" ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def lang_of(text: str) -> str:
    greek = len(re.findall(r"[Ͱ-Ͽἀ-῿]", text))
    latin = len(re.findall(r"[a-zA-Z]", text))
    if greek > latin:
        return "el"
    return "en" if latin else "other"


def iter_mboxes():
    for z in sorted(INBOX.glob("*.zip")):
        with zipfile.ZipFile(z) as zf:
            for name in zf.namelist():
                if name.lower().endswith(".mbox") and "sent" in name.lower():
                    EXTRACT.mkdir(parents=True, exist_ok=True)
                    target = EXTRACT / (z.stem + "-" + Path(name).name)
                    if not target.exists():
                        zf.extract(name, EXTRACT / z.stem)
                        (EXTRACT / z.stem / name).rename(target)
                    yield z.stem, target
    for m in sorted(INBOX.glob("*.mbox")):
        yield m.stem, m


def main():
    out_path = CORPUS / "email-sent.jsonl"
    kept = skipped = 0
    words_by_lang = {"en": 0, "el": 0, "other": 0}
    with out_path.open("w") as out:
        for source, path in iter_mboxes():
            mbox = mailbox.mbox(str(path), factory=lambda f: email.message_from_binary_file(
                f, policy=email.policy.default))
            for msg in mbox:
                text = clean(body_text(msg))
                words = len(text.split())
                if words < 5:
                    skipped += 1
                    continue
                lang = lang_of(text)
                rec = {
                    "ts": msg.get("Date", ""),
                    "source": f"email:{source}",
                    "lang": lang,
                    "words": words,
                    "text": text,
                }
                out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                kept += 1
                words_by_lang[lang] = words_by_lang.get(lang, 0) + words
    print(f"kept: {kept} messages, skipped short/empty: {skipped}")
    for lang, w in words_by_lang.items():
        if w:
            print(f"  {lang}: {w} words")
    return 0


if __name__ == "__main__":
    sys.exit(main())
