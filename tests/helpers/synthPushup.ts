import type { LandmarkLike, RawPose } from '../../src/engine/types';
import { LANDMARK_COUNT, LM } from '../../src/pose/landmarks';

export interface PushupOptions {
  /** Interior elbow angle (180 = arms locked out). */
  elbowDeg: number;
  t?: number;
  width?: number;
  height?: number;
  /** Pixels per meter. */
  scale?: number;
  /** Hips dropped below (+) or raised above (−) the straight body line (m). */
  hipDropM?: number;
  farSideVisibility?: number;
}

type Sag = [forward: number, up: number];

/**
 * Side-on plank / push-up, head toward image right, hands under the shoulders.
 * Coordinates are (forward, up) in meters with the wrists on the floor at the origin.
 */
export function synthPushup(o: PushupOptions): RawPose {
  const W = o.width ?? 1280;
  const H = o.height ?? 720;
  const scale = o.scale ?? 330;
  const groundY = H - 120;
  const cx = W / 2 + 0.6 * scale;

  const UPPER = 0.3, FORE = 0.27, LEG = 0.84, TORSO = 0.5;
  const e = (o.elbowDeg * Math.PI) / 180;
  // Shoulder straight above the wrist at the distance the elbow angle allows.
  const d = Math.sqrt(UPPER ** 2 + FORE ** 2 - 2 * UPPER * FORE * Math.cos(e));
  const wrist: Sag = [0, 0];
  const shoulder: Sag = [0, d];
  const a = (FORE ** 2 - UPPER ** 2 + d ** 2) / (2 * d);
  const elbow: Sag = [-Math.sqrt(Math.max(0, FORE ** 2 - a ** 2)), a]; // elbows point back toward the feet

  // Straight body from shoulder to ankle, ankle 8 cm off the floor (on the toes).
  const ankleUp = 0.08;
  const bodyLen = LEG + TORSO;
  const ankle: Sag = [-Math.sqrt(bodyLen ** 2 - (d - ankleUp) ** 2), ankleUp];
  const along = (k: number): Sag => [ankle[0] + (shoulder[0] - ankle[0]) * k, ankle[1] + (shoulder[1] - ankle[1]) * k];
  const hipOnLine = along(LEG / bodyLen);
  const hip: Sag = [hipOnLine[0], hipOnLine[1] - (o.hipDropM ?? 0)];
  const knee: Sag = [(hip[0] + ankle[0]) / 2, (hip[1] + ankle[1]) / 2];
  const dir: Sag = [(shoulder[0] - ankle[0]) / bodyLen, (shoulder[1] - ankle[1]) / bodyLen];
  const ear: Sag = [shoulder[0] + dir[0] * 0.2, shoulder[1] + dir[1] * 0.2];
  const nose: Sag = [ear[0] + 0.08, ear[1] - 0.04];
  const heel: Sag = [ankle[0] - 0.04, ankle[1] + 0.06];
  const toe: Sag = [ankle[0] + 0.03, 0];

  const sag: Record<number, Sag> = {
    [LM.NOSE]: nose,
    [LM.L_EAR]: ear, [LM.R_EAR]: ear,
    [LM.L_SHOULDER]: shoulder, [LM.R_SHOULDER]: shoulder,
    [LM.L_ELBOW]: elbow, [LM.R_ELBOW]: elbow,
    [LM.L_WRIST]: wrist, [LM.R_WRIST]: wrist,
    [LM.L_HIP]: hip, [LM.R_HIP]: hip,
    [LM.L_KNEE]: knee, [LM.R_KNEE]: knee,
    [LM.L_ANKLE]: ankle, [LM.R_ANKLE]: ankle,
    [LM.L_HEEL]: heel, [LM.R_HEEL]: heel,
    [LM.L_FOOT]: toe, [LM.R_FOOT]: toe,
  };
  // Small lateral offsets keep left/right distinct in depth only (side view).
  const LAT: Record<number, number> = {
    [LM.L_SHOULDER]: 0.19, [LM.R_SHOULDER]: -0.19, [LM.L_HIP]: 0.1, [LM.R_HIP]: -0.1,
    [LM.L_ELBOW]: 0.2, [LM.R_ELBOW]: -0.2, [LM.L_WRIST]: 0.2, [LM.R_WRIST]: -0.2,
  };

  const image: LandmarkLike[] = [];
  const world: LandmarkLike[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const src = sag[i] ?? (i >= 17 && i <= 22 ? wrist : nose);
    const far = i !== 0 && i % 2 === 0;
    const visibility = sag[i] ? (far ? (o.farSideVisibility ?? 0.4) : 0.95) : 0.1;
    const [f, u] = src;
    const lat = LAT[i] ?? 0;
    world.push({ x: f - hip[0], y: -(u - hip[1]), z: -lat, visibility });
    image.push({ x: (cx + scale * f) / W, y: (groundY - scale * u) / H, z: (-scale * lat) / W, visibility });
  }
  return { t: o.t ?? 0, image, world, width: W, height: H };
}
