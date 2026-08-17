---
"hyphos": patch
---

Dependency major bumps that clear the remaining high-severity advisory set:
vitest 2.1.8 → 4.1.10 (dev-only; the suite runs unchanged) and adm-zip
0.5.16 → 0.6.0 (crafted-archive allocation fix, GHSA-xcpc-8h2w-3j85).
adm-zip 0.6.0 bundles its own TypeScript types, so the @types/adm-zip stub is
dropped; zip entries are still visited in stored central-directory order
(`noSort`), the ordering the ingest stage relies on, verified unchanged
across the bump.
