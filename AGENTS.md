# AGENTS.md

Operating contract for AI agents working in **hyphos**.

## What this project is

A local-first personal-voice engine: it extracts a user's own writing from their
chat transcripts, builds register-aware voice profiles (stylometric fingerprint +
distilled style guide), rewrites AI-generated drafts in the user's voice with a
deterministic quirk-enforcement pass, and scores outputs for fidelity. Published
publicly (MIT). `DECISIONS.md` is the decision record; `README.md` is the
user-facing guide — keep that split.

## Working rules

- **Reuse-first, minimal diffs.** Check existing code before adding helpers;
  never touch files outside the task's scope.
- **`DECISIONS.md` is load-bearing.** Read it before any non-trivial change; do
  not re-open a decision without the maintainer. Core invariants: voice data is
  local-only (D-001), quirk enforcement is deterministic and post-model (D-003),
  non-English sources never contribute vocabulary (D-004).
- **User data is untouchable.** `corpus/` and `profiles/` hold the user's private
  writing: never commit them, never transmit them, never print their contents
  into logs, issues, commit messages, or tool output. Stdout of any tool here
  reports aggregates only.
- **No test suite yet.** Verify the extractor against a real transcript
  directory before calling a change done.
- **Never commit or push unasked.** The maintainer drives version control;
  commits stay unattributed (no Co-authored-by / generated-with trailers).
- **Public repo.** Commit author must be the identity set in local git config.
  Publishing exposes ALL history, not just the current tree, so no tracked file
  or commit message may carry: absolute paths, hostnames or other machine and
  environment detail; workplace or third-party identifiers of any kind; identity
  or credential configuration written into prose (author metadata belongs in
  `LICENSE`); references to the maintainer's other work; competitive positioning
  against other tools; or internal deliberation and provenance. The test:
  *would this line make sense, and be safe, read by a stranger who knows nothing
  about the maintainer or their other work?* A pre-commit content gate enforces
  this where installed (`.githooks/`) — a backstop, not a substitute for the rule.
