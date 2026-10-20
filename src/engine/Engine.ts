import { LANDMARK_COUNT, LM } from '../pose/landmarks';
import { computeFeatures, shoulderSpread } from './features';
import { PointFilter } from './math/oneEuro';
import { dist2D } from './math/vec';
import { BodyScale, midpoint, normalizePoints } from './normalize';
import { isPresent, isValid, toPixel } from './preprocess';
import type { BodyFrame, EngineFrame, LandmarkLike, Point, RawPose, TrackedPoint } from './types';
import { classifyView, ViewTracker } from './view';

export interface EngineOptions {
  smoothing: boolean;
  /** One Euro min cutoff (Hz). Lower = smoother when still. */
  minCutoff: number;
  /** One Euro speed coefficient for pixel coordinates. */
  beta: number;
  /** Same for world coordinates (meters ≈ 400 px at typical distance, so beta scales up). */
  worldBeta: number;
  /** A gap longer than this (ms) restarts the filters instead of sliding from stale positions. */
  resetGapMs: number;
  /**
   * Hip movement between consecutive frames, in leg lengths, treated as a different person
   * (the model switched subjects). 0.6 L in ~33 ms would be ~15 m/s - not humanly possible.
   */
  identityJump: number;
}

const DEFAULTS: EngineOptions = {
  smoothing: true,
  minCutoff: 1.5,
  beta: 0.02,
  worldBeta: 8,
  resetGapMs: 500,
  identityJump: 0.6,
};

/** Raw pose → smoothed, scaled body + features. One instance per live session. */
export class Engine {
  private readonly opts: EngineOptions;
  private readonly pxFilters: PointFilter[];
  private readonly worldFilters: PointFilter[];
  private readonly scale = new BodyScale();
  private readonly viewTracker = new ViewTracker();
  private lastT: number | null = null;
  private lastRawHip: Point | null = null;

  constructor(opts: Partial<EngineOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.pxFilters = Array.from({ length: LANDMARK_COUNT }, () => new PointFilter(this.opts.minCutoff, this.opts.beta));
    this.worldFilters = Array.from(
      { length: LANDMARK_COUNT },
      () => new PointFilter(this.opts.minCutoff, this.opts.worldBeta),
    );
  }

  get smoothing(): boolean {
    return this.opts.smoothing;
  }

  setSmoothing(on: boolean): void {
    this.opts.smoothing = on;
    this.resetFilters();
  }

  reset(): void {
    this.resetFilters();
    this.scale.reset();
    this.viewTracker.reset();
    this.lastT = null;
    this.lastRawHip = null;
  }

  process(raw: RawPose): EngineFrame {
    const gap = this.lastT === null ? Infinity : raw.t - this.lastT;
    if (gap > this.opts.resetGapMs) {
      this.resetFilters();
      this.viewTracker.reset();
    }

    // Detect a switch to a different person before smoothing blends the two bodies together.
    const rawHip = this.rawHipMid(raw);
    const L = this.scale.value;
    const identityChanged =
      gap <= this.opts.resetGapMs &&
      rawHip !== null &&
      this.lastRawHip !== null &&
      L !== null &&
      dist2D(rawHip, this.lastRawHip) > this.opts.identityJump * L;
    if (identityChanged) {
      this.resetFilters();
      this.scale.reset();
      this.viewTracker.reset();
    }
    this.lastRawHip = rawHip;
    const dt = Number.isFinite(gap) && gap > 0 ? gap / 1000 : 1 / 30;
    this.lastT = raw.t;

    const px = this.track(raw.image, raw.image, this.pxFilters, dt, (lm) => toPixel(lm, raw.width, raw.height));
    const world =
      raw.world.length === LANDMARK_COUNT
        ? this.track(raw.world, raw.image, this.worldFilters, dt, (lm) => ({ x: lm.x, y: lm.y, z: lm.z }))
        : [];

    const hipMid = midpoint(px, LM.L_HIP, LM.R_HIP);
    const shoulderMid = midpoint(px, LM.L_SHOULDER, LM.R_SHOULDER);
    const legLength = this.scale.update(px);
    const torsoLength = hipMid && shoulderMid ? dist2D(hipMid, shoulderMid) : null;

    const body: BodyFrame = {
      t: raw.t,
      width: raw.width,
      height: raw.height,
      px,
      world,
      hipMid,
      shoulderMid,
      legLength,
      torsoLength,
      norm: normalizePoints(px, hipMid, legLength),
    };

    const spread = shoulderSpread(body);
    const view = this.viewTracker.update(classifyView(spread));
    return { body, features: computeFeatures(body, view, spread), identityChanged };
  }

  private rawHipMid(raw: RawPose): Point | null {
    const l = raw.image[LM.L_HIP], r = raw.image[LM.R_HIP];
    if (!l || !r || !isPresent(l) || !isPresent(r)) return null;
    return { x: ((l.x + r.x) / 2) * raw.width, y: ((l.y + r.y) / 2) * raw.height, z: 0 };
  }

  /** Validity always comes from the image landmarks: world landmarks have no reliable visibility of their own. */
  private track(
    lms: LandmarkLike[],
    image: LandmarkLike[],
    filters: PointFilter[],
    dt: number,
    toPoint: (lm: LandmarkLike) => Point,
  ): TrackedPoint[] {
    return lms.map((lm, i) => {
      const p = toPoint(lm);
      const f = this.opts.smoothing ? filters[i].filter(p, dt) : p;
      const ref = image[i] ?? lm;
      return { ...f, visibility: ref.visibility ?? 0, valid: isValid(ref), present: isPresent(ref) };
    });
  }

  private resetFilters(): void {
    this.pxFilters.forEach((f) => f.reset());
    this.worldFilters.forEach((f) => f.reset());
  }
}
