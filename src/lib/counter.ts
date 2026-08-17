/**
 * A counting map with the semantics the pipeline relies on: insertion order is
 * preserved (JS `Map`), and `mostCommon` breaks count ties by first-seen order
 * (a stable sort over insertion order). The tie order keeps
 * `top_sentence_openers` and connector rankings stable.
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
    // equal counts keep first-seen order (stable tie-break).
    const sorted = this.entries().sort((a, b) => b[1] - a[1]);
    return n === undefined ? sorted : sorted.slice(0, n);
  }
}
