---
"hyphos": patch
---

README status reconciled with what actually ships: the rewrite backend
(model pass + deterministic enforcement), the fidelity score (model-free v1
and `--judge`), blind self-tests, and the local web app are stated as working,
with the genuinely open items (score calibration, fingerprint refinements,
`--typos natural` mode) named instead of a blanket "in progress". The
quick-start data-location note now matches the package-root resolution
(`HYPHOS_HOME` / per-directory overrides) instead of the retired cwd default.
