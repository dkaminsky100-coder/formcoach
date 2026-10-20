import { LM } from '../../pose/landmarks';
import type { FaultDef } from '../faults';
import type { BodySide, EngineFrame, Features, View } from '../types';
import { AngleExercise } from './AngleExercise';
import type { DepthOption } from './ExerciseModel';
import { kneeValgus } from './squatFaults';

/** Torso lean from vertical (side view), degrees. Lunges keep the torso upright. */
export const LUNGE_LEAN_MAX = 20;

const torsoLean: FaultDef = {
  id: 'torso_lean',
  views: ['side'],
  minProgress: 0.3,
  measure({ features: f }) {
    if (f.trunkLean === null) return null;
    const side = f.nearSide ?? 'left';
    return {
      ratio: f.trunkLean / LUNGE_LEAN_MAX,
      joints: side === 'left' ? [LM.L_SHOULDER, LM.L_HIP] : [LM.R_SHOULDER, LM.R_HIP],
    };
  },
};

/**
 * Both knees bend to about 90° in a good lunge, so the measured knee (the near one side-on,
 * both in 3D facing the camera) tracks depth whichever leg is in front.
 */
export class LungeModel extends AngleExercise {
  readonly id = 'lunge';
  readonly name = 'Lunge';
  readonly counterLabel = 'LUNGES';
  readonly angleName = 'knee';
  readonly supportedViews: readonly View[] = ['side', 'front', 'oblique'];
  readonly calibrationViews: readonly View[] = ['side', 'front'];
  readonly viewHint = 'Turn side-on (best) or face the camera';
  readonly tip = 'Side-on checks: depth, stay upright. Facing the camera checks: front knee caving in.';
  readonly faults: readonly FaultDef[] = [torsoLean, kneeValgus];
  readonly depthOptions: readonly DepthOption[] = [
    { id: 'half', label: 'Half (knee 120°)', angle: 120 },
    { id: 'full', label: 'Full (knee 95°)', angle: 95 },
  ];
  protected readonly visibilityHint = 'Make sure your hips, knees and ankles are visible';
  protected readonly startHint = 'Stand up straight';

  constructor(depth = 'full') {
    super(depth);
  }

  protected angle(f: Features): number | null {
    return f.knee.primary;
  }

  /** Front leg: side-on, the foot further in the direction the user faces; facing the camera, the higher knee. */
  repSide({ body, features }: EngineFrame): BodySide | null {
    const { px, hipMid } = body;
    if (!hipMid) return null;
    if (features.view === 'side') {
      const nose = px[LM.NOSE];
      const l = px[LM.L_ANKLE], r = px[LM.R_ANKLE];
      if (!nose?.present || !l?.present || !r?.present) return null;
      const facing = Math.sign(nose.x - hipMid.x) || 1;
      return (l.x - hipMid.x) * facing >= (r.x - hipMid.x) * facing ? 'left' : 'right';
    }
    const l = px[LM.L_KNEE], r = px[LM.R_KNEE];
    if (!l?.present || !r?.present) return null;
    return l.y <= r.y ? 'left' : 'right';
  }
}
