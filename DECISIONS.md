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
the user (it shows when a rewrite is *not* working).

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
