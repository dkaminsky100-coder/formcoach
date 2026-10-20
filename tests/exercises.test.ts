import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/Engine';
import { createExercise } from '../src/engine/exercises';
import type { ExerciseModel } from '../src/engine/exercises/ExerciseModel';
import { LungeModel } from '../src/engine/exercises/lunge';
import { hipLineOffset, PushupModel } from '../src/engine/exercises/pushup';
import { evaluateSetup, SetupFlow, type Calibration } from '../src/engine/setup';
import type { EngineFrame, RawPose } from '../src/engine/types';
import { WorkoutTracker, type RepSummary } from '../src/engine/WorkoutTracker';
import { LM } from '../src/pose/landmarks';
import { squatSequence, type RepSpec } from './helpers/squatSequence';
import { synthPose } from './helpers/synthPose';
import { synthPushup } from './helpers/synthPushup';

// ── Push-up timeline ──────────────────────────────────────────────────────────

interface PushRep {
  bottomElbow: number;
  downS?: number;
  upS?: number;
  hipDropM?: number;
}

/** Plank → down → up → plank for each rep, cosine-eased, 30 fps. */
function pushupFrames(reps: PushRep[], top = 172, lead = 2): Array<{ t: number; pose: RawPose }> {
  const keys: Array<{ t: number; e: number; drop: number }> = [
    { t: 0, e: top, drop: 0 },
    { t: lead, e: top, drop: 0 },
  ];
  let t = lead;
  for (const r of reps) {
    t += r.downS ?? 1.2;
    keys.push({ t, e: r.bottomElbow, drop: r.hipDropM ?? 0 });
    t += 0.2;
    keys.push({ t, e: r.bottomElbow, drop: r.hipDropM ?? 0 });
    t += r.upS ?? 1;
    keys.push({ t, e: top, drop: 0 });
    t += 1;
    keys.push({ t, e: top, drop: 0 });
  }
  const frames: Array<{ t: number; pose: RawPose }> = [];
  for (let i = 0; i / 30 <= t + 0.5; i++) {
    const s = i / 30;
    const k = keys.findIndex((x) => x.t >= s);
    const b = keys[k === -1 ? keys.length - 1 : k];
    const a = keys[Math.max(0, (k === -1 ? keys.length : k) - 1)];
    const u = b.t === a.t ? 1 : Math.min(1, (s - a.t) / (b.t - a.t));
    const w = (1 - Math.cos(Math.PI * u)) / 2;
    const ms = s * 1000;
    frames.push({
      t: ms,
      pose: synthPushup({ elbowDeg: a.e + (b.e - a.e) * w, hipDropM: a.drop + (b.drop - a.drop) * w, t: ms }),
    });
  }
  return frames;
}

function run(model: ExerciseModel, frames: Array<{ t: number; pose: RawPose | null }>) {
  const engine = new Engine();
  const tracker = new WorkoutTracker(model);
  const reps: RepSummary[] = [];
  for (const f of frames) {
    const { rep } = tracker.update(f.pose ? engine.process(f.pose) : null, f.t);
    if (rep) reps.push(rep);
  }
  return { reps, state: tracker.state() };
}

function settle(pose: (t: number) => RawPose): EngineFrame {
  const engine = new Engine();
  let f!: EngineFrame;
  for (let i = 0; i < 30; i++) f = engine.process(pose(i * 33));
  return f;
}

describe('push-ups', () => {
  it('sees a plank as a side view with the elbow angle measured', () => {
    const f = settle((t) => synthPushup({ elbowDeg: 120, t }));
    expect(f.features.view).toBe('side');
    expect(f.features.elbow.primary!).toBeCloseTo(120, 0);
    expect(f.features.trunkLean!).toBeGreaterThan(70);
  });

  it('counts 5 full push-ups', () => {
    const r: PushRep = { bottomElbow: 80 };
    const { reps, state } = run(new PushupModel(), pushupFrames([r, r, r, r, r]));
    expect(state.reps).toBe(5);
    expect(reps.every((x) => x.counted && x.faults.length === 0)).toBe(true);
  });

  it('flags half push-ups as "go lower"', () => {
    const { reps } = run(new PushupModel(), pushupFrames([{ bottomElbow: 80 }, { bottomElbow: 125 }]));
    expect(reps.map((x) => x.issue)).toEqual([null, 'shallow']);
  });

  it('detects sagging hips', () => {
    const { reps } = run(new PushupModel(), pushupFrames([{ bottomElbow: 80 }, { bottomElbow: 80, hipDropM: 0.12 }]));
    expect(reps.map((x) => x.faults)).toEqual([[], ['hip_sag']]);
  });

  it('detects piked hips', () => {
    const { reps } = run(new PushupModel(), pushupFrames([{ bottomElbow: 80, hipDropM: -0.15 }]));
    expect(reps[0].faults).toEqual(['hip_pike']);
  });

  it('measures the hip line offset with the right sign', () => {
    const sag = settle((t) => synthPushup({ elbowDeg: 170, hipDropM: 0.1, t }));
    const pike = settle((t) => synthPushup({ elbowDeg: 170, hipDropM: -0.1, t }));
    expect(hipLineOffset(sag)!.offset).toBeGreaterThan(0.08);
    expect(hipLineOffset(pike)!.offset).toBeLessThan(-0.08);
  });

  it('does not count squats as push-ups (standing is not a plank start)', () => {
    const model = new PushupModel();
    const frame = settle((t) => synthPose({ view: 'side', kneeDeg: 175, t }));
    expect(model.readyPose(frame).ok).toBe(false);
    expect(model.readyPose(frame).message).toBe('Get into a high plank, arms straight');
  });

  it('only works side-on', () => {
    const model = new PushupModel();
    expect(model.progress(settle((t) => synthPose({ view: 'front', t })))).toBeNull();
  });

  it('passes setup checks and calibrates in a plank', () => {
    const model = new PushupModel();
    const plank = settle((t) => synthPushup({ elbowDeg: 172, t }));
    expect(evaluateSetup(plank, 120, model.calibrationViews, model.viewHint).filter((c) => !c.ok)).toEqual([]);

    const engine = new Engine();
    const flow = new SetupFlow(model);
    let cal: Calibration | null = null;
    for (let i = 0; i < 150 && !cal; i++) {
      cal = flow.update(engine.process(synthPushup({ elbowDeg: 172, t: i * 33 })), 120, i * 33).calibration;
    }
    expect(cal).not.toBeNull();
    expect(cal!.topAngle).toBeCloseTo(172, 0);
  });
});

describe('lunges', () => {
  const lunge: RepSpec = { bottomKnee: 90 };

  it('counts lunges in both views', () => {
    for (const view of ['side', 'front'] as const) {
      const { state } = run(new LungeModel(), squatSequence([lunge, lunge, lunge], { view }));
      expect(state.reps).toBe(3);
    }
  });

  it('flags leaning forward (lunges stay upright)', () => {
    const upright: RepSpec = { bottomKnee: 90 };
    const leaning: RepSpec = { bottomKnee: 90, faults: { extraLeanDeg: 25 } };
    const frames = squatSequence([upright, leaning], { view: 'side', uprightTorso: true });
    const { reps } = run(new LungeModel(), frames);
    expect(reps.map((r) => r.faults)).toEqual([[], ['torso_lean']]);
  });

  it('identifies the front leg', () => {
    const model = new LungeModel();
    // Side view, facing image right: shift the left foot forward and the right foot back.
    const split = (t: number) => {
      const p = synthPose({ view: 'side', kneeDeg: 175, t });
      const dx = 0.12;
      for (const i of [LM.L_ANKLE, LM.L_HEEL, LM.L_FOOT]) p.image[i].x += dx;
      for (const i of [LM.R_ANKLE, LM.R_HEEL, LM.R_FOOT]) p.image[i].x -= dx;
      return p;
    };
    expect(model.repSide(settle(split))).toBe('left');

    const mirrored = (t: number) => {
      const p = split(t);
      for (const lm of p.image) lm.x = 1 - lm.x; // now facing image left
      return p;
    };
    expect(model.repSide(settle(mirrored))).toBe('left');
  });

  it('counts per leg', () => {
    const model = new LungeModel();
    let calls = 0;
    model.repSide = () => (calls++ % 2 === 0 ? 'left' : 'right');
    const { state, reps } = run(model, squatSequence([lunge, lunge, lunge], { view: 'side' }));
    expect(reps.every((r) => r.side !== null)).toBe(true);
    expect(state.legCounts!.left + state.legCounts!.right).toBe(3);
  });

  it('squats have no per-leg counts', () => {
    expect(run(createExercise('squat'), squatSequence([lunge], { view: 'side' })).state.legCounts).toBeNull();
  });
});
