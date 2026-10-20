import { LM } from '../../pose/landmarks';
import { heelToe, lateralShift } from '../baseline';
import type { FaultDef, FaultReading } from '../faults';
import type { BodySide, TrackedPoint } from '../types';

// Thresholds are starting defaults, expressed as fractions of leg length (L) or degrees.
// Tune them against recordings (M8).

/** Knee drifting toward the midline from the hip→ankle line (front view), ÷ L. */
export const VALGUS_MAX = 0.06;
/** Trunk lean beyond shin angle (side view), degrees. Torso roughly parallel to shins is fine. */
export const LEAN_EXCESS_MAX = 25;
/** Heel rising relative to toe vs standing (side view), ÷ L. */
export const HEEL_RISE_MAX = 0.03;
/** Hips moving sideways over the feet vs standing (front view), ÷ stance width. */
export const SHIFT_MAX = 0.15;

const LEG = {
  left: { hip: LM.L_HIP, knee: LM.L_KNEE, ankle: LM.L_ANKLE, heel: LM.L_HEEL, foot: LM.L_FOOT, shoulder: LM.L_SHOULDER },
  right: { hip: LM.R_HIP, knee: LM.R_KNEE, ankle: LM.R_ANKLE, heel: LM.R_HEEL, foot: LM.R_FOOT, shoulder: LM.R_SHOULDER },
} as const;

const valid = (pts: TrackedPoint[], ...idx: number[]) => idx.every((i) => pts[i]?.valid);

export const kneeValgus: FaultDef = {
  id: 'knee_valgus',
  views: ['front'],
  minProgress: 0.3,
  measure({ body }) {
    const { px, legLength: L, hipMid } = body;
    if (!L || !hipMid) return null;
    let worst: FaultReading | null = null;
    for (const side of ['left', 'right'] as const) {
      const { hip, knee, ankle } = LEG[side];
      if (!valid(px, hip, knee, ankle)) continue;
      const h = px[hip], k = px[knee], a = px[ankle];
      const dy = a.y - h.y;
      if (dy < L * 0.1) continue;
      // Where the straight hip→ankle line passes at knee height.
      const lineX = h.x + ((a.x - h.x) * (k.y - h.y)) / dy;
      const medial = Math.sign(hipMid.x - h.x) || 1;
      const ratio = ((k.x - lineX) * medial) / L / VALGUS_MAX;
      if (!worst || ratio > worst.ratio) worst = { ratio, joints: [knee], guides: [[hip, ankle]] };
    }
    return worst;
  },
};

export const forwardLean: FaultDef = {
  id: 'forward_lean',
  views: ['side'],
  minProgress: 0.3,
  measure({ features: f }) {
    if (f.trunkLean === null) return null;
    const side: BodySide = f.nearSide ?? 'left';
    const shin = f.shin[side];
    if (shin === null) return null;
    return {
      ratio: (f.trunkLean - shin) / LEAN_EXCESS_MAX,
      joints: [LEG[side].shoulder, LEG[side].hip],
    };
  },
};

export const heelLift: FaultDef = {
  id: 'heel_lift',
  views: ['side'],
  minProgress: 0.3,
  measure({ body, features }, { baseline }) {
    const side: BodySide = features.nearSide ?? 'left';
    const base = baseline.heelToe[side];
    const now = heelToe(body.px, side);
    const L = body.legLength;
    if (base === null || now === null || !L) return null;
    return { ratio: (now - base) / L / HEEL_RISE_MAX, joints: [LEG[side].heel, LEG[side].foot] };
  },
};

export const weightShift: FaultDef = {
  id: 'weight_shift',
  views: ['front'],
  minProgress: 0.3,
  measure({ body }, { baseline }) {
    const shift = lateralShift(body.px, body.legLength);
    if (shift === null || baseline.shift === null) return null;
    return { ratio: Math.abs(shift - baseline.shift) / SHIFT_MAX, joints: [LM.L_HIP, LM.R_HIP] };
  },
};

export const SQUAT_FAULTS: readonly FaultDef[] = [kneeValgus, forwardLean, heelLift, weightShift];
