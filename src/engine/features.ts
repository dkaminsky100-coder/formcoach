import { LM } from '../pose/landmarks';
import { angle2D, angle3D, inclination2D, inclination3D, mid } from './math/vec';
import type { Bilateral, BodyFrame, BodySide, Features, JointMeasure, TrackedPoint, View } from './types';

type Triple = readonly [number, number, number];

interface JointDef {
  left: Triple;
  right: Triple;
}

const KNEE: JointDef = { left: [LM.L_HIP, LM.L_KNEE, LM.L_ANKLE], right: [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE] };
const HIP: JointDef = { left: [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE], right: [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE] };
const ELBOW: JointDef = {
  left: [LM.L_SHOULDER, LM.L_ELBOW, LM.L_WRIST],
  right: [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST],
};

const SIDE_CHAIN = {
  left: [LM.L_SHOULDER, LM.L_HIP, LM.L_KNEE, LM.L_ANKLE],
  right: [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE, LM.R_ANKLE],
} as const;

function allValid(pts: TrackedPoint[], idx: readonly number[]): boolean {
  return idx.every((i) => pts[i]?.valid);
}

function angleOf(pts: TrackedPoint[], [a, b, c]: Triple, use3D: boolean): number | null {
  if (!allValid(pts, [a, b, c])) return null;
  return use3D ? angle3D(pts[a], pts[b], pts[c]) : angle2D(pts[a], pts[b], pts[c]);
}

const mean = (vals: (number | null)[]): number | null => {
  const ok = vals.filter((v): v is number => v !== null);
  return ok.length ? ok.reduce((s, v) => s + v, 0) / ok.length : null;
};

/** Side whose leg/torso chain the model is more confident about - the one facing the camera. */
export function nearSide(pts: TrackedPoint[]): BodySide | null {
  const score = (idx: readonly number[]) => idx.reduce((s, i) => s + (pts[i]?.visibility ?? 0), 0) / idx.length;
  const l = score(SIDE_CHAIN.left), r = score(SIDE_CHAIN.right);
  if (Math.max(l, r) < 0.3) return null;
  return l >= r ? 'left' : 'right';
}

/**
 * Picks the right measurement for the view:
 *  - side view: 2D image angle on the near side (motion is in the image plane, most accurate),
 *  - front/oblique: 3D world angle averaged over both sides (2D would be foreshortened).
 */
function measureJoint(body: BodyFrame, def: JointDef, view: View, near: BodySide | null): JointMeasure {
  const has3D = body.world.length > 0;
  if (view === 'side') {
    const left = angleOf(body.px, def.left, false);
    const right = angleOf(body.px, def.right, false);
    const primary = near === 'right' ? (right ?? left) : (left ?? right);
    return { left, right, primary, source: primary === null ? null : '2d' };
  }
  if (has3D && view !== 'unknown') {
    const left = angleOf(body.world, def.left, true);
    const right = angleOf(body.world, def.right, true);
    const primary = mean([left, right]);
    return { left, right, primary, source: primary === null ? null : '3d' };
  }
  const left = angleOf(body.px, def.left, false);
  const right = angleOf(body.px, def.right, false);
  return { left, right, primary: null, source: null };
}

function trunkLean(body: BodyFrame, view: View): number | null {
  if (view === 'side') {
    return body.hipMid && body.shoulderMid ? inclination2D(body.hipMid, body.shoulderMid) : null;
  }
  const w = body.world;
  if (w.length === 0 || !allValid(w, [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP])) return null;
  return inclination3D(mid(w[LM.L_HIP], w[LM.R_HIP]), mid(w[LM.L_SHOULDER], w[LM.R_SHOULDER]));
}

function shin(pts: TrackedPoint[]): Bilateral {
  const one = (ankle: number, knee: number) =>
    pts[ankle]?.valid && pts[knee]?.valid ? inclination2D(pts[ankle], pts[knee]) : null;
  return { left: one(LM.L_ANKLE, LM.L_KNEE), right: one(LM.R_ANKLE, LM.R_KNEE) };
}

export function shoulderSpread(body: BodyFrame): number | null {
  const l = body.px[LM.L_SHOULDER], r = body.px[LM.R_SHOULDER];
  if (!l?.present || !r?.present || !body.torsoLength) return null;
  return Math.abs(l.x - r.x) / body.torsoLength;
}

export function computeFeatures(body: BodyFrame, view: View, spread: number | null): Features {
  const near = nearSide(body.px);
  return {
    view,
    nearSide: near,
    shoulderSpread: spread,
    knee: measureJoint(body, KNEE, view, near),
    hip: measureJoint(body, HIP, view, near),
    elbow: measureJoint(body, ELBOW, view, near),
    trunkLean: trunkLean(body, view),
    shin: shin(body.px),
  };
}
