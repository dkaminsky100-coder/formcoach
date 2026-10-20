import type { FaultDef } from '../faults';
import type { Calibration } from '../setup';
import type { BodySide, EngineFrame, View } from '../types';

export type ExerciseId = 'squat' | 'pushup' | 'lunge';

export interface DepthOption {
  id: string;
  label: string;
  /** Joint angle at which the rep reaches target depth. */
  angle: number;
}

/** Whether the user is in the starting position (standing / plank) for calibration. */
export interface ReadyCheck {
  ok: boolean;
  message: string;
  /** The exercise's main joint angle, if measurable. */
  angle: number | null;
}

export interface ExerciseModel {
  readonly id: ExerciseId;
  readonly name: string;
  /** Label above the rep counter, e.g. "SQUATS". */
  readonly counterLabel: string;
  /** Joint driving progress, e.g. "knee". */
  readonly angleName: string;
  /** Views where reps can be counted. */
  readonly supportedViews: readonly View[];
  /** Views accepted for setup and calibration. */
  readonly calibrationViews: readonly View[];
  /** Shown when the camera angle is wrong. */
  readonly viewHint: string;
  /** One-line guidance under the video. */
  readonly tip: string;
  /** Per-frame form checks. */
  readonly faults: readonly FaultDef[];
  readonly depthOptions: readonly DepthOption[];
  /** Selected depth option id. */
  depth: string;
  /** 0 at the top of the movement, 1 at target depth (may exceed 1). Null when not measurable. */
  progress(frame: EngineFrame): number | null;
  readyPose(frame: EngineFrame): ReadyCheck;
  /** Use the user's measured starting posture for this view. */
  calibrate(cal: Calibration): void;
  isCalibrated(view: View): boolean;
  /** Joint angle at the top of the movement for `view` (calibrated or learned). */
  topAngle(view?: View): number;
  /** Which leg is working this rep (lunges). Sampled at the deepest point. */
  repSide?(frame: EngineFrame): BodySide | null;
  /** Human-readable target, e.g. "knee ≤ 95°". */
  targetLabel(): string;
  reset(): void;
}
