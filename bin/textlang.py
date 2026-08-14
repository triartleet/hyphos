#!/usr/bin/env python3
"""Language tagging for corpus ingest — including greeklish.

Greeklish is Greek written in Latin characters by phonetic feel. It defeats
script-based detection (all-Latin) and would poison English vocabulary
profiles if let through, so it gets its own tag. Detection is a function-word
density heuristic: short Greek function words are unavoidable in real Greek
sentences and rare as English words.

Tags: "en", "el" (Greek script), "gr-latn" (greeklish), "other".
Per D-004, both "el" and "gr-latn" contribute rhythm/register signal only —
never wording — and are never transliterated (each mapping layer loses).
"""
import re

GREEK_SCRIPT_RE = re.compile(r"[Ͱ-Ͽἀ-῿]")
LATIN_RE = re.compile(r"[a-zA-Z]")

# Short, high-frequency Greek function words as they are typically romanized.
# Chosen to be rare as English tokens ("na", "re" collide mildly; the density
# threshold absorbs that).
# STRONG markers are essentially never English tokens; WEAK ones collide
# with English ("re", "na", "file") and only count alongside a strong hit —
# the self-test caught "re-run the na tests" tagging as greeklish without
# this split.
STRONG_MARKERS = {
    "kai", "einai", "eimai", "gia", "den", "tha", "apo", "oti", "alla",
    "edo", "ekei", "kala", "sou", "mou", "tou", "tis", "tora", "prin",
    "exo", "exei", "thelo", "thelei", "ksero", "xero", "pame", "ela",
    "oxi", "nai", "etsi", "opos", "vre", "loipon", "omos", "poly", "ligo",
    "kalimera", "kalispera", "efharisto", "eyxaristo",
}
WEAK_MARKERS = {"re", "na", "file", "logo", "mia", "ena", "meta", "pio"}


def detect_lang(text: str) -> str:
    greek = len(GREEK_SCRIPT_RE.findall(text))
    latin = len(LATIN_RE.findall(text))
    if greek > latin:
        return "el"
    if not latin:
        return "other"
    words = re.findall(r"[a-z]+", text.lower())
    if not words:
        return "other"
    strong = sum(1 for w in words if w in STRONG_MARKERS)
    weak = sum(1 for w in words if w in WEAK_MARKERS)
    if len(words) >= 4 and strong >= 1 and (strong + weak) / len(words) >= 0.12:
        return "gr-latn"
    return "en"


def split_by_lang(text: str):
    """Split a message into per-language chunks — the fix for mixed mail
    (a Greek body full of Latin tech vocabulary can win a whole-message
    majority vote). Classification is per paragraph, adjacent same-language
    paragraphs merge, and a minority side under 15 words does NOT split the
    message (a Greek greeting line on an English mail is seasoning, not a
    second document). Returns [(lang, chunk_text)]."""
    paras = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paras:
        return [(detect_lang(text), text)]
    tagged = [(detect_lang(p), p) for p in paras]
    words_by_lang = {}
    for lang, p in tagged:
        words_by_lang[lang] = words_by_lang.get(lang, 0) + len(p.split())
    majority = max(words_by_lang, key=words_by_lang.get)
    if len(words_by_lang) == 1 or \
       sorted(words_by_lang.values())[-2] < 15:
        return [(majority, text)]
    chunks = []
    for lang, p in tagged:
        if chunks and chunks[-1][0] == lang:
            chunks[-1] = (lang, chunks[-1][1] + "\n\n" + p)
        else:
            chunks.append((lang, p))
    return chunks


if __name__ == "__main__":
    cases = [
        ("kalimera, tha se paro tilefono meta, eimai edo kai perimeno", "gr-latn"),
        ("ela re file pame gia kafe tora?", "gr-latn"),
        ("Καλημέρα, θα σε πάρω τηλέφωνο", "el"),
        ("can you check the webhook retries and add a test", "en"),
        ("re-run the na tests before the release", "en"),
        ("1234 !!", "other"),
    ]
    failures = 0
    for text, want in cases:
        got = detect_lang(text)
        if got != want:
            failures += 1
            print(f"FAIL: {text!r} -> {got}, expected {want}")

    # split_by_lang: mixed mail splits; a short greeting does not
    mixed = ("Θα ήθελα την γνώμη σας για ένα θέμα που με απασχολεί εδώ και "
             "καιρό σχετικά με την παραγγελία και την εξέλιξή της.\n\n"
             "Separately, could you confirm the invoice number and the "
             "delivery window for the second batch of the order?")
    got = split_by_lang(mixed)
    if [l for l, _ in got] != ["el", "en"]:
        failures += 1
        print(f"FAIL: mixed mail -> {[l for l, _ in got]}, expected ['el', 'en']")
    greeting = ("Καλημέρα,\n\n"
                "quick update, the migration finished and the checks are "
                "green so I am closing the ticket and moving to the next "
                "item on the list for this week.")
    got = split_by_lang(greeting)
    if len(got) != 1 or got[0][0] != "en":
        failures += 1
        print(f"FAIL: greeting mail -> {[(l, t[:20]) for l, t in got]}, expected single en")

    print(f"{len(cases) + 2} cases, {failures} failure(s)")
    raise SystemExit(1 if failures else 0)
