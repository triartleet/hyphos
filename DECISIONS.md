# Decisions

Append-only. Entries are superseded by new entries, never edited.

### D-001 — Voice data is local-only by design

**Scope:** repo · **Decided:** 2026-08-13

The corpus (your extracted writing) and the profiles derived from it live under
`corpus/` and `profiles/`, both gitignored. The tool never commits, transmits, or
logs their contents; model calls use the user's own API key.

**Why:** a person's collected writing is among the most sensitive data they own —
it carries identity, relationships, and workplace context. A voice tool is only
trustworthy if the data plane is local by construction, not by policy.

**Consequences:** no hosted features; every machine builds its own corpus;
anything shareable (the code, the docs) must make sense without the data.

### D-002 — v1 is the full loop, fidelity score included

**Scope:** repo · **Decided:** 2026-08-13

The first complete version ships all four stages — corpus extraction, register
profiles, rewrite, and the fidelity score with blind self-tests — not a
profiles-only or rewrite-only cut.

**Why:** "sounds like you" is an unfalsifiable claim without measurement. The
score is both the quality loop (it catches drift) and the honest contract with
the user (it shows when a rewrite is _not_ working).

### D-003 — Quirks are enforced after the model, as deterministic rules

**Scope:** repo · **Decided:** 2026-08-13

Mechanical style habits — punctuation policy, banned words, casing, rhythm
bounds — are applied in a post-model pass as hard rules, not as prompt
instructions.

**Why:** language models systematically normalize personal quirks toward generic
polish, and style instructions decay as context grows. A deterministic pass
cannot be argued with; prompts can.

**Consequences:** the rewrite output may differ from the raw model output; the
diff of what enforcement changed is part of the result.

### D-004 — Non-English sources contribute rhythm, never vocabulary

**Scope:** repo · **Decided:** 2026-08-13

Writing in other languages may enter the corpus as low-weight signal for
register, rhythm, and punctuation habits, tagged as such — it is never mined for
English word choice.

**Why:** stylometric traits (directness, sentence rhythm, punctuation, humor
cadence) transfer across languages; idiom and vocabulary do not. Mixing them
degrades the profile it claims to improve.

### D-005 — The rewrite backend is subscription-first, API-key second

**Scope:** repo · **Decided:** 2026-08-13

Rewrite and judging calls target the user's existing Claude subscription first, by
driving the locally installed `claude` CLI; a direct Anthropic API key
(`ANTHROPIC_API_KEY`) is the secondary backend for headless or scripted use.

**Why:** the likeliest user already pays for a Claude subscription; metered API
spend should be an opt-in, never a prerequisite for using the tool. It also keeps
the data plane consistent with D-001 — both backends run under credentials the
user already controls.

**Consequences:** the CLI must detect an available `claude` binary and degrade
clearly when neither backend is present; per-call cost reporting only applies on
the API path.

### D-006 — Output is clean by default; imperfections are an opt-in, measured feature

**Scope:** repo · **Decided:** 2026-08-14

Rewritten output ships typo-free, regardless of how typo-rich the source corpus
is. A separate opt-in feature may inject characteristic imperfections at the
author's measured per-register frequency — never invented ones.

**Why:** corpus typos are register artifacts: they cluster in low-stakes prompt
and dictation contexts, not in text the author sends to people. Reproducing them
by default would forge carelessness rather than voice. The blind-test finding
behind this: the author correctly rejected his own typo-heavy prompt text as not
his for human-facing writing — typo rate is register signal, not identity.

**Consequences:** fingerprints gain a per-register typo-rate metric; the rewrite
command gains a `--typos natural|none` flag defaulting to none.

### D-007 — Registers are discovered from data, never declared in code

**Scope:** repo · **Decided:** 2026-08-14

The register list is whatever profile buckets exist with corpus behind them.
The interface surfaces each register with a confidence derived from sampling
depth; low-confidence registers advertise their cure (add source material)
instead of hiding. An "auto" mode infers the register from the draft by
stylometric proximity, with the inference and its confidence always shown and
overridable. A local feedback loop (good / fine / bad, with a one-line
justification on bad) accumulates evidence per register and surfaces
improvement suggestions once a pattern forms.

**Why:** hardcoded registers make the tool rigid exactly where voices differ
most — one person's set of modes is not another's. A register defined as "a
folder of samples" means users create new registers (a dm-to-manager voice, a
changelog voice) by supplying material, not by asking for features. Confidence
shown honestly beats capability implied falsely, and the user's own quality
verdicts are the cheapest reliable improvement signal a local tool can have.

**Consequences:** the web UI builds its tabs from `/api/registers` at load;
`/api/infer` ranks buckets by fidelity-proximity; feedback lands in
`corpus/feedback.jsonl` (local-only, like all voice data).

### D-008 — Content adaptation is a rule registry, never ad-hoc prose rework

**Scope:** repo · **Decided:** 2026-08-14

Every deterministic content-adaptation operation is a declared rule — id,
kind (remove / replace / flag), pattern, and its own embedded test cases —
applied by one engine in listed order with per-rule reporting. `hyphos rules`
lists them; `hyphos rules --test` verifies every rule against its cases plus
whole-pipeline fixtures, and is the repo's standing correctness command.
Personal rules extend via `profiles/rules.json`, same schema.

**Why:** transformations written as ad-hoc code accumulate into behavior
nobody can predict or verify — the same decay that kills prose rules kills
prose-shaped code. Rules as data are enumerable, individually testable, and
their application is a report rather than a mystery. The first self-test run
proved the point: it immediately caught a live bug (a dash rule mangling
year ranges its own comment claimed to protect).

**Consequences:** new adaptations must arrive as rules with tests; a rule
without tests fails review by construction.

### D-008 — TypeScript/Node reimplementation, gated on stage-by-stage parity

**Scope:** repo · **Decided:** 2026-08-15

The tool is reimplemented in TypeScript and run via `npx`; the Python scripts are
retired. The port is not a rewrite-by-feel: every stage's output is verified
identical to the previous implementation on a real corpus before cutover
(`npm run parity`; the harness lives in `parity/`). Shared primitives that
govern cross-language fidelity — rounding (round-half-to-even), tokenization
(Unicode-aware word and sentence rules), language tagging — live once in
`src/lib/` and every stage draws on them rather than re-deriving them.

**Why:** distribution and longevity. `npx hyphos` reaches the ecosystem this tool
serves far better than a clone-and-run script, and one toolchain is one fewer
thing to keep alive as the surrounding tools change. Parity-gating made the
switch safe rather than a leap — the gate caught two real defects a hand port
would have shipped silently: a whitespace-splitting mismatch that miscounted
words, and a tie-break ordering difference in the connector ranking.

**Consequences:** behavior parity with the retired implementation is the standard
for any stage change (`npm run parity` stays green); new numeric or tokenization
behavior goes through `src/lib`, never re-implemented per stage; the previous
implementation remains in git history for auditing the port.

### D-009 — Take the two semver-major dependency bumps (vitest 4, adm-zip 0.6)

**Scope:** repo · **Decided:** 2026-08-17

vitest moves 2.1.8 → 4.1.10 and adm-zip 0.5.16 → 0.6.0. vitest first
(dev-only; the suite runs unchanged under 4), adm-zip behind an entry-order
gate: zip entries must keep arriving in stored central-directory order
(`noSort`), the ordering ingest matches against the reference implementation;
that ordering was verified identical across the bump, so only the full parity
run against the reference remains owed. adm-zip 0.6.0 bundles its own types,
which drops @types/adm-zip. The semver-range advisory bumps (mailparser, tsup,
tsx) travel with the pending advisory-sweep branch.

**Why:** the advisories needing major versions are exactly the two left after
the within-semver sweep; vitest 4 clears the critical/high set in one jump on
a small suite, and adm-zip's fix lands with its one parity-relevant property
pinned before merge.

### D-010 — Overlay rules retune built-ins in place; em-dash joins resolve to semicolons

**Scope:** repo · **Decided:** 2026-08-17

An overlay entry in `profiles/rules.json` whose id matches a built-in rule
replaces it in place — same position, its own replacement and tests — while
entries with new ids keep appending after the built-ins. Appending alone made
per-voice tuning unreachable for any pattern a built-in consumed first: an
appended em-dash rule never saw an em-dash, because the built-ins had already
rewritten them all to commas. The motivating retune is live in the
maintainer's own overlay (untracked, per-install config): single and tight
em-dash joins become `;`, while paired asides keep the built-in parentheses
rewrite, since a semicolon does not fit a parenthetical.

### D-011 — Em-dash rewrites dropped from the registry; dash usage is voice data

**Scope:** repo · **Decided:** 2026-08-17

The em-dash rewrite family (pair → parentheses, single/tight → comma) is
removed from the rules registry entirely, and nothing substitutes it. Dash
usage follows the voice profile's own patterns: the maintainer's typed
baseline is ~0 per 1k words, already encoded in the corpus curation (em-dash
carriers are excluded as AI markers) and scored by `emdash_per_1k` in the
fidelity pass. A deterministic substitution was solving the wrong case — it
reshaped drafts toward a join style the voice itself barely uses. Supersedes
the same-day semicolon retune of these rules; D-010's overlay retuning
stands for other rules.

### D-012 — Two unfixed advisory chains accepted until upstream ships

**Scope:** repo · **Decided:** 2026-08-17

The mailparser → html-to-text → deepmerge-ts chain (3 highs, stack-exhaustion
class, GHSA-ggr8-5vv4-36mx) and tsup's nested esbuild 0.27.x (low,
GHSA-g7r4-m6w7-qqqr) are accepted as-is: no fixed version exists upstream —
html-to-text's latest still declares the vulnerable deepmerge-ts range, and
tsup's latest pins esbuild ^0.27.0, which caret-on-0.x cannot lift to 0.28.
Exposure is bounded: the merge flaw is reachable only through HTML in the
ingested email exports (crash-class, not code execution), and the esbuild
flaw covers a dev-server-on-Windows path tsup never runs.

**Why:** the zero-audit alternatives — pinning mailparser seven patches below
latest, or forcing deepmerge-ts ^8 or esbuild 0.28 in against declared
ranges — each move risk onto the parity-governed ingest path or desynchronize
the lockfile, to dodge crash-class flaws with near-zero reach. Both clear as
plain in-range updates the moment upstream ships; until then `npm audit`
reads 4 findings (1 low, 3 high) by design, not by oversight.

### D-013 — Parity harness retired; the project presents as itself

**Scope:** repo · **Decided:** 2026-08-17

The cutover the parity harness gated is complete — the final recheck passed
the same day, with the ingest stages and fingerprint outputs verified against
freshly regenerated reference outputs — so the harness, its npm script, its
documentation, and the stored reference artifacts are removed. The repo no
longer frames itself as a port: no "reference implementation" or parity
vocabulary remains in code, tests, or docs; one past-tense sentence in the
README and this decisions log carry the history. Comments naming Python APIs
(`str.split`'s whitespace set, `zf.namelist()` ordering, `round(x, ndigits)`)
stay deliberately: they document the exact semantics the code implements,
not the project's origin.

**Why:** a public project should read as one implementation with one history,
not as half of a comparison; the transition's scaffolding had no job left
once its last verification duty was discharged.
