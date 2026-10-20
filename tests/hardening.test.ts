import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/Engine';
import { SquatModel } from '../src/engine/exercises/squat';
import { STRICTNESS } from '../src/engine/faults';
import { WorkoutTracker, type RepSummary } from '../src/engine/WorkoutTracker';
import { simulate } from './helpers/simulate';
import { squatSequence, type RepSpec } from './helpers/squatSequence';
import { synthPose } from './helpers/synthPose';

const deep: RepSpec = { bottomKnee: 85 };

describe('a different person stepping in', () => {
  it('is detected as an identity change, not a super-fast movement', () => {
    const engine = new Engine();
    let out = engine.process(synthPose({ view: 'side', t: 0 }));
    for (let i = 1; i < 20; i++) out = engine.process(synthPose({ view: 'side', t: i * 33 }));
    expect(out.identityChanged).toBe(false);
    out = engine.process(synthPose({ view: 'side', offsetX: 350, t: 20 * 33 }));
    expect(out.identityChanged).toBe(true);
  });

  it('does not trigger on normal fast movement', () => {
    const engine = new Engine();
    let changed = false;
    // 3 m/s sideways at 380 px/m ≈ 38 px per frame - fast, but human.
    for (let i = 0; i < 30; i++) {
      changed ||= engine.process(synthPose({ view: 'side', offsetX: -300 + i * 38, t: i * 33 })).identityChanged;
    }
    expect(changed).toBe(false);
  });

  it('drops the rep in progress instead of counting a mix of two people', () => {
    const engine = new Engine();
    const tracker = new WorkoutTracker(new SquatModel());
    const reps: RepSummary[] = [];
    for (const f of squatSequence([deep, deep], { view: 'side' })) {
      // Mid-way through the first rep, the model latches onto someone 1 m to the side.
      const swapped = f.t > 2600 && f.t < 3000 && f.pose ? synthPose({ view: 'side', kneeDeg: 175, offsetX: 380, t: f.t }) : f.pose;
      const { rep } = tracker.update(swapped ? engine.process(swapped) : null, f.t);
      if (rep) reps.push(rep);
    }
    expect(reps.filter((r) => r.counted)).toHaveLength(1); // only the clean second rep
  });
});

describe('strictness', () => {
  // Just over the "knees caving" threshold at normal strictness.
  const borderline: RepSpec = { bottomKnee: 85, faults: { kneeInM: 0.055 } };
  const run = (s: keyof typeof STRICTNESS) =>
    simulate([borderline], { view: 'front' }, 'parallel', (t) => (t.sensitivity = STRICTNESS[s])).events[0].faults;

  it('relaxed ignores a borderline fault that normal and strict flag', () => {
    expect(run('normal')).toContain('knee_valgus');
    expect(run('strict')).toContain('knee_valgus');
    expect(run('relaxed')).not.toContain('knee_valgus');
  });

  it('strict flags a milder fault that normal lets pass', () => {
    const mild: RepSpec = { bottomKnee: 85, faults: { kneeInM: 0.045 } };
    const faults = (s: keyof typeof STRICTNESS) =>
      simulate([mild], { view: 'front' }, 'parallel', (t) => (t.sensitivity = STRICTNESS[s])).events[0].faults;
    expect(faults('normal')).not.toContain('knee_valgus');
    expect(faults('strict')).toContain('knee_valgus');
  });
});
