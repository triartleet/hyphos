---
"hyphos": minor
---

The deterministic em-dash rewrites (paired asides to parentheses, single and
tight joins to commas) are removed from the rules registry. Dash usage is
voice data, not a fixed substitution: profiles carry the voice's own baseline
(~0 per 1k words for the reference voice, and em-dash carriers are already
excluded from the voice corpus as AI markers) and the fidelity score measures
`emdash_per_1k`, so a rewritten draft is scored against the voice's actual
dash density instead of being deterministically reshaped. The self-test
counts and the whole-pipeline fixture now pin that em-dashes pass through
the deterministic pass untouched.
