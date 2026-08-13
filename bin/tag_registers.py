#!/usr/bin/env python3
"""Stage 1a — tag each curated message with a register.

Register = the mode the person is writing in. v1 buckets:
- technical-instruction — telling an agent/tool what to do (the bulk of a chat
  corpus): imperatives, task vocabulary, repo/tool nouns.
- informal — casual voice: lowercase starts, casual tokens, short bursts,
  missing terminal punctuation.
- editorial — connected long-form prose written to be read: multi-sentence
  paragraphs, discourse markers, low imperative density. Rare in chat corpora;
  profiles for this register are expected to need seed material from published
  writing (drop files under corpus/seed-editorial/ later).

Rule-based on purpose: transparent, auditable, cheap to re-run. A model pass
can re-judge ambiguous rows in a later stage. Reads corpus/curated.jsonl,
writes corpus/tagged.jsonl (adds `register` + `register_scores`). Stdout is
aggregate-only.
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CORPUS = REPO / "corpus"

IMPERATIVES = {
    "add", "build", "change", "check", "clean", "close", "commit", "compare",
    "continue", "create", "delete", "deploy", "do", "ensure", "explain", "find",
    "fix", "generate", "give", "go", "implement", "install", "investigate",
    "keep", "list", "load", "make", "move", "open", "please", "proceed", "push",
    "read", "record", "refactor", "remove", "rename", "rerun", "resume", "run",
    "search", "show", "start", "stop", "test", "try", "update", "use", "verify",
    "write",
}
TECH_NOUNS = {
    "agent", "api", "branch", "bug", "build", "cli", "code", "commit", "config",
    "deploy", "endpoint", "error", "file", "flag", "function", "hook", "log",
    "merge", "pipeline", "pr", "repo", "script", "session", "test", "token",
    "typescript", "ui", "workflow",
}
CASUAL_TOKENS = {
    "ah", "btw", "cool", "haha", "hey", "hm", "hmm", "lol", "nah", "nope",
    "ok", "okay", "oops", "pls", "r", "thanks", "thx", "u", "wanna", "wtf",
    "yeah", "yep",
}
DISCOURSE = {
    "actually", "although", "besides", "however", "indeed", "instead",
    "moreover", "nevertheless", "overall", "rather", "therefore", "though",
    "ultimately", "whereas", "while",
}


INSTRUCTION_RE = re.compile(
    r"\b(i want|i need|i would like|can you|could you|let'?s|we (should|want|"
    r"need)|please|make sure|instead of|proceed|continue)\b", re.I)


def scores(text: str) -> dict:
    # Deliberately ignores casing and terminal punctuation: those are the
    # author's universal habits across every register, not register signal
    # (measured: v1 rules using them mislabeled 57% of an instruction-heavy
    # corpus as informal).
    words = re.findall(r"[a-zA-Z']+", text.lower())
    if not words:
        return {"technical": 0.0, "informal": 0.0, "editorial": 0.0}
    n = len(words)
    sentences = [s for s in re.split(r"[.!?\n]+", text) if s.strip()]
    n_sent = max(len(sentences), 1)
    first_words = {re.findall(r"[a-zA-Z']+", s.lower())[0]
                   for s in sentences if re.findall(r"[a-zA-Z']+", s.lower())}

    tech_density = sum(w in TECH_NOUNS for w in words) / n
    instr = len(INSTRUCTION_RE.findall(text)) / n_sent
    imper = sum(fw in IMPERATIVES for fw in first_words) / n_sent

    tech = tech_density * 6 + instr * 1.5 + imper * 2
    informal = (sum(w in CASUAL_TOKENS for w in words) / n * 8
                + (0.3 if n < 8 else 0))
    editorial = (sum(w in DISCOURSE for w in words) / n * 5
                 + (0.4 if len(sentences) >= 4 else 0)
                 + (0.3 if n > 80 else 0)
                 - tech_density * 4 - instr * 1.0 - imper * 1.5)
    return {"technical": round(tech, 3), "informal": round(informal, 3),
            "editorial": round(max(editorial, 0.0), 3)}


def main():
    src = CORPUS / "curated.jsonl"
    if not src.is_file():
        print("missing curated.jsonl — run curate_corpus.py first", file=sys.stderr)
        return 1
    out_path = CORPUS / "tagged.jsonl"
    dist = Counter()
    word_dist = Counter()
    with out_path.open("w") as out:
        for line in src.open():
            o = json.loads(line)
            s = scores(o["text"])
            register = max(s, key=s.get) if max(s.values()) > 0 else "technical"
            # ties and dead heats default toward technical (the corpus's nature)
            o["register"] = ("technical-instruction" if register == "technical"
                            else register)
            o["register_scores"] = s
            dist[o["register"]] += 1
            word_dist[o["register"]] += o["words"]
            out.write(json.dumps(o, ensure_ascii=False) + "\n")
    total = sum(dist.values())
    for reg, c in dist.most_common():
        print(f"{reg}: {c} msgs ({100*c/total:.0f}%), {word_dist[reg]} words")
    print(f"total: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
