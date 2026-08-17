---
"hyphos": minor
---

Personal rules overlay (`profiles/rules.json`) can now retune built-in rules:
an overlay entry whose id matches a built-in replaces it in place — same
position, its own replacement and tests — while entries with new ids still
append after the built-ins. Appending alone could never redirect a built-in's
pattern (an appended em-dash rule never saw an em-dash; the built-ins had
already rewritten them all), so per-voice tuning of the deterministic pass
was unreachable for exactly the rules it matters most for. A missing or
malformed overlay still falls back to built-ins only.
