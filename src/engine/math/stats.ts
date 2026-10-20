/** Fixed-size window of recent samples. */
export class RollingWindow {
  private buf: number[] = [];

  constructor(private readonly size: number) {}

  push(v: number): void {
    this.buf.push(v);
    if (this.buf.length > this.size) this.buf.shift();
  }

  get length(): number {
    return this.buf.length;
  }

  clear(): void {
    this.buf.length = 0;
  }

  /** Nearest-rank percentile, q in [0, 1]. NaN when empty. */
  percentile(q: number): number {
    if (this.buf.length === 0) return NaN;
    const sorted = [...this.buf].sort((a, b) => a - b);
    const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[rank];
  }
}
