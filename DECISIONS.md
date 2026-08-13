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
