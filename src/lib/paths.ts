import path from "node:path";

/**
 * Corpus and profiles locations. Default to `./corpus` and `./profiles` under the
 * current working directory (the natural place when running inside a project);
 * overridable via env so the parity harness can point both implementations at the
 * same reference directories.
 */
export function corpusDir(): string {
  return process.env.HYPHOS_CORPUS ?? path.join(process.cwd(), "corpus");
}

export function profilesDir(): string {
  return process.env.HYPHOS_PROFILES ?? path.join(process.cwd(), "profiles");
}
