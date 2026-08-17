/**
 * Numeric helpers with Python-matching semantics — the tool's outputs depend
 * on these being exact, so the differences from the JS defaults are deliberate:
 *
 * - `pyRound` reproduces Python's round-half-to-even ("banker's rounding");
 *   `Math.round` rounds half up, which would drift every stylometric ratio.
 * - `median` returns the average of the two middle values for an even-length
 *   input (matching `statistics.median`), which can be a fractional number.
 */

/**
 * Python 3 `round(x, ndigits)` — round half to even, on the TRUE binary value.
 *
 * CPython rounds the actual double (e.g. 2.675 is really 2.67499999…, so
 * `round(2.675, 2)` is 2.67), not the naive `x * 10**n` product — which would
 * round the multiply's own error up to 267.5 and give the wrong answer. So we
 * expand the double to far more decimal places than it is significant, then round
 * that decimal string half-to-even. BigInt keeps the final increment exact.
 */
export function pyRound(x: number, ndigits = 0): number {
  if (!Number.isFinite(x)) return x;
  if (Object.is(x, -0)) return -0;
  const neg = x < 0;
  const ax = Math.abs(x);
  const places = Math.min(100, Math.max(0, ndigits) + 25);
  const fixed = ax.toFixed(places); // correctly rounded far past significance
  const [intPart, fracRaw = ""] = fixed.split(".");
  let frac = fracRaw;
  while (frac.length <= ndigits) frac += "0";
  const kept = frac.slice(0, ndigits);
  const dropped = frac.slice(ndigits);
  let n = BigInt((intPart ?? "0") + kept || "0");
  const first = dropped.charCodeAt(0) - 48;
  const restNonzero = /[1-9]/.test(dropped.slice(1));
  let roundUp: boolean;
  if (first > 5) roundUp = true;
  else if (first < 5) roundUp = false;
  else roundUp = restNonzero ? true : n % 2n === 1n; // exact tie → even
  if (roundUp) n += 1n;
  const digits = n.toString();
  let out: string;
  if (ndigits <= 0) {
    out = digits;
  } else {
    const padded = digits.padStart(ndigits + 1, "0");
    out =
      padded.slice(0, padded.length - ndigits) +
      "." +
      padded.slice(padded.length - ndigits);
  }
  const val = Number(out);
  return neg ? -val : val;
}

/** Arithmetic mean (matches `statistics.mean` for the numeric ranges used). */
export function mean(xs: number[]): number {
  if (xs.length === 0) throw new Error("mean() of empty sequence");
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Median matching `statistics.median` (even length → average of the two middle). */
export function median(xs: number[]): number {
  if (xs.length === 0) throw new Error("median() of empty sequence");
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return s[mid]!;
  return (s[mid - 1]! + s[mid]!) / 2;
}
