import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Corpus and profiles locations. The data root is the hyphos package root,
 * anchored to this module's own location (a `package.json` walk) rather than
 * the current working directory, so the CLI works from any directory. Users
 * who keep corpus data elsewhere point `HYPHOS_HOME` at it; the finer-grained
 * `HYPHOS_CORPUS` / `HYPHOS_PROFILES` overrides win over `HYPHOS_HOME`.
 */
export function corpusDir(): string {
  return process.env.HYPHOS_CORPUS ?? path.join(dataRoot(), "corpus");
}

export function profilesDir(): string {
  return process.env.HYPHOS_PROFILES ?? path.join(dataRoot(), "profiles");
}

/**
 * Walk up from this module to the nearest `package.json` named `hyphos` —
 * the package root whether running from `src/` (tsx, tests) or from
 * the bundled `dist/` CLI. Falls back to the cwd (the historical behavior)
 * only if the walk leaves the package entirely, e.g. an exotic embedding.
 */
export function dataRoot(): string {
  if (process.env.HYPHOS_HOME) return process.env.HYPHOS_HOME;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { name?: string };
      if (pkg.name === "hyphos") return dir;
    } catch {
      // no readable package.json here — keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}
