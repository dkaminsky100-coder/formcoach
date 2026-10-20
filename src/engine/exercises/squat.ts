import type { Features, View } from '../types';
import { AngleExercise } from './AngleExercise';
import type { DepthOption } from './ExerciseModel';
import { SQUAT_FAULTS } from './squatFaults';

/** Interior knee angle at which the squat reaches target depth. */
export const SQUAT_DEPTHS = {
  half: 120,
  parallel: 95,
  deep: 80,
} as const;

export type SquatDepth = keyof typeof SQUAT_DEPTHS;

export class SquatModel extends AngleExercise {
  readonly id = 'squat';
  readonly name = 'Squat';
  readonly counterLabel = 'SQUATS';
  readonly angleName = 'knee';
  readonly supportedViews: readonly View[] = ['side', 'front', 'oblique'];
  readonly calibrationViews: readonly View[] = ['side', 'front'];
  readonly viewHint = 'Turn side-on (best for depth) or face the camera';
  readonly tip = 'Side-on checks: depth, chest up, heels down. Facing the camera checks: knees out, even weight.';
  readonly faults = SQUAT_FAULTS;
  readonly depthOptions: readonly DepthOption[] = [
    { id: 'half', label: `Half (knee ${SQUAT_DEPTHS.half}°)`, angle: SQUAT_DEPTHS.half },
    { id: 'parallel', label: `Parallel (knee ${SQUAT_DEPTHS.parallel}°)`, angle: SQUAT_DEPTHS.parallel },
    { id: 'deep', label: `Deep (knee ${SQUAT_DEPTHS.deep}°)`, angle: SQUAT_DEPTHS.deep },
  ];
  protected readonly visibilityHint = 'Make sure your hips, knees and ankles are visible';
  protected readonly startHint = 'Stand up straight';

  constructor(depth: SquatDepth = 'parallel') {
    super(depth);
  }

  protected angle(f: Features): number | null {
    return f.knee.primary;
  }
}
