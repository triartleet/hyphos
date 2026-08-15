import { describe, it, expect } from "vitest";
import {
  RULES,
  PIPELINE_FIXTURES,
  applyOne,
  enforce,
  rulesSelftest,
} from "../src/commands/rules.js";

/**
 * Mirror of the Python `hyphos rules --test`: every rule is checked against its
 * own declared cases and the whole-pipeline fixtures. This must report zero
 * failures identically to the reference (D-003: deterministic enforcement parity).
 */
describe("rules self-test (D-003 deterministic enforcement)", () => {
  it("passes every rule case and pipeline fixture with 0 failures", () => {
    // quiet=false would print the summary; pass verbose=false to keep test output clean.
    expect(rulesSelftest(false)).toBe(0);
  });

  it("has the expected rule and test counts (12 rules, 15 tests)", () => {
    const nTests =
      RULES.reduce((s, r) => s + (r.tests?.length ?? 0), 0) +
      PIPELINE_FIXTURES.length;
    expect(RULES.length).toBe(12);
    expect(nTests).toBe(15);
  });

  it("checks each rule's individual cases directly", () => {
    for (const rule of RULES) {
      for (const t of rule.tests ?? []) {
        const [out, n] = applyOne(rule, t.in);
        if (t.out !== undefined) expect(out, `${rule.id}: ${t.in}`).toBe(t.out);
        if (t.flags !== undefined)
          expect(n, `${rule.id}: ${t.in}`).toBe(t.flags);
      }
    }
  });

  it("runs the pipeline fixtures through enforce", () => {
    for (const fx of PIPELINE_FIXTURES) {
      const [out] = enforce(fx.in);
      expect(out).toBe(fx.out);
    }
  });
});
