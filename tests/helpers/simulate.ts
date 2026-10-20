import { Engine } from '../../src/engine/Engine';
import { SquatModel, type SquatDepth } from '../../src/engine/exercises/squat';
import { WorkoutTracker, type RepSummary, type WorkoutState } from '../../src/engine/WorkoutTracker';
import { squatSequence, type RepSpec, type SequenceOptions } from './squatSequence';

export interface SimFrame {
  t: number;
  state: WorkoutState;
  rep: RepSummary | null;
}

/** Runs the full pipeline (engine → squat model → rep FSM → form checks) over a synthetic set. */
export function simulate(
  reps: RepSpec[],
  opts: SequenceOptions = { view: 'side' },
  depth?: SquatDepth,
  setup?: (t: WorkoutTracker) => void,
) {
  const engine = new Engine();
  const tracker = new WorkoutTracker(new SquatModel(depth));
  setup?.(tracker);
  const events: RepSummary[] = [];
  const frames: SimFrame[] = [];
  for (const f of squatSequence(reps, opts)) {
    const frame = f.pose ? engine.process(f.pose) : null;
    const { state, rep } = tracker.update(frame, f.t);
    frames.push({ t: f.t, state, rep });
    if (rep) events.push(rep);
  }
  return { events, frames, state: tracker.state() };
}
