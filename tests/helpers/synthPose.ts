import type { LandmarkLike, RawPose } from '../../src/engine/types';
import { LANDMARK_COUNT, LM } from '../../src/pose/landmarks';

export interface SynthOptions {
  view: 'side' | 'front';
  /** Interior knee angle (180 = standing straight). */
  kneeDeg?: number;
  /** Trunk forward lean from vertical. Defaults to half the knee bend, like a balanced squat. */
  trunkLeanDeg?: number;
  /** Interior elbow angle; upper arms point forward horizontally. */
  elbowDeg?: number;
  t?: number;
  width?: number;
  height?: number;
  /** Pixels per meter (camera distance). */
  scale?: number;
  offsetX?: number;
  /** Visibility of the right side in side view (left side faces the camera). */
  farSideVisibility?: number;
  /** Each knee moves this far toward the midline (m) - knee valgus. */
  kneeInM?: number;
  /** Heels raised this much (m), toes stay down. */
  heelLiftM?: number;
  /** Upper body (hips and above) shifted sideways toward the user's left (m). */
  hipShiftM?: number;
  /** Overrides the visibility of every tracked landmark (simulates poor lighting). */
  visibility?: number;
  /** Pixels between the ankles and the bottom of the frame. */
  groundMarginPx?: number;
}

const UPPER_BODY = new Set<number>([
  LM.NOSE, LM.L_EAR, LM.R_EAR, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW,
  LM.L_WRIST, LM.R_WRIST, LM.L_HIP, LM.R_HIP, 1, 2, 3, 4, 5, 6, 9, 10, 17, 18, 19, 20, 21, 22,
]);

type Sag = [forward: number, up: number];

const rad = (d: number) => (d * Math.PI) / 180;

/** Lateral offsets (m) per landmark; left side positive. */
const LATERAL: Record<number, number> = {
  [LM.L_SHOULDER]: 0.19, [LM.R_SHOULDER]: -0.19,
  [LM.L_ELBOW]: 0.22, [LM.R_ELBOW]: -0.22,
  [LM.L_WRIST]: 0.24, [LM.R_WRIST]: -0.24,
  [LM.L_HIP]: 0.1, [LM.R_HIP]: -0.1,
  [LM.L_KNEE]: 0.1, [LM.R_KNEE]: -0.1,
  [LM.L_ANKLE]: 0.11, [LM.R_ANKLE]: -0.11,
  [LM.L_HEEL]: 0.11, [LM.R_HEEL]: -0.11,
  [LM.L_FOOT]: 0.13, [LM.R_FOOT]: -0.13,
  [LM.L_EAR]: 0.07, [LM.R_EAR]: -0.07,
};

/**
 * Builds a geometrically exact pose. Body-plane coordinates are (forward, up) in meters with the
 * ankles at the origin; the knee angle, trunk lean and elbow angle are exactly as requested.
 */
export function synthPose(o: SynthOptions): RawPose {
  const knee = o.kneeDeg ?? 175;
  const lean = o.trunkLeanDeg ?? (180 - knee) / 2;
  const elbow = o.elbowDeg ?? 170;
  const W = o.width ?? 1280;
  const H = o.height ?? 720;
  const scale = o.scale ?? 380;
  const cx = W / 2 + (o.offsetX ?? 0);
  const groundY = H - (o.groundMarginPx ?? 70);

  // Leg: shin tilts forward by s; thigh direction = shin-down direction rotated by -knee.
  const s = rad((180 - knee) / 2);
  const ankle: Sag = [0, 0];
  const kneeP: Sag = [0.42 * Math.sin(s), 0.42 * Math.cos(s)];
  const alpha = Math.atan2(-Math.cos(s), -Math.sin(s)) - rad(knee);
  const hip: Sag = [kneeP[0] + 0.42 * Math.cos(alpha), kneeP[1] + 0.42 * Math.sin(alpha)];
  const L = rad(lean);
  const shoulder: Sag = [hip[0] + 0.5 * Math.sin(L), hip[1] + 0.5 * Math.cos(L)];
  const ear: Sag = [shoulder[0] + 0.2 * Math.sin(L), shoulder[1] + 0.2 * Math.cos(L)];
  const nose: Sag = [ear[0] + 0.08, ear[1]];
  const elbowP: Sag = [shoulder[0] + 0.3, shoulder[1]];
  const phi = -rad(180 - elbow);
  const wrist: Sag = [elbowP[0] + 0.27 * Math.cos(phi), elbowP[1] + 0.27 * Math.sin(phi)];
  const heel: Sag = [-0.05, -0.06 + (o.heelLiftM ?? 0)];
  const toe: Sag = [0.15, -0.07];

  const sag: Record<number, Sag> = {
    [LM.NOSE]: nose,
    [LM.L_EAR]: ear, [LM.R_EAR]: ear,
    [LM.L_SHOULDER]: shoulder, [LM.R_SHOULDER]: shoulder,
    [LM.L_ELBOW]: elbowP, [LM.R_ELBOW]: elbowP,
    [LM.L_WRIST]: wrist, [LM.R_WRIST]: wrist,
    [LM.L_HIP]: hip, [LM.R_HIP]: hip,
    [LM.L_KNEE]: kneeP, [LM.R_KNEE]: kneeP,
    [LM.L_ANKLE]: ankle, [LM.R_ANKLE]: ankle,
    [LM.L_HEEL]: heel, [LM.R_HEEL]: heel,
    [LM.L_FOOT]: toe, [LM.R_FOOT]: toe,
  };

  const image: LandmarkLike[] = [];
  const world: LandmarkLike[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    // Unlisted landmarks (eyes, mouth, fingers) sit on the nose / wrist with low visibility.
    const src = sag[i] ?? (i >= 17 && i <= 22 ? (i % 2 ? sag[LM.L_WRIST] : sag[LM.R_WRIST]) : nose);
    let lat = LATERAL[i] ?? 0;
    if (i === LM.L_KNEE) lat -= o.kneeInM ?? 0;
    if (i === LM.R_KNEE) lat += o.kneeInM ?? 0;
    if (UPPER_BODY.has(i)) lat += o.hipShiftM ?? 0;
    const [f, u] = src;
    const far = o.view === 'side' && i !== 0 && i % 2 === 0;
    const visibility = sag[i] ? (o.visibility ?? (far ? (o.farSideVisibility ?? 0.4) : 0.95)) : 0.1;

    // World: x lateral (or forward in side view), y down, origin at hip center.
    const wx = o.view === 'side' ? f - hip[0] : lat;
    const wz = o.view === 'side' ? -lat : -(f - hip[0]);
    world.push({ x: wx, y: -(u - hip[1]), z: wz, visibility });

    const ix = o.view === 'side' ? cx + scale * f : cx + scale * lat;
    const iy = groundY - scale * u;
    image.push({ x: ix / W, y: iy / H, z: (scale * wz) / W, visibility });
  }

  return { t: o.t ?? 0, image, world, width: W, height: H };
}
