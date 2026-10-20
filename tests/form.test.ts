import { describe, expect, it } from 'vitest';
import { FaultMonitor, repScore, type FaultDef } from '../src/engine/faults';
import { TEMPO_PRESETS } from '../src/engine/tempo';
import { simulate } from './helpers/simulate';
import type { RepSpec } from './helpers/squatSequence';

const clean: RepSpec = { bottomKnee: 85 };

describe('squat form checks', () => {
  it('clean squats score 100 in both views', () => {
    for (const view of ['side', 'front'] as const) {
      const { events } = simulate([clean, clean, clean], { view });
      expect(events.map((e) => e.faults)).toEqual([[], [], []]);
      expect(events.map((e) => e.score)).toEqual([100, 100, 100]);
    }
  });

  it('detects knees caving in (front view)', () => {
    const valgus: RepSpec = { bottomKnee: 85, faults: { kneeInM: 0.09 } };
    const { events, frames } = simulate([clean, valgus, clean], { view: 'front' });
    expect(events.map((e) => e.faults)).toEqual([[], ['knee_valgus'], []]);
    expect(events[1].score).toBe(75);
    // Live: active mid-rep, with the knee highlighted and the hip→ankle guide drawn.
    const live = frames.find((f) => f.state.activeFaults.length > 0)!.state.activeFaults[0];
    expect(live.id).toBe('knee_valgus');
    expect(live.cue).toBe('Knees out');
    expect(live.guides.length).toBe(1);
  });

  it('ignores mild knee movement within tolerance', () => {
    const { events } = simulate([{ bottomKnee: 85, faults: { kneeInM: 0.02 } }], { view: 'front' });
    expect(events[0].faults).toEqual([]);
  });

  it('does not judge knee tracking from the side (it cannot be seen)', () => {
    const { events } = simulate([{ bottomKnee: 85, faults: { kneeInM: 0.09 } }], { view: 'side' });
    expect(events[0].faults).not.toContain('knee_valgus');
  });

  it('detects excessive forward lean (side view)', () => {
    const { events } = simulate([clean, { bottomKnee: 85, faults: { extraLeanDeg: 40 } }], { view: 'side' });
    expect(events.map((e) => e.faults)).toEqual([[], ['forward_lean']]);
  });

  it('detects heels lifting (side view)', () => {
    const { events } = simulate([clean, { bottomKnee: 85, faults: { heelLiftM: 0.05 } }], { view: 'side' });
    expect(events.map((e) => e.faults)).toEqual([[], ['heel_lift']]);
  });

  it('detects shifting to one side (front view)', () => {
    const { events } = simulate([clean, { bottomKnee: 85, faults: { hipShiftM: 0.08 } }], { view: 'front' });
    expect(events.map((e) => e.faults)).toEqual([[], ['weight_shift']]);
  });

  it('combines several faults in one score', () => {
    const bad: RepSpec = { bottomKnee: 85, faults: { kneeInM: 0.09, hipShiftM: 0.08 } };
    const { events } = simulate([bad], { view: 'front' });
    expect(new Set(events[0].faults)).toEqual(new Set(['knee_valgus', 'weight_shift']));
    expect(events[0].score).toBe(60);
  });

  it('averages scores across the set', () => {
    const valgus: RepSpec = { bottomKnee: 85, faults: { kneeInM: 0.09 } };
    const { state } = simulate([clean, valgus], { view: 'front' });
    expect(state.avgScore).toBeCloseTo(87.5, 5);
  });
});

describe('tempo', () => {
  const withTempo = (preset: keyof typeof TEMPO_PRESETS) => (t: { tempo: unknown }) => {
    t.tempo = TEMPO_PRESETS[preset];
  };

  it('flags a fast descent against the 2-0-1 target', () => {
    const fast: RepSpec = { bottomKnee: 85, downS: 0.6, upS: 0.8 };
    const slow: RepSpec = { bottomKnee: 85, downS: 2.2, upS: 1 };
    const { events } = simulate([fast, slow], { view: 'side' }, 'parallel', withTempo('standard'));
    expect(events.map((e) => e.faults)).toEqual([['fast_descent'], []]);
  });

  it('flags a missing pause against the 3-1-1 target', () => {
    const noPause: RepSpec = { bottomKnee: 85, downS: 3, pauseS: 0, upS: 1 };
    const paused: RepSpec = { bottomKnee: 85, downS: 3, pauseS: 1.2, upS: 1 };
    const { events } = simulate([noPause, paused], { view: 'side' }, 'parallel', withTempo('controlled'));
    expect(events.map((e) => e.faults)).toEqual([['no_pause'], []]);
  });

  it('does not judge tempo in free mode', () => {
    const { events } = simulate([{ bottomKnee: 85, downS: 0.5, upS: 0.5 }], { view: 'side' });
    expect(events[0].faults).toEqual([]);
  });
});

describe('FaultMonitor', () => {
  const ctx = { phase: 'bottom' as const, progress: 1, baseline: { heelToe: { left: null, right: null }, shift: null } };
  const fakeFrame = { features: { view: 'front' } } as never;
  let ratio = 0;
  const def: FaultDef = { id: 'knee_valgus', views: ['front'], minProgress: 0.3, measure: () => ({ ratio, joints: [] }) };

  it('needs the fault to persist before turning on, and clears with hysteresis', () => {
    const m = new FaultMonitor([def], { onsetMs: 150, clearRatio: 0.8 });
    ratio = 1.2;
    expect(m.update(fakeFrame, ctx, 0)).toHaveLength(0);
    expect(m.update(fakeFrame, ctx, 100)).toHaveLength(0);
    expect(m.update(fakeFrame, ctx, 160)).toHaveLength(1);
    ratio = 0.9; // below threshold but above clear ratio: stays on
    expect(m.update(fakeFrame, ctx, 200)).toHaveLength(1);
    ratio = 0.5;
    expect(m.update(fakeFrame, ctx, 233)).toHaveLength(0);
  });

  it('ignores a single-frame spike', () => {
    const m = new FaultMonitor([def]);
    ratio = 0.2;
    m.update(fakeFrame, ctx, 0);
    ratio = 3;
    m.update(fakeFrame, ctx, 33);
    ratio = 0.2;
    expect(m.update(fakeFrame, ctx, 66)).toHaveLength(0);
    m.beginRep();
    expect(m.endRep()).toEqual([]);
  });

  it('is not evaluated at the top or before minimum depth', () => {
    const m = new FaultMonitor([def], { onsetMs: 0 });
    ratio = 5;
    expect(m.update(fakeFrame, { ...ctx, phase: 'top' }, 0)).toHaveLength(0);
    expect(m.update(fakeFrame, { ...ctx, progress: 0.1 }, 33)).toHaveLength(0);
  });
});

describe('repScore', () => {
  it('deducts each distinct fault once', () => {
    expect(repScore([])).toBe(100);
    expect(repScore(['knee_valgus', 'knee_valgus'])).toBe(75);
    expect(repScore(['knee_valgus', 'forward_lean', 'heel_lift', 'weight_shift', 'fast_descent', 'no_pause'])).toBe(10);
  });
});
