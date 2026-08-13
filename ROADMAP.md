# Roadmap

Living list — items get done, dropped, or reordered.

## Now

- Corpus curation: strip machine-flavored text the stage-0 filter still lets
  through (long embedded blobs, quoted output), so word counts reflect real
  writing.

## Next

- Register tagging over the corpus (technical / informal / editorial).
- Voice profiles per register: stylometric fingerprint + distilled style guide
  with quirks and anti-patterns.
- `rewrite` CLI: draft + target register → your voice, with the post-model
  enforcement pass and a diff of what it changed.
- Fidelity score + `blind` self-test mode to calibrate it.

## Later

- Chat-export ingestion (WhatsApp/Telegram and similar), with speaker
  separation — only the user's own messages.
- Multilingual corpus support (rhythm/register signal, per D-004).
- More output registers and per-audience presets.

## Shipped

- 2026-08-13 — `bin/extract_corpus.py`: extract your own typed messages from
  Claude Code transcripts, with aggregate-only stdout.
