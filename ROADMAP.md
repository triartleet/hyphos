# Roadmap

Living list — items get done, dropped, or reordered.

## Now

- Blind-test calibration of the fidelity score (needs the user, ~10 min):
  real-vs-rewritten discrimination anchors the score's meaning.
- Fingerprint refinements: sentence splitting that doesn't count line breaks
  as sentence ends in prose; residual quote-fragment cleanup in email ingest.

## Next

- LLM-judge component of the score (semantic half, backend-driven), reported
  beside the stylometric half.
- Chat-export ingestion (WhatsApp/Telegram/Meta), speaker-separated — only
  the user's own messages; non-English as rhythm signal (D-004).
- Bounce/auto-mail filter in the email ingest.

## Later

- More output registers and per-audience presets.
- Era-weighted profiles (pre-AI-era text as the purity anchor).

## Shipped

- 2026-08-13 — `bin/extract_corpus.py`: extract your own typed messages from
  Claude Code transcripts, with aggregate-only stdout.
- 2026-08-13 — `bin/curate_corpus.py`: evidence-derived typed-text curation
  (fences, logs, image captions, JSON pastes stripped; oversized messages
  quarantined).
- 2026-08-13 — `bin/tag_registers.py`: rule-based register tagging, calibrated
  to ignore the author's universal habits.
- 2026-08-13 — `bin/ingest_email.py`: Takeout sent-mail ingest with enforced
  owner authorship (From filter) and quote/signature stripping.
- 2026-08-13 — `bin/profile_fingerprint.py`: per-register stylometric
  fingerprints, including a pre-2023 purity split for email.
- 2026-08-14 — `bin/hyphos`: the CLI — `rewrite` (subscription-first backend,
  profile-guided prompt, deterministic enforcement pass), `enforce`, `score`
  (uncalibrated v1, confidence-aware), `blind` (self-test harness).
