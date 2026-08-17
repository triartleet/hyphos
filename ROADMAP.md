# Roadmap

Living list — items get done, dropped, or reordered.

## Now

- Fingerprint refinements: sentence splitting that doesn't count line breaks
  as sentence ends in prose; residual quote-fragment cleanup in email ingest;
  per-register typo-rate metric (D-006).
- `--typos natural|none` flag on rewrite (default none, D-006).
- Greeklish handling for chat ingest: Latin-written Greek gets its own
  language tag and stays rhythm-signal only — no transliteration round-trips
  (two lossy layers). Ready before the Meta export arrives.

## Next

- Mixed-language email classification: majority-script per message
  misses Greek mail with Latin tech vocabulary — classify per paragraph or
  by windowed majority (found via a real sample slipping the en filter).

- Chat-export ingestion (WhatsApp/Telegram/Meta), speaker-separated — only
  the user's own messages; non-English as rhythm signal (D-004).
- Bounce/auto-mail filter in the email ingest.

## Later

- More output registers and per-audience presets.
- Era-weighted profiles (pre-AI-era text as the purity anchor).

## Shipped

- 2026-08-13 — initial Python pipeline: typed-message extraction from Claude
  Code transcripts (aggregate-only stdout), evidence-derived typed-text
  curation, register tagging calibrated to ignore the author's universal
  habits, Takeout sent-mail ingest with enforced owner authorship and
  quote/signature stripping, per-register stylometric fingerprints with a
  pre-2023 purity split for email. Reimplemented in TypeScript 2026-08-15
  with stage-by-stage verification (D-008).
- 2026-08-14 — `judge`: model-judged fidelity (register match, quirk
  fidelity, ism freedom, overall + evidence), CLI `score --judge` and the
  web app's Judge pass — reported beside the stylometric half, never merged.
- 2026-08-14 — `hyphos serve`: Translate-style local web app (PWA) —
  draft left, your voice right, register tabs, fidelity chip, tune drawer;
  binds 127.0.0.1 only.
- 2026-08-14 — the `hyphos` CLI — `rewrite` (subscription-first backend,
  profile-guided prompt, deterministic enforcement pass), `enforce`, `score`
  (uncalibrated v1, confidence-aware), `blind` (self-test harness).
