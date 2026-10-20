import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/Engine';
import type { EngineFrame } from '../src/engine/types';
import { classifyView, ViewTracker } from '../src/engine/view';
import { LM } from '../src/pose/landmarks';
import { synthPose, type SynthOptions } from './helpers/synthPose';

/** Feeds the same pose for ~1 s so view confirmation and leg-length estimates settle. */
function settle(opts: SynthOptions, engine = new Engine()): EngineFrame {
  let out!: EngineFrame;
  for (let i = 0; i < 30; i++) out = engine.process(synthPose({ ...opts, t: (opts.t ?? 0) + i * 33 }));
  return out;
}

describe('view classification', () => {
  it('thresholds', () => {
    expect(classifyView(0.85)).toBe('front');
    expect(classifyView(0.05)).toBe('side');
    expect(classifyView(0.4)).toBe('oblique');
    expect(classifyView(null)).toBe('unknown');
  });

  it('needs consecutive frames to switch', () => {
    const v = new ViewTracker(3);
    expect(v.update('front')).toBe('unknown');
    expect(v.update('front')).toBe('unknown');
    expect(v.update('front')).toBe('front');
    expect(v.update('side')).toBe('front'); // a single noisy frame doesn't flip it
    expect(v.update('front')).toBe('front');
  });

  it('detects front and side from synthetic poses', () => {
    expect(settle({ view: 'front' }).features.view).toBe('front');
    expect(settle({ view: 'side' }).features.view).toBe('side');
  });
});

describe('side view features', () => {
  it.each([170, 135, 90, 70])('measures a %i° knee from 2D', (kneeDeg) => {
    const f = settle({ view: 'side', kneeDeg }).features;
    expect(f.knee.source).toBe('2d');
    expect(f.knee.primary!).toBeCloseTo(kneeDeg, 1);
  });

  it('uses the near (camera-facing) side', () => {
    const f = settle({ view: 'side', kneeDeg: 100, farSideVisibility: 0.3 }).features;
    expect(f.nearSide).toBe('left');
    expect(f.knee.right).toBeNull(); // far leg not visible enough to measure
    expect(f.knee.primary!).toBeCloseTo(100, 1);
  });

  it('measures trunk lean and elbow angle', () => {
    const f = settle({ view: 'side', kneeDeg: 100, trunkLeanDeg: 35, elbowDeg: 120 }).features;
    expect(f.trunkLean!).toBeCloseTo(35, 1);
    expect(f.elbow.primary!).toBeCloseTo(120, 1);
  });
});

describe('front view features', () => {
  it('uses 3D world angles because the 2D knee is foreshortened', () => {
    const out = settle({ view: 'front', kneeDeg: 100 });
    expect(out.features.knee.source).toBe('3d');
    expect(out.features.knee.primary!).toBeCloseTo(100, 1);
    expect(out.features.knee.left).toBeCloseTo(100, 1);
    expect(out.features.trunkLean!).toBeCloseTo(40, 1);
  });
});

describe('normalization', () => {
  it('gives the same normalized pose regardless of camera distance and position', () => {
    const near = settle({ view: 'side', kneeDeg: 110, scale: 380 }).body;
    const far = settle({ view: 'side', kneeDeg: 110, scale: 220, offsetX: -200 }).body;
    for (const i of [LM.L_SHOULDER, LM.L_KNEE, LM.L_ANKLE, LM.L_FOOT]) {
      expect(far.norm[i]!.x).toBeCloseTo(near.norm[i]!.x, 3);
      expect(far.norm[i]!.y).toBeCloseTo(near.norm[i]!.y, 3);
    }
  });

  it('estimates leg length in pixels', () => {
    const body = settle({ view: 'side', kneeDeg: 175, scale: 380 }).body;
    expect(body.legLength!).toBeCloseTo(0.84 * 380, 0);
  });
});

describe('Engine', () => {
  it('restarts smoothing after a tracking gap instead of sliding from stale positions', () => {
    const engine = new Engine();
    settle({ view: 'side', kneeDeg: 175, offsetX: -300 }, engine);
    const out = engine.process(synthPose({ view: 'side', kneeDeg: 175, offsetX: 300, t: 5000 }));
    const raw = synthPose({ view: 'side', kneeDeg: 175, offsetX: 300 });
    expect(out.body.px[LM.L_KNEE].x).toBeCloseTo(raw.image[LM.L_KNEE].x * raw.width, 6);
  });

  it('smooths jitter between consecutive frames', () => {
    const engine = new Engine();
    settle({ view: 'side', kneeDeg: 175 }, engine);
    const jumped = synthPose({ view: 'side', kneeDeg: 175, offsetX: 6, t: 30 * 33 });
    const out = engine.process(jumped);
    const rawX = jumped.image[LM.L_KNEE].x * jumped.width;
    expect(Math.abs(out.body.px[LM.L_KNEE].x - rawX)).toBeGreaterThan(2); // didn't jump the full 6 px
  });

  it('can turn smoothing off', () => {
    const engine = new Engine({ smoothing: false });
    settle({ view: 'side', kneeDeg: 175 }, engine);
    const jumped = synthPose({ view: 'side', kneeDeg: 175, offsetX: 6, t: 30 * 33 });
    const out = engine.process(jumped);
    expect(out.body.px[LM.L_KNEE].x).toBeCloseTo(jumped.image[LM.L_KNEE].x * jumped.width, 6);
  });
});
