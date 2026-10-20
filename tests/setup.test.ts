import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine/Engine';
import { SquatModel } from '../src/engine/exercises/squat';
import { evaluateSetup, SetupFlow, type Calibration, type SetupStatus } from '../src/engine/setup';
import type { EngineFrame } from '../src/engine/types';
import { WorkoutTracker } from '../src/engine/WorkoutTracker';
import { squatSequence } from './helpers/squatSequence';
import { synthPose, type SynthOptions } from './helpers/synthPose';

const VIEWS = ['side', 'front'] as const;

/** Settles the engine on a pose and returns the last frame. */
function frameOf(opts: SynthOptions): EngineFrame {
  const engine = new Engine();
  let f!: EngineFrame;
  for (let i = 0; i < 30; i++) f = engine.process(synthPose({ ...opts, t: i * 33 }));
  return f;
}

const failing = (opts: SynthOptions, lum: number | null = 120) =>
  evaluateSetup(frameOf(opts), lum, VIEWS).filter((c) => !c.ok);

describe('setup checks', () => {
  it('all pass for a well-framed person', () => {
    expect(failing({ view: 'side' })).toEqual([]);
    expect(failing({ view: 'front' })).toEqual([]);
  });

  it('asks the user to step in when nobody is there', () => {
    const checks = evaluateSetup(null, 120, VIEWS);
    expect(checks[0]).toMatchObject({ id: 'person', ok: false, hint: 'Step in front of the camera' });
    expect(checks.slice(1).every((c) => !c.ok && c.hint === '')).toBe(true);
  });

  it('notices feet cut off at the bottom of the frame', () => {
    const [first] = failing({ view: 'side', groundMarginPx: -40 });
    expect(first.id).toBe('body');
    expect(first.hint).toMatch(/feet are cut off/);
  });

  it('asks the user to come closer or step back', () => {
    expect(failing({ view: 'side', scale: 180 }).map((c) => c.hint)).toEqual(['Come a bit closer']);
    expect(failing({ view: 'side', scale: 412, groundMarginPx: 55 }).map((c) => c.hint)).toEqual(['Step back a little']);
  });

  it('flags darkness and poor visibility', () => {
    expect(failing({ view: 'side' }, 20).map((c) => c.hint)).toEqual(['Too dark - turn on a light or face a window']);
    expect(failing({ view: 'front', visibility: 0.6 }).map((c) => c.id)).toEqual(['light']);
  });
});

describe('SetupFlow', () => {
  /** Runs the flow over a synthetic sequence; returns statuses and the calibration if produced. */
  function run(frames: Array<{ t: number; pose: ReturnType<typeof synthPose> | null }>, lum = 120) {
    const engine = new Engine();
    const flow = new SetupFlow(new SquatModel());
    const statuses: SetupStatus[] = [];
    let cal: Calibration | null = null;
    let doneAt: number | null = null;
    for (const f of frames) {
      const frame = f.pose ? engine.process(f.pose) : null;
      const r = flow.update(frame, lum, f.t);
      statuses.push(r.status);
      if (r.calibration) {
        cal = r.calibration;
        doneAt = f.t;
      }
    }
    return { statuses, cal, doneAt };
  }

  const still = (seconds: number, opts: Partial<SynthOptions> = {}) =>
    Array.from({ length: Math.round(seconds * 30) }, (_, i) => ({
      t: i * 33.3,
      pose: synthPose({ view: 'side', kneeDeg: 174, ...opts, t: i * 33.3 }),
    }));

  it('checks, then calibrates after a 2 s hold', () => {
    const { statuses, cal, doneAt } = run(still(5));
    const stages = statuses.map((s) => s.stage).filter((s, i, a) => s !== a[i - 1]);
    expect(stages).toEqual(['checking', 'calibrating', 'done']);
    expect(doneAt).toBeGreaterThan(2500);
    expect(doneAt).toBeLessThan(3800);
    expect(cal).not.toBeNull();
    expect(cal!.view).toBe('side');
    expect(cal!.topAngle).toBeCloseTo(174, 0);
    expect(cal!.legLength).toBeCloseTo(0.84 * 380, -1);
    expect(cal!.heelToe.left).not.toBeNull();
  });

  it('restarts the countdown if the user moves', () => {
    const frames = still(6).map((f) => {
      const s = f.t / 1000;
      // A squat-ish knee bend at 2.2 s, mid-calibration.
      const knee = s > 2.2 && s < 2.6 ? 155 : 174;
      return { t: f.t, pose: synthPose({ view: 'side', kneeDeg: knee, t: f.t }) };
    });
    const { doneAt } = run(frames);
    expect(doneAt).toBeGreaterThan(4400);
  });

  it('does not calibrate while crouched', () => {
    const { cal, statuses } = run(still(5, { kneeDeg: 120 }));
    expect(cal).toBeNull();
    expect(statuses.at(-1)!.message).toBe('Stand up straight');
  });

  it('goes back to checking if the user leaves the frame', () => {
    const frames = still(5).map((f) => (f.t > 1500 && f.t < 2500 ? { t: f.t, pose: null } : f));
    const { statuses, cal } = run(frames);
    const at2s = statuses[Math.round(2 * 30)];
    expect(at2s.stage).toBe('checking');
    expect(at2s.message).toBe('Step in front of the camera');
    expect(cal).toBeNull(); // not enough still time left afterwards
  });
});

describe('calibration in use', () => {
  it('uses the measured standing knee angle immediately', () => {
    const model = new SquatModel();
    expect(model.topAngle('side')).toBe(172); // default before any data
    model.calibrate({ view: 'side', topAngle: 166, legLength: 300, heelToe: { left: 5, right: null }, shift: null });
    expect(model.topAngle('side')).toBe(166);
    expect(model.topAngle('front')).toBe(172); // other view not calibrated
  });

  it('counts the first rep correctly for a user whose legs never fully straighten', () => {
    // Standing knee 160°: uncalibrated, the default 172° top makes standing read as part-way down.
    const tracker = new WorkoutTracker(new SquatModel());
    tracker.addCalibration({ view: 'side', topAngle: 160, legLength: 319, heelToe: { left: null, right: null }, shift: null });
    const engine = new Engine();
    let reps = 0;
    for (const f of squatSequence([{ bottomKnee: 88 }, { bottomKnee: 88 }], { view: 'side', standKnee: 160, leadInS: 0.5 })) {
      const { rep } = tracker.update(f.pose ? engine.process(f.pose) : null, f.t);
      if (rep?.counted) reps++;
    }
    expect(reps).toBe(2);
  });

  it('re-seeds heel baseline when returning to a calibrated view', () => {
    const tracker = new WorkoutTracker(new SquatModel());
    const front = frameOf({ view: 'front' });
    const side = frameOf({ view: 'side' });
    const heel = () =>
      (tracker as unknown as { baseline: { value: { heelToe: { left: number } } } }).baseline.value.heelToe.left;
    tracker.addCalibration({ view: 'side', topAngle: 174, legLength: 319, heelToe: { left: 12, right: 12 }, shift: null });
    tracker.update(side, 0);
    const afterSide = heel(); // seeded, then nudged toward the live standing value
    expect(tracker.isCalibrated('side')).toBe(true);
    expect(tracker.isCalibrated('front')).toBe(false);
    tracker.update(front, 33);
    expect(heel()).not.toBeCloseTo(afterSide, 3); // drifts while front-on
    tracker.update(side, 66);
    // Back side-on: restored from the calibration rather than continuing from the front-view drift.
    expect(heel()).toBeCloseTo(afterSide, 6);
  });
});
