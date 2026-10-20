import { LM } from '../pose/landmarks';
import { heelToe, lateralShift } from './baseline';
import { dist2D } from './math/vec';
import type { EngineFrame, Point, View } from './types';

// ── Setup checks ──────────────────────────────────────────────────────────────

export type CheckId = 'person' | 'body' | 'distance' | 'view' | 'light';

export interface SetupCheck {
  id: CheckId;
  label: string;
  ok: boolean;
  /** What to do about it (empty when ok or not yet judgeable). */
  hint: string;
}

export const SETUP_LIMITS = {
  /** Head and feet must be at least this far (fraction of frame) from the top / bottom edge. */
  edgeMargin: 0.03,
  /** Nose-to-feet height as a fraction of frame height. */
  minHeight: 0.45,
  maxHeight: 0.9,
  /** Mean frame brightness, 0-255. */
  minLuminance: 50,
  /** Mean visibility of shoulders, hips, knees and ankles. */
  minVisibility: 0.7,
};

const KEY_CHAIN = {
  left: [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE, LM.L_ANKLE],
  right: [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE, LM.R_ANKLE],
};
const FEET = [LM.L_HEEL, LM.R_HEEL, LM.L_FOOT, LM.R_FOOT, LM.L_ANKLE, LM.R_ANKLE];

const LABELS: Record<CheckId, string> = {
  person: 'Person detected',
  body: 'Whole body in view',
  distance: 'Good distance',
  view: 'Camera angle',
  light: 'Lighting',
};

/**
 * Pre-set checklist. `luminance` is the mean frame brightness (0-255), or null if unknown.
 * Checks after a failing prerequisite report not-ok without a hint, so the user fixes one thing at a time.
 */
export function evaluateSetup(
  frame: EngineFrame | null,
  luminance: number | null,
  views: readonly View[],
  viewHint = 'Turn side-on (best for depth) or face the camera',
): SetupCheck[] {
  const result: SetupCheck[] = [];
  const add = (id: CheckId, ok: boolean, hint = '') => result.push({ id, label: LABELS[id], ok, hint: ok ? '' : hint });

  if (!frame) {
    add('person', false, 'Step in front of the camera');
    (['body', 'distance', 'view', 'light'] as const).forEach((id) => add(id, false));
    return result;
  }
  add('person', true);

  const { px, width: W, height: H } = frame.body;
  const m = SETUP_LIMITS.edgeMargin;
  const inside = (p: Point) => p.x / W >= m && p.x / W <= 1 - m && p.y / H >= m && p.y / H <= 1 - m;
  const nose = px[LM.NOSE];
  const headOk = !!nose?.valid && inside(nose);
  const feet = FEET.map((i) => px[i]).filter((p) => p?.valid);
  const feetOk = feet.length >= 2 && feet.every(inside);
  const feetBelow = FEET.some((i) => (px[i]?.present ?? false) && px[i].y / H > 1 - m);
  const bodyOk = headOk && feetOk;
  add(
    'body',
    bodyOk,
    !headOk && !feetOk
      ? 'Step back so your whole body fits'
      : !headOk
        ? nose?.present && nose.y / H < m
          ? 'Your head is cut off - step back or tilt the camera up'
          : 'Your head is out of view - step back or move the camera'
        : feetBelow
          ? 'Your feet are cut off - step back or tilt the camera down'
          : 'Your feet are out of view - step back or move the camera',
  );

  if (bodyOk) {
    // Body size from its bounding box, so it works standing (tall) and in a plank (long). Both
    // directions are measured against frame height: a plank the same size as a standing person
    // covers less of a 16:9 frame's width. Too close only applies vertically; sideways, the
    // edge check above already catches a body that doesn't fit.
    const pts = [nose, ...feet];
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const tall = (Math.max(...ys) - Math.min(...ys)) / H;
    const size = Math.max(tall, (Math.max(...xs) - Math.min(...xs)) / H);
    const tooFar = size < SETUP_LIMITS.minHeight;
    const tooClose = tall > SETUP_LIMITS.maxHeight;
    add('distance', !tooFar && !tooClose, tooFar ? 'Come a bit closer' : 'Step back a little');
  } else {
    add('distance', false);
  }

  const view = frame.features.view;
  add('view', views.includes(view), view === 'unknown' ? 'Hold still…' : viewHint);

  // Best-seen side: side-on, the far side is hidden by the body, which isn't a lighting problem.
  const chainVis = (idx: number[]) => idx.reduce((s, i) => s + (px[i]?.visibility ?? 0), 0) / idx.length;
  const vis = Math.max(chainVis(KEY_CHAIN.left), chainVis(KEY_CHAIN.right));
  const dark = luminance !== null && luminance < SETUP_LIMITS.minLuminance;
  add(
    'light',
    !dark && vis >= SETUP_LIMITS.minVisibility,
    dark
      ? 'Too dark - turn on a light or face a window'
      : 'Hard to see you - improve lighting or wear clothes that contrast with the background',
  );
  return result;
}

// ── Calibration ───────────────────────────────────────────────────────────────

/** The user's start posture (standing / plank), measured while they hold still. */
export interface Calibration {
  view: View;
  /** Main joint angle at the start position (degrees) - the "top" of a rep. */
  topAngle: number;
  /** Leg length in px at calibration distance. */
  legLength: number;
  heelToe: { left: number | null; right: number | null };
  shift: number | null;
}

export const CALIBRATION = {
  durationMs: 2000,
  /** Movement that restarts the countdown. */
  maxAngleDrift: 8,
  maxHipDrift: 0.08,
};

interface Sample {
  angle: number;
  leg: number;
  heelL: number | null;
  heelR: number | null;
  shift: number | null;
}

function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export interface CalibrationStep {
  /** 0-1 through the hold. */
  progress: number;
  message: string;
  result: Calibration | null;
}

/** What the calibrator needs from an exercise: is the user in the start position, and at what angle. */
export interface StartPose {
  readyPose(frame: EngineFrame): { ok: boolean; message: string; angle: number | null };
}

/** Collects a still start position for `durationMs`; any real movement restarts the countdown. */
export class Calibrator {
  private start: number | null = null;
  private refAngle = 0;
  private refHip: Point = { x: 0, y: 0, z: 0 };
  private samples: Sample[] = [];

  constructor(private readonly exercise: StartPose) {}

  reset(): void {
    this.start = null;
    this.samples = [];
  }

  update(frame: EngineFrame, t: number): CalibrationStep {
    const ready = this.exercise.readyPose(frame);
    const L = frame.body.legLength;
    const hip = frame.body.hipMid;
    if (!ready.ok || ready.angle === null || !L || !hip) {
      this.reset();
      return { progress: 0, message: ready.message || 'Hold your start position', result: null };
    }
    const angle = ready.angle;

    const moved =
      this.start !== null &&
      (Math.abs(angle - this.refAngle) > CALIBRATION.maxAngleDrift ||
        dist2D(hip, this.refHip) / L > CALIBRATION.maxHipDrift);
    if (this.start === null || moved) {
      this.start = t;
      this.refAngle = angle;
      this.refHip = hip;
      this.samples = [];
    }

    const { px } = frame.body;
    this.samples.push({
      angle,
      leg: L,
      heelL: heelToe(px, 'left'),
      heelR: heelToe(px, 'right'),
      shift: lateralShift(px, L),
    });

    const progress = Math.min(1, (t - this.start) / CALIBRATION.durationMs);
    if (progress < 1) return { progress, message: moved ? 'Hold still' : 'Hold still…', result: null };

    const s = this.samples;
    const result: Calibration = {
      view: frame.features.view,
      topAngle: median(s.map((x) => x.angle))!,
      legLength: median(s.map((x) => x.leg))!,
      heelToe: { left: median(s.map((x) => x.heelL)), right: median(s.map((x) => x.heelR)) },
      shift: median(s.map((x) => x.shift)),
    };
    this.reset();
    return { progress: 1, message: 'Calibrated', result };
  }
}

// ── Flow: checklist → calibration → done ─────────────────────────────────────

export type SetupStage = 'checking' | 'calibrating' | 'done';

export interface SetupStatus {
  stage: SetupStage;
  checks: SetupCheck[];
  /** Calibration hold progress 0-1. */
  progress: number;
  message: string;
}

export interface SetupExercise extends StartPose {
  readonly calibrationViews: readonly View[];
  readonly viewHint: string;
}

export class SetupFlow {
  private stage: SetupStage = 'checking';
  private okSince: number | null = null;
  private progress = 0;
  private readonly calibrator: Calibrator;

  /** `readyMs`: how long every check must stay green before calibration starts. */
  constructor(
    private readonly exercise: SetupExercise,
    private readonly readyMs = 800,
  ) {
    this.calibrator = new Calibrator(exercise);
  }

  get current(): SetupStage {
    return this.stage;
  }

  reset(): void {
    this.stage = 'checking';
    this.okSince = null;
    this.progress = 0;
    this.calibrator.reset();
  }

  update(frame: EngineFrame | null, luminance: number | null, t: number): { status: SetupStatus; calibration: Calibration | null } {
    const checks = evaluateSetup(frame, luminance, this.exercise.calibrationViews, this.exercise.viewHint);
    const allOk = checks.every((c) => c.ok);
    const firstHint = checks.find((c) => !c.ok && c.hint)?.hint ?? '';
    const status = (message: string): SetupStatus => ({ stage: this.stage, checks, progress: this.progress, message });

    if (this.stage === 'done') return { status: status('Calibrated'), calibration: null };

    if (!allOk || !frame) {
      if (this.stage === 'calibrating') this.calibrator.reset();
      this.stage = 'checking';
      this.okSince = null;
      this.progress = 0;
      return { status: status(firstHint || 'Hold still…'), calibration: null };
    }

    if (this.stage === 'checking') {
      this.okSince ??= t;
      if (t - this.okSince < this.readyMs) return { status: status('Looking good - hold still'), calibration: null };
      this.stage = 'calibrating';
      this.calibrator.reset();
    }

    const step = this.calibrator.update(frame, t);
    this.progress = step.progress;
    if (step.result) {
      this.stage = 'done';
      return { status: status('Calibrated'), calibration: step.result };
    }
    return { status: status(step.message), calibration: null };
  }
}
