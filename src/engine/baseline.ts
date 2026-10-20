import { LM } from '../pose/landmarks';
import type { Baseline } from './faults';
import type { BodySide, EngineFrame, TrackedPoint } from './types';

const valid = (pts: TrackedPoint[], ...idx: number[]) => idx.every((i) => pts[i]?.valid);

/** Hip midpoint offset from the ankle midpoint, ÷ stance width. Null if feet aren't apart enough to judge. */
export function lateralShift(px: TrackedPoint[], legLength: number | null): number | null {
  if (!legLength || !valid(px, LM.L_HIP, LM.R_HIP, LM.L_ANKLE, LM.R_ANKLE)) return null;
  const stance = Math.abs(px[LM.L_ANKLE].x - px[LM.R_ANKLE].x);
  if (stance < legLength * 0.1) return null;
  const hipX = (px[LM.L_HIP].x + px[LM.R_HIP].x) / 2;
  const ankleX = (px[LM.L_ANKLE].x + px[LM.R_ANKLE].x) / 2;
  return (hipX - ankleX) / stance;
}

/** toe.y − heel.y for one side (px). Grows when the heel lifts. */
export function heelToe(px: TrackedPoint[], side: BodySide): number | null {
  const [heel, foot] = side === 'left' ? [LM.L_HEEL, LM.L_FOOT] : [LM.R_HEEL, LM.R_FOOT];
  return valid(px, heel, foot) ? px[foot].y - px[heel].y : null;
}

/** Weight of each new standing sample in the running average. */
const ALPHA = 0.1;

const blend = (prev: number | null, next: number | null) =>
  next === null ? prev : prev === null ? next : prev + ALPHA * (next - prev);

/** Learns the user's standing posture (heel height, hip centring) while they're at the top. */
export class BaselineTracker {
  readonly value: Baseline = { heelToe: { left: null, right: null }, shift: null };

  observe({ body }: EngineFrame): void {
    const v = this.value;
    v.heelToe.left = blend(v.heelToe.left, heelToe(body.px, 'left'));
    v.heelToe.right = blend(v.heelToe.right, heelToe(body.px, 'right'));
    v.shift = blend(v.shift, lateralShift(body.px, body.legLength));
  }

  /** Start from measured values (calibration) instead of learning from scratch. */
  seed(from: Baseline): void {
    if (from.heelToe.left !== null) this.value.heelToe.left = from.heelToe.left;
    if (from.heelToe.right !== null) this.value.heelToe.right = from.heelToe.right;
    if (from.shift !== null) this.value.shift = from.shift;
  }

  reset(): void {
    this.value.heelToe.left = null;
    this.value.heelToe.right = null;
    this.value.shift = null;
  }
}
