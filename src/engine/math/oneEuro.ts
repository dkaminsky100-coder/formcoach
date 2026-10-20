import type { Point } from '../types';

/** Exponential smoothing factor for a low-pass filter with the given cutoff (Hz). */
export function smoothingFactor(dt: number, cutoff: number): number {
  const r = 2 * Math.PI * cutoff * dt;
  return r / (r + 1);
}

/**
 * One Euro filter (Casiez et al., 2012): heavy smoothing when still, little lag when moving.
 *   cutoff = minCutoff + beta · |filtered speed|
 * `beta` is in units of the signal, so pixel and meter signals need different values.
 */
export class OneEuroFilter {
  private prev: number | null = null;
  private dPrev = 0;

  constructor(
    private readonly minCutoff = 1.5,
    private readonly beta = 0.02,
    private readonly dCutoff = 1,
  ) {}

  reset(): void {
    this.prev = null;
    this.dPrev = 0;
  }

  /** dt in seconds. */
  filter(x: number, dt: number): number {
    if (this.prev === null) {
      this.prev = x;
      this.dPrev = 0;
      return x;
    }
    if (!(dt > 0)) return this.prev;
    const dx = (x - this.prev) / dt;
    const edx = this.dPrev + smoothingFactor(dt, this.dCutoff) * (dx - this.dPrev);
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const out = this.prev + smoothingFactor(dt, cutoff) * (x - this.prev);
    this.prev = out;
    this.dPrev = edx;
    return out;
  }
}

export class PointFilter {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;
  private readonly fz: OneEuroFilter;

  constructor(minCutoff: number, beta: number) {
    this.fx = new OneEuroFilter(minCutoff, beta);
    this.fy = new OneEuroFilter(minCutoff, beta);
    this.fz = new OneEuroFilter(minCutoff, beta);
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }

  filter(p: Point, dt: number): Point {
    return { x: this.fx.filter(p.x, dt), y: this.fy.filter(p.y, dt), z: this.fz.filter(p.z, dt) };
  }
}
