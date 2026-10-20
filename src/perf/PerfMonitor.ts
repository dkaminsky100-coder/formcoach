import { RollingWindow } from '../engine/math/stats';
import type { ModelVariant } from '../pose/landmarker';

export { RollingWindow };

/** Events per second over the last second. */
export class RateCounter {
  private times: number[] = [];

  tick(t: number): void {
    this.times.push(t);
    while (this.times.length > 0 && t - this.times[0] > 1000) this.times.shift();
  }

  get rate(): number {
    const n = this.times.length;
    if (n < 2) return 0;
    const span = this.times[n - 1] - this.times[0];
    return span > 0 ? ((n - 1) * 1000) / span : 0;
  }
}

/** Quality steps tried in order when the machine can't keep up. `skip` = run inference every Nth frame. */
export interface QualityStep {
  model: ModelVariant;
  skip: number;
}

export const QUALITY_LADDER: readonly QualityStep[] = [
  { model: 'full', skip: 1 },
  { model: 'lite', skip: 1 },
  { model: 'lite', skip: 2 },
];

export interface PerfOptions {
  /** Inference time budget per processed frame at skip = 1 (ms). Scaled by `skip`. */
  budgetMs: number;
  /** How long p95 must stay over budget before downgrading (ms). */
  sustainMs: number;
  /** Minimum inference samples before judging. */
  minSamples: number;
  /** Inferences ignored after (re)loading a model: the first GPU runs compile shaders and take seconds. */
  warmupSamples: number;
}

export interface PerfSnapshot {
  cameraFps: number;
  inferenceFps: number;
  inferenceP50: number;
  inferenceP95: number;
}

export class PerfMonitor {
  private readonly opts: PerfOptions;
  private readonly inference = new RollingWindow(90);
  private readonly cameraRate = new RateCounter();
  private readonly inferenceRate = new RateCounter();
  private overBudgetSince: number | null = null;
  private warmupLeft: number;

  constructor(opts: Partial<PerfOptions> = {}) {
    this.opts = { budgetMs: 40, sustainMs: 3000, minSamples: 30, warmupSamples: 0, ...opts };
    this.warmupLeft = this.opts.warmupSamples;
  }

  recordCameraFrame(t: number): void {
    this.cameraRate.tick(t);
  }

  recordInference(ms: number, t: number): void {
    this.inferenceRate.tick(t);
    if (this.warmupLeft > 0) {
      this.warmupLeft--;
      return;
    }
    this.inference.push(ms);
  }

  snapshot(): PerfSnapshot {
    return {
      cameraFps: this.cameraRate.rate,
      inferenceFps: this.inferenceRate.rate,
      inferenceP50: this.inference.percentile(0.5),
      inferenceP95: this.inference.percentile(0.95),
    };
  }

  /** True once p95 inference time has exceeded the budget for `sustainMs`. */
  shouldDowngrade(t: number, skip: number): boolean {
    if (this.inference.length < this.opts.minSamples) return false;
    if (this.inference.percentile(0.95) <= this.opts.budgetMs * skip) {
      this.overBudgetSince = null;
      return false;
    }
    this.overBudgetSince ??= t;
    return t - this.overBudgetSince >= this.opts.sustainMs;
  }

  /** Call after changing quality so the new setting is judged on fresh samples. */
  resetInference(): void {
    this.inference.clear();
    this.overBudgetSince = null;
    this.warmupLeft = this.opts.warmupSamples;
  }
}
