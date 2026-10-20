import { LM } from '../../pose/landmarks';
import type { FaultDef } from '../faults';
import type { BodySide, EngineFrame, Features, TrackedPoint, View } from '../types';
import { AngleExercise } from './AngleExercise';
import type { DepthOption } from './ExerciseModel';

/** Hip below the shoulder→ankle line, ÷ leg length. */
export const HIP_SAG_MAX = 0.08;
/** Hip above the shoulder→ankle line, ÷ leg length. */
export const HIP_PIKE_MAX = 0.1;
/** Body must be at least this far from vertical to count as a plank (degrees). */
const PLANK_MIN_INCLINE = 55;

const SIDE = {
  left: { shoulder: LM.L_SHOULDER, hip: LM.L_HIP, ankle: LM.L_ANKLE },
  right: { shoulder: LM.R_SHOULDER, hip: LM.R_HIP, ankle: LM.R_ANKLE },
} as const;

/**
 * Hip height relative to the straight shoulder→ankle line, ÷ leg length.
 * Positive = hip below the line (sagging), negative = above (piking).
 */
export function hipLineOffset(frame: EngineFrame): { offset: number; side: BodySide } | null {
  const { px, legLength: L } = frame.body;
  const side: BodySide = frame.features.nearSide ?? 'left';
  const { shoulder, hip, ankle } = SIDE[side];
  const valid = (p: TrackedPoint | undefined) => !!p?.valid;
  if (!L || !valid(px[shoulder]) || !valid(px[hip]) || !valid(px[ankle])) return null;
  const s = px[shoulder], h = px[hip], a = px[ankle];
  const dx = a.x - s.x;
  if (Math.abs(dx) < L * 0.5) return null; // body not horizontal enough to judge
  const lineY = s.y + ((a.y - s.y) * (h.x - s.x)) / dx;
  return { offset: (h.y - lineY) / L, side }; // image y grows downward
}

const hipSag: FaultDef = {
  id: 'hip_sag',
  views: ['side'],
  minProgress: 0.2,
  measure(frame) {
    const r = hipLineOffset(frame);
    if (!r) return null;
    const { shoulder, hip, ankle } = SIDE[r.side];
    return { ratio: r.offset / HIP_SAG_MAX, joints: [hip], guides: [[shoulder, ankle]] };
  },
};

const hipPike: FaultDef = {
  id: 'hip_pike',
  views: ['side'],
  minProgress: 0.2,
  measure(frame) {
    const r = hipLineOffset(frame);
    if (!r) return null;
    const { shoulder, hip, ankle } = SIDE[r.side];
    return { ratio: -r.offset / HIP_PIKE_MAX, joints: [hip], guides: [[shoulder, ankle]] };
  },
};

export class PushupModel extends AngleExercise {
  readonly id = 'pushup';
  readonly name = 'Push-up';
  readonly counterLabel = 'PUSH-UPS';
  readonly angleName = 'elbow';
  readonly supportedViews: readonly View[] = ['side'];
  readonly calibrationViews: readonly View[] = ['side'];
  readonly viewHint = 'Turn side-on to the camera, head to one side';
  readonly tip = 'Side-on only. Checks: depth, hips sagging, hips too high.';
  readonly faults: readonly FaultDef[] = [hipSag, hipPike];
  readonly depthOptions: readonly DepthOption[] = [
    { id: 'half', label: 'Half (elbow 120°)', angle: 120 },
    { id: 'full', label: 'Full (elbow 90°)', angle: 90 },
    { id: 'deep', label: 'Chest to floor (elbow 70°)', angle: 70 },
  ];
  protected readonly visibilityHint = 'Make sure your shoulders, elbows and wrists are visible';
  protected readonly startHint = 'Get into a high plank, arms straight';
  protected readonly defaultTop = 168;

  constructor(depth = 'full') {
    super(depth);
  }

  protected angle(f: Features): number | null {
    return f.elbow.primary;
  }

  protected inStartPosition({ features }: EngineFrame): boolean {
    return features.trunkLean !== null && features.trunkLean >= PLANK_MIN_INCLINE;
  }
}
