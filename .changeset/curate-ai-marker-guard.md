---
"hyphos": patch
---

Curate and salvage now exclude em-dash-carrying messages from the voice
corpus (routed to corpus/ai-marked.jsonl, never quarantine), closing the
gap where pasted or AI-influenced text under the length ceiling reached the
register fingerprints; the salvage summary prints the live quarantine count
instead of the reference's hardcoded literal.
