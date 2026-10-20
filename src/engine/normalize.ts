import { LM } from '../pose/landmarks';
import { dist2D, mid } from './math/vec';
import { RollingWindow } from './math/stats';
import type { Point, TrackedPoint } from './types';

export function midpoint(pts: TrackedPoint[], a: number, b: number): Point | null {
  const pa = pts[a], pb = pts[b];
  if (!pa?.present || !pb?.present) return null;
  return mid(pa, pb);
}

/** Hip→knee→ankle path length for one side, or null if any joint is not valid. */
export function legPathLength(pts: TrackedPoint[], hip: number, knee: number, ankle: number): number | null {
  const h = pts[hip], k = pts[knee], a = pts[ankle];
  if (!h?.valid || !k?.valid || !a?.valid) return null;
  return dist2D(h, k) + dist2D(k, a);
}

/**
 * Running estimate of leg length in pixels. The path length doesn't shrink when the knee bends,
 * but foreshortening and occlusion make single frames noisy, so take a high percentile of
 * recent samples. M5 calibration will replace this with a measured value.
 */
export class BodyScale {
  private readonly samples = new RollingWindow(150);

  update(pts: TrackedPoint[]): number | null {
    for (const [h, k, a] of [
      [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE],
      [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE],
    ] as const) {
      const len = legPathLength(pts, h, k, a);
      if (len !== null && len > 0) this.samples.push(len);
    }
    return this.value;
  }

  get value(): number | null {
    return this.samples.length >= 5 ? this.samples.percentile(0.9) : null;
  }

  reset(): void {
    this.samples.clear();
  }
}

/** Hip-centered coordinates divided by leg length. */
export function normalizePoints(pts: TrackedPoint[], origin: Point | null, scale: number | null): (Point | null)[] {
  if (!origin || !scale) return pts.map(() => null);
  return pts.map((p) =>
    p.present ? { x: (p.x - origin.x) / scale, y: (p.y - origin.y) / scale, z: (p.z - origin.z) / scale } : null,
  );
}
