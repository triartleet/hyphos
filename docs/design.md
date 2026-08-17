# Design — how hyphos works

Mechanism only. Decisions live in `DECISIONS.md`; usage in `README.md`.

## Pipeline

```
your transcripts / exports
        │  extract (`hyphos extract`)
        ▼
corpus/raw-sessions.jsonl        — your own typed messages, deduplicated
        │  tag registers
        ▼
profiles/<register>/             — two artifacts per register
        │   fingerprint.json     — computed stylometry: sentence-length
        │                          distribution, punctuation habits, casing,
        │                          openers/connectors, paragraph rhythm
        │   styleguide.md        — model-distilled guide: recurring structures,
        │                          quirks, anti-patterns; every claim cites
        │                          sample lines from the corpus
        ▼
rewrite: draft + register profile
        │  1. model pass — rewrite prompt built from both profile artifacts
        │  2. enforcement pass — deterministic rules (punctuation policy,
        │     banned words, casing, rhythm bounds) applied AFTER the model
        ▼
output + diff of what enforcement changed + fidelity score
```

## Extraction (stage 0, shipped)

Reads Claude Code transcript directories (`~/.claude/projects` by default,
`CLAUDE_CONFIG_DIR` honored, or an explicit path). Keeps user-typed text blocks
only; drops tool results, command wrappers, paste placeholders (pasted text is
not the user's writing), bare slash commands, and exact duplicates. Stdout is
aggregate-only so it can be shared without leaking project names.

## Fidelity (planned)

Two components reported together: a stylometric distance between the output and
the register's corpus (computed, model-free) and a judge rubric run by a model.
Calibration is a blind self-test: the tool shows snippets — some the user's real
writing, some generated — and the user marks which are theirs. The threshold at
which the user can no longer tell is the score's anchor.

## Registers

One identity, several modes. Profiles are kept per register (e.g. technical /
informal / editorial) because habits differ by mode; conversational and
instructional text is down-weighted when producing editorial output.
