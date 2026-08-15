/**
 * A counting map matching the parts of Python's `collections.Counter` the
 * pipeline relies on. Insertion order is preserved (JS `Map` semantics), and
 * `mostCommon` breaks count ties by first-seen order — the same result Python's
 * `Counter.most_common` gives via a stable sort over an insertion-ordered dict.
 * Getting the tie order right keeps `top_sentence_openers` and connector rankings
 * identical to the reference.
 */
export class Counter<K = string> {
  private readonly m = new Map<K, number>();

  add(key: K, n = 1): void {
    this.m.set(key, (this.m.get(key) ?? 0) + n);
  }

  get(key: K): number {
    return this.m.get(key) ?? 0;
  }

  get size(): number {
    return this.m.size;
  }

  entries(): [K, number][] {
    return [...this.m.entries()];
  }

  /** Top `n` by count, ties broken by insertion order (n omitted → all). */
  mostCommon(n?: number): [K, number][] {
    // Array.prototype.sort is stable, and entries() is in insertion order, so
    // equal counts keep first-seen order — matching Python.
    const sorted = this.entries().sort((a, b) => b[1] - a[1]);
    return n === undefined ? sorted : sorted.slice(0, n);
  }
}
