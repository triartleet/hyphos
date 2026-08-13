# hyphos

*ύφος — Greek for the style and tone of one's expression.*

Rewrite any AI draft so it reads as written by **you**. hyphos builds
register-aware voice profiles from your own writing — chat transcripts, exports,
posts — preserves your quirk-level habits with enforcement rules a model can't
drift away from, and scores every output for how much it actually sounds like you.

**Status: early.** Stage 0 (corpus extraction) works today; profiles, rewrite, and
the fidelity score are in progress — see `ROADMAP.md`.

## What it will do

- **Voice profiles, per register** — you don't have one voice; you have modes
  (technical, informal, editorial). hyphos profiles each: a stylometric
  fingerprint (sentence lengths, punctuation habits, openers, rhythm) plus a
  distilled style guide with your quirks and anti-patterns.
- **Rewrite** — feed it any AI-generated draft and a target register; it rewrites
  the draft in your voice.
- **Hard quirk enforcement** — mechanical habits (punctuation policy, banned
  words, casing) are applied *after* the model as deterministic rules, because
  models normalize personal quirks away and drift from style instructions as
  context grows.
- **A fidelity score** — every output gets a "how-much-like-you" number
  (stylometric match + a judge rubric), calibrated by blind self-tests: it shows
  you snippets and asks which ones you actually wrote.

## Quick start (what works today)

Extract your own messages from your Claude Code transcripts:

```sh
python3 bin/extract_corpus.py            # reads ~/.claude/projects
python3 bin/extract_corpus.py /path/dir  # or any transcript directory
```

`CLAUDE_CONFIG_DIR` is honored if set. Output lands in `corpus/` (gitignored).
Stdout prints aggregate numbers only — no project names, safe to share.

## Privacy by design

Your corpus and profiles never leave your machine: `corpus/` and `profiles/` are
gitignored, nothing is transmitted anywhere, and model calls (when the rewrite
stage lands) use your own API key.

---

Roadmap: `ROADMAP.md` · Decisions: `DECISIONS.md` · Internals: `docs/design.md` ·
License: MIT
