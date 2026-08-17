import { describe, it, expect } from "vitest";
import { pyRound, mean, median } from "../src/lib/num.js";

describe("pyRound (round half to even)", () => {
  it("rounds halves to the even neighbour", () => {
    expect(pyRound(0.5)).toBe(0);
    expect(pyRound(1.5)).toBe(2);
    expect(pyRound(2.5)).toBe(2);
    expect(pyRound(3.5)).toBe(4);
  });
  it("rounds non-halves normally", () => {
    expect(pyRound(2.4)).toBe(2);
    expect(pyRound(2.6)).toBe(3);
  });
  it("honours ndigits", () => {
    expect(pyRound(1.2345, 2)).toBe(1.23);
    expect(pyRound(2.675, 2)).toBe(2.67); // 2.675 is really 2.67499999…, so the tie rounds down
    expect(pyRound(0.125, 2)).toBe(0.12); // exact tie → even
  });
});

describe("median (statistics.median semantics)", () => {
  it("odd length returns the middle element", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([3, 1, 2])).toBe(2);
  });
  it("even length averages the two middle values", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([2, 2])).toBe(2);
  });
});

describe("mean", () => {
  it("matches sum/n", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
});
