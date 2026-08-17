---
"hyphos": patch
---

The CLI now resolves `corpus/` and `profiles/` from the package root instead
of the current working directory, so `hyphos score` (and every other
command) works from any directory; `HYPHOS_HOME` overrides the data root for
installations that keep corpus data elsewhere. Stage error hints now name the
actual CLI commands (`hyphos fingerprint`, `hyphos curate`, `hyphos extract`)
instead of the retired Python reference scripts.
