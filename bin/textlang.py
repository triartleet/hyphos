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
    print(f"{len(cases)} cases, {failures} failure(s)")
    raise SystemExit(1 if failures else 0)
