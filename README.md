# hyphos

<div align="center">
  <img src="https://raw.githubusercontent.com/triartleet/hyphos/main/media/hyphos-logo.png" width="520" alt="hyphos — a pen nib tracing a personal signature waveform, the shape of one writer's voice">
  <p>
    <a href="https://www.npmjs.com/package/hyphos"><img src="https://img.shields.io/npm/v/hyphos.svg?label=npm&color=cb3837" alt="npm version"></a>
    <a href="https://github.com/triartleet/hyphos/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/triartleet/hyphos/ci.yml?branch=main&label=CI" alt="CI"></a>
    <a href="https://github.com/triartleet/hyphos/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT license"></a>
  </p>
</div>

_ύφος — Greek for the style and tone of one's expression._

Rewrite any AI draft so it reads as written by **you**. hyphos builds
register-aware voice profiles from your own writing — chat transcripts, exports,
posts — preserves your quirk-level habits with enforcement rules a model can't
drift away from, and scores every output for how much it actually sounds like you.

This is the Node/TypeScript implementation, distributed on npm and runnable with
`npx`. It is a parity port of the original Python tool: same measurements, same
outputs, verified against the reference stage by stage.

**Status: working end to end, with named rough edges.** The corpus pipeline —
extraction, curation, register tagging, chat/email ingest, stylometric
fingerprints — and the output side both run today: `rewrite` (a model pass
over your own claude CLI or Anthropic API credentials, then the deterministic
enforcement pass), `score` (the model-free fidelity v1, plus the model-judged
half via `score --judge`), `blind` self-tests, and the local web app
(`serve`). Still open: score calibration, fingerprint refinements (sentence
splitting, email quote-fragment cleanup, per-register typo rate), and the
`--typos natural` rewrite mode — see the [roadmap](ROADMAP.md).

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

Corpus output lands in `corpus/` and profiles in `profiles/` under the
package root (resolved from the CLI's own location, so commands work from any
directory); point `HYPHOS_HOME` at another location to relocate both, or
`HYPHOS_CORPUS` / `HYPHOS_PROFILES` to override one. Stdout
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

### Regenerating the parity reference

The reference implementation is the retired pre-port Python pipeline, kept in
this repo's git history (stdlib-only, no dependencies). To regenerate the
reference outputs it compares against: extract it at the commit before the
port (`git archive <pre-port-sha> -- bin | tar -x -C <sandbox>`), copy the
corpus inputs into `<sandbox>/corpus/`, and run the stage scripts there with
`python3`; each writes into the sandbox, never the live corpus. The gates are
then env-configured:

```sh
HYPHOS_REF_CORPUS=corpus/reference-python/stage-corpus \
  node --import tsx parity/stages.ts   # per-stage outputs (curate…ingest)
HYPHOS_CORPUS=corpus HYPHOS_REF_PROFILES=corpus/reference-python/profiles \
  npm run parity                       # fingerprint profiles
```

Reference outputs are snapshots: if the corpus inputs change (a new export),
regenerate. Post-port behavior changes (the AI-marker corpus exclusion,
platform-normalized source names, rhythm-only profiles for non-English
registers) are expected to diff against the reference by design.

Roadmap: [ROADMAP.md](ROADMAP.md) · Decisions: [DECISIONS.md](DECISIONS.md)

## License

[MIT](LICENSE)
