---
"hyphos": patch
---

Dependency advisory sweep: mailparser 3.7.1 → 3.9.15 (clears the linkify-it
quadratic-scan, nodemailer raw-attachment/SSRF/SMTP-injection, and mailparser
XSS advisories), vitest 2.1.8 → 2.1.9, tsup 8.3.5 → 8.5.1, tsx 4.19.2 →
4.23.12 (esbuild dev-server advisory). Remaining advisories need semver-major
bumps and are parked for a decision: adm-zip 0.6.0 (crafted-ZIP allocation;
here it only ever opens the user's own export archives) and vitest 4.x (API
server RCE pair; the test suite never starts the UI/API server).
