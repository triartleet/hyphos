import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach } from "vitest";
import { corpusDir, profilesDir, dataRoot } from "../src/lib/paths.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

afterEach(() => {
  delete process.env.HYPHOS_HOME;
  delete process.env.HYPHOS_CORPUS;
  delete process.env.HYPHOS_PROFILES;
});

describe("data root resolution", () => {
  it("anchors corpus/profiles at the package root, not the cwd", () => {
    const was = process.cwd();
    process.chdir(os.tmpdir());
    try {
      expect(dataRoot()).toBe(repoRoot);
      expect(corpusDir()).toBe(path.join(repoRoot, "corpus"));
      expect(profilesDir()).toBe(path.join(repoRoot, "profiles"));
    } finally {
      process.chdir(was);
    }
  });

  it("HYPHOS_HOME overrides the data root", () => {
    process.env.HYPHOS_HOME = path.join(os.tmpdir(), "hyphos-home");
    expect(corpusDir()).toBe(
      path.join(process.env.HYPHOS_HOME, "corpus"),
    );
    expect(profilesDir()).toBe(
      path.join(process.env.HYPHOS_HOME, "profiles"),
    );
  });

  it("per-dir overrides win over HYPHOS_HOME", () => {
    process.env.HYPHOS_HOME = path.join(os.tmpdir(), "hyphos-home");
    process.env.HYPHOS_CORPUS = path.join(os.tmpdir(), "corpus-override");
    expect(corpusDir()).toBe(process.env.HYPHOS_CORPUS);
    expect(profilesDir()).toBe(
      path.join(process.env.HYPHOS_HOME, "profiles"),
    );
  });
});
