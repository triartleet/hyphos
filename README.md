# hyphos

_ύφος — Greek for the style and tone of one's expression._

Rewrite any AI draft so it reads as written by **you**. hyphos builds
register-aware voice profiles from your own writing — chat transcripts, exports,
posts — preserves your quirk-level habits with enforcement rules a model can't
drift away from, and scores every output for how much it actually sounds like you.

This is the Node/TypeScript implementation, distributed on npm and runnable with
`npx`. It is a parity port of the original Python tool: same measurements, same
outputs, verified against the reference stage by stage.

**Status: early.** Corpus extraction, curation, register tagging, chat/email
ingest and stylometric fingerprints work today; the rewrite backend and the
fidelity score are in progress.

## What it does

- **Voice profiles, per register** — you don't have one voice; you have modes
  (technical, informal, editorial). hyphos profiles each: a stylometric
  fingerprint (sentence lengths, punctuation habits, openers, rhythm) plus a
  distilled style guide with your quirks and anti-patterns.
- **Rewrite** — feed it any AI-generated draft and a target register; it rewrites
  the draft in your voice.
- **Hard quirk enforcement** — mechanical habits (punctuation policy, banned
  words, casing) are applied _after_ the model as deterministic rules, because
  models normalize personal quirks away and drift from style instructions as
  context grows.
- **A fidelity score** — every output gets a "how-much-like-you" number
  (stylometric match plus a judge rubric), calibrated by blind self-tests.

## Quick start

```sh
npx hyphos extract            # extract your own messages from local transcripts
npx hyphos fingerprint        # compute stylometric fingerprints per register
npx hyphos rules --test       # self-test the deterministic enforcement rules
```

Corpus output lands in `corpus/` and profiles in `profiles/` (both under the
current directory; override with `HYPHOS_CORPUS` / `HYPHOS_PROFILES`). Stdout
prints aggregate numbers only — never your text — so it is safe to share.

## Non-English writing

Writing in another language (including Greeklish — Greek written in Latin
characters) contributes rhythm, register and punctuation habits, tagged as such.
It is never mined for word choice and never transliterated.

## Privacy by design

Your corpus and profiles never leave your machine: `corpus/` and `profiles/` are
gitignored, nothing is transmitted anywhere, and model calls (for the rewrite
stage) use your own credentials.

## Development

```sh
npm install
npm test          # unit + parity-anchor tests
npm run build     # bundle to dist/ (the published CLI)
npm run parity    # diff outputs against a reference implementation (see parity/)
```

License: MIT.
