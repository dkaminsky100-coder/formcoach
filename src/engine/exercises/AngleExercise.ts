import type { FaultDef } from '../faults';
import { RollingWindow } from '../math/stats';
import type { Calibration } from '../setup';
import type { EngineFrame, Features, View } from '../types';
import type { DepthOption, ExerciseId, ExerciseModel, ReadyCheck } from './ExerciseModel';

/** Progress is capped a little above target so going deeper still reads as "deeper". */
const MAX_PROGRESS = 1.3;
/** Main joint must be at least this straight to count as the start position. */
export const READY_MIN_ANGLE = 150;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * An exercise driven by one joint angle that bends and straightens.
 *   p = (θtop − θ) / (θtop − θtarget)
 * θtop (the angle at the start position) is calibrated per view, or learned as a high
 * percentile of recent angles, since most frames in a set are near the top.
 */
export abstract class AngleExercise implements ExerciseModel {
  abstract readonly id: ExerciseId;
  abstract readonly name: string;
  abstract readonly counterLabel: string;
  abstract readonly angleName: string;
  abstract readonly supportedViews: readonly View[];
  abstract readonly calibrationViews: readonly View[];
  abstract readonly viewHint: string;
  abstract readonly tip: string;
  abstract readonly faults: readonly FaultDef[];
  abstract readonly depthOptions: readonly DepthOption[];
  /** Shown when the joints needed for the main angle aren't visible. */
  protected abstract readonly visibilityHint: string;
  /** Shown when visible but not in the start position. */
  protected abstract readonly startHint: string;

  protected readonly defaultTop: number = 172;
  private readonly history = new RollingWindow(300);
  private readonly calibratedTop = new Map<View, number>();

  constructor(public depth: string) {}

  /** The exercise's main joint angle (degrees, 180 = straight). */
  protected abstract angle(features: Features): number | null;

  /** Extra start-position requirement beyond a straight main joint (e.g. body horizontal). */
  protected inStartPosition(_frame: EngineFrame): boolean {
    return true;
  }

  get targetAngle(): number {
    return (this.depthOptions.find((d) => d.id === this.depth) ?? this.depthOptions[0]).angle;
  }

  topAngle(view?: View): number {
    const cal = view && this.calibratedTop.get(view);
    if (cal) return clamp(cal, READY_MIN_ANGLE, 180);
    if (this.history.length < 15) return this.defaultTop;
    return clamp(this.history.percentile(0.95), READY_MIN_ANGLE, 180);
  }

  isCalibrated(view: View): boolean {
    return this.calibratedTop.has(view);
  }

  calibrate(cal: Calibration): void {
    this.calibratedTop.set(cal.view, cal.topAngle);
  }

  progress({ features }: EngineFrame): number | null {
    if (!this.supportedViews.includes(features.view)) return null;
    const a = this.angle(features);
    if (a === null) return null;
    this.history.push(a);
    const top = this.topAngle(features.view);
    return clamp((top - a) / (top - this.targetAngle), 0, MAX_PROGRESS);
  }

  readyPose(frame: EngineFrame): ReadyCheck {
    const a = this.angle(frame.features);
    if (a === null) return { ok: false, message: this.visibilityHint, angle: null };
    if (a < READY_MIN_ANGLE || !this.inStartPosition(frame)) return { ok: false, message: this.startHint, angle: a };
    return { ok: true, message: '', angle: a };
  }

  targetLabel(): string {
    return `${this.angleName} ≤ ${this.targetAngle}°`;
  }

  reset(): void {
    this.history.clear();
    this.calibratedTop.clear();
  }
}
