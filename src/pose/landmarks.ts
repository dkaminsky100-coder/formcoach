// MediaPipe BlazePose 33-landmark topology. Odd indices are the user's left side, even their right.

export const LM = {
  NOSE: 0,
  L_EYE: 2,
  R_EYE: 5,
  L_EAR: 7,
  R_EAR: 8,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
  L_HEEL: 29,
  R_HEEL: 30,
  L_FOOT: 31,
  R_FOOT: 32,
} as const;

export const LANDMARK_COUNT = 33;

export const BONES: ReadonlyArray<readonly [number, number]> = [
  // torso
  [LM.L_SHOULDER, LM.R_SHOULDER],
  [LM.L_HIP, LM.R_HIP],
  [LM.L_SHOULDER, LM.L_HIP],
  [LM.R_SHOULDER, LM.R_HIP],
  // arms
  [LM.L_SHOULDER, LM.L_ELBOW],
  [LM.L_ELBOW, LM.L_WRIST],
  [LM.R_SHOULDER, LM.R_ELBOW],
  [LM.R_ELBOW, LM.R_WRIST],
  // legs
  [LM.L_HIP, LM.L_KNEE],
  [LM.L_KNEE, LM.L_ANKLE],
  [LM.R_HIP, LM.R_KNEE],
  [LM.R_KNEE, LM.R_ANKLE],
  // feet
  [LM.L_ANKLE, LM.L_HEEL],
  [LM.L_HEEL, LM.L_FOOT],
  [LM.L_ANKLE, LM.L_FOOT],
  [LM.R_ANKLE, LM.R_HEEL],
  [LM.R_HEEL, LM.R_FOOT],
  [LM.R_ANKLE, LM.R_FOOT],
];

/** Landmarks drawn as joint dots (hands and most face points are skipped as noise). */
export const DRAWN_JOINTS: readonly number[] = [
  LM.NOSE, LM.L_EAR, LM.R_EAR,
  LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST,
  LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE,
  LM.L_HEEL, LM.R_HEEL, LM.L_FOOT, LM.R_FOOT,
];

export type Side = 'left' | 'right' | 'center';

export function sideOf(index: number): Side {
  if (index === 0) return 'center';
  return index % 2 === 1 ? 'left' : 'right';
}

export function boneSide([a, b]: readonly [number, number]): Side {
  const sa = sideOf(a);
  return sa === sideOf(b) ? sa : 'center';
}
