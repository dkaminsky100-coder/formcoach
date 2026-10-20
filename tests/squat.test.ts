import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/Engine';
import { SquatModel } from '../src/engine/exercises/squat';
import { simulate } from './helpers/simulate';
import { squatSequence, type RepSpec } from './helpers/squatSequence';

const deep: RepSpec = { bottomKnee: 85 };

describe('squat counting (side view)', () => {
  it('counts 5 good squats', () => {
    const { events, state } = simulate([deep, deep, deep, deep, deep]);
    expect(state.reps).toBe(5);
    expect(state.partials).toBe(0);
    expect(events.every((e) => e.counted)).toBe(true);
  });

  it('flags shallow squats with "go lower" instead of counting them', () => {
    const { events, state } = simulate([deep, { bottomKnee: 130 }, deep]);
    expect(state.reps).toBe(2);
    expect(state.partials).toBe(1);
    expect(events.map((e) => e.issue)).toEqual([null, 'shallow', null]);
  });

  it('respects the depth setting', () => {
    const half: RepSpec = { bottomKnee: 115 };
    expect(simulate([half, half], { view: 'side' }, 'parallel').state.reps).toBe(0);
    expect(simulate([half, half], { view: 'side' }, 'half').state.reps).toBe(2);
  });

  it('ignores small knee bends', () => {
    const { events } = simulate([{ bottomKnee: 160 }, { bottomKnee: 165 }]);
    expect(events).toHaveLength(0);
  });

  it('is robust to landmark jitter', () => {
    const { state } = simulate([deep, deep, deep, deep], { view: 'side', jitterDeg: 3 });
    expect(state.reps).toBe(4);
    expect(state.partials).toBe(0);
  });

  it('handles fast and slow tempos', () => {
    const fast: RepSpec = { bottomKnee: 85, downS: 0.5, pauseS: 0, upS: 0.4, restS: 0.5 };
    const slow: RepSpec = { bottomKnee: 85, downS: 3, pauseS: 1, upS: 2 };
    expect(simulate([fast, fast, slow, slow]).state.reps).toBe(4);
  });

  it('measures tempo per rep', () => {
    const { events } = simulate([{ bottomKnee: 85, downS: 2, pauseS: 0.5, upS: 1 }]);
    const [e] = events;
    expect(e.tDown).toBeGreaterThan(1.3);
    expect(e.tDown).toBeLessThan(2.4);
    expect(e.tUp).toBeGreaterThan(0.6);
    expect(e.tUp).toBeLessThan(1.4);
  });

  it('survives a brief detection dropout mid-rep', () => {
    const { state } = simulate([deep, deep], { view: 'side', dropouts: [[3500, 3800]] });
    expect(state.reps).toBe(2);
  });

  it('works at a different camera distance', () => {
    const { state } = simulate([deep, deep, deep], { view: 'side', scale: 230, offsetX: 150 });
    expect(state.reps).toBe(3);
  });
});

describe('squat counting (front view)', () => {
  it('counts squats facing the camera using 3D knee angles', () => {
    const { state } = simulate([deep, deep, deep], { view: 'front' });
    expect(state.reps).toBe(3);
  });
});

describe('SquatModel', () => {
  it('learns the standing knee angle', () => {
    const engine = new Engine();
    const model = new SquatModel();
    for (const f of squatSequence([deep], { view: 'side', standKnee: 165 })) {
      if (f.pose) model.progress(engine.process(f.pose));
    }
    expect(model.topAngle()).toBeGreaterThan(160);
    expect(model.topAngle()).toBeLessThan(167);
  });
});
