#!/usr/bin/env python3
"""Stage 1b — compute stylometric fingerprints per register bucket.

Model-free measurements of how the user actually writes, per bucket:
sessions' three registers (from corpus/tagged.jsonl) plus English sent mail
(from corpus/email-sent.jsonl), with the email bucket additionally split into
pre-2023 ("pre-AI era", guaranteed-pure voice) and 2023+ sub-blocks.

Writes profiles/<bucket>/fingerprint.json. Stdout aggregates only.
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path
from statistics import mean, median

REPO = Path(__file__).resolve().parent.parent
CORPUS = REPO / "corpus"
PROFILES = REPO / "profiles"

PUNCT = [".", ",", ";", ":", "!", "?", "—", "–", "-", "(", ")", '"', "'", "…"]
CONNECTORS = [
    "so", "thus", "also", "then", "but", "though", "however", "actually",
    "basically", "anyway", "instead", "meaning", "plus", "regarding", "since",
    "therefore", "besides", "otherwise", "still", "yet",
]
EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF☀-➿⬀-⯿]")
CONTRACTION_RE = re.compile(r"\b\w+'(s|t|re|ve|ll|d|m)\b", re.I)
ELLIPSIS_RE = re.compile(r"\.\.\.|…")


def sentences_of(text):
    return [s.strip() for s in re.split(r"[.!?\n]+", text) if s.strip()]


def fingerprint(texts):
    n_msgs = len(texts)
    words_all, sent_lens, msg_lens = [], [], []
    punct = Counter()
    first_words = Counter()
    connectors = Counter()
    lower_starts = caps_words = emoji = contractions = ellipses = 0
    chars = 0
    for t in texts:
        ws = re.findall(r"[\w']+", t)
        words_all.extend(w.lower() for w in ws)
        msg_lens.append(len(ws))
        chars += len(t)
        for s in sentences_of(t):
            sw = re.findall(r"[\w']+", s)
            if not sw:
                continue
            sent_lens.append(len(sw))
            first_words[sw[0].lower()] += 1
            if s[:1].islower():
                lower_starts += 1
        for p in PUNCT:
            punct[p] += t.count(p)
        caps_words += sum(1 for w in ws if len(w) > 2 and w.isupper())
        emoji += len(EMOJI_RE.findall(t))
        contractions += len(CONTRACTION_RE.findall(t))
        ellipses += len(ELLIPSIS_RE.findall(t))
        for c in CONNECTORS:
            connectors[c] += sum(1 for w in ws if w.lower() == c)
    total_words = len(words_all) or 1
    total_sents = len(sent_lens) or 1
    per_1k = lambda x: round(x * 1000 / total_words, 2)
    return {
        "messages": n_msgs,
        "words": total_words,
        "sentence_len": {"mean": round(mean(sent_lens), 1) if sent_lens else 0,
                         "p50": median(sent_lens) if sent_lens else 0,
                         "p90": sorted(sent_lens)[int(total_sents * 0.9) - 1]
                         if sent_lens else 0},
        "message_len_p50": median(msg_lens) if msg_lens else 0,
        "punct_per_1k_words": {p: per_1k(c) for p, c in punct.items() if c},
        "lowercase_sentence_start_rate": round(lower_starts / total_sents, 3),
        "allcaps_word_per_1k": per_1k(caps_words),
        "emoji_per_1k": per_1k(emoji),
        "contractions_per_1k": per_1k(contractions),
        "ellipses_per_1k": per_1k(ellipses),
        "avg_word_len": round(sum(len(w) for w in words_all) / total_words, 2),
        "unique_word_ratio": round(len(set(words_all)) / total_words, 3),
        "top_sentence_openers": first_words.most_common(15),
        "connector_use_per_1k": {c: per_1k(k) for c, k in
                                 connectors.most_common(12) if k},
    }


def email_year(ts):
    for tok in ts.split():
        if tok.isdigit() and len(tok) == 4:
            return int(tok)
    return None


def main():
    buckets = {}
    tagged = CORPUS / "tagged.jsonl"
    if tagged.is_file():
        for line in tagged.open():
            o = json.loads(line)
            buckets.setdefault(o["register"], []).append(o["text"])
    mail = CORPUS / "email-sent.jsonl"
    if mail.is_file():
        for line in mail.open():
            o = json.loads(line)
            if o.get("lang") != "en":
                continue
            buckets.setdefault("email-semi-formal", []).append(o["text"])
            y = email_year(o.get("ts", ""))
            if y and y < 2023:
                buckets.setdefault("email-semi-formal-pre2023", []).append(o["text"])
    if not buckets:
        print("no corpus files found", file=sys.stderr)
        return 1
    for name, texts in buckets.items():
        d = PROFILES / name
        d.mkdir(parents=True, exist_ok=True)
        fp = fingerprint(texts)
        (d / "fingerprint.json").write_text(
            json.dumps(fp, ensure_ascii=False, indent=1))
        print(f"{name}: {fp['messages']} msgs, {fp['words']} words, "
              f"sent p50 {fp['sentence_len']['p50']}, "
              f"lowercase-start {fp['lowercase_sentence_start_rate']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
