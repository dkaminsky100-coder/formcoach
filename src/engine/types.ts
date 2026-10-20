// Engine types. The engine has no DOM / MediaPipe dependency: it consumes plain landmark arrays.

export interface LandmarkLike {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/** One pose estimate as produced by the pose layer (image landmarks normalized to [0,1]). */
export interface RawPose {
  /** Milliseconds, monotonic. */
  t: number;
  image: LandmarkLike[];
  /** Metric, hip-centered landmarks (meters). May be empty. */
  world: LandmarkLike[];
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface TrackedPoint extends Point {
  visibility: number;
  /** Confident enough for measurements (visibility ≥ 0.5 and inside the frame). */
  valid: boolean;
  /** Roughly located - good enough for structure (midpoints, view), not for angles. */
  present: boolean;
}

export type View = 'front' | 'side' | 'oblique' | 'unknown';
export type BodySide = 'left' | 'right';

/** Smoothed, scaled body for one frame. */
export interface BodyFrame {
  t: number;
  width: number;
  height: number;
  /** Filtered pixel coordinates in the unmirrored frame. */
  px: TrackedPoint[];
  /** Filtered world coordinates (meters, hip-centered). Empty if the model gave none. */
  world: TrackedPoint[];
  hipMid: Point | null;
  shoulderMid: Point | null;
  /** Hip→knee→ankle path length in px (stable while the knee bends). */
  legLength: number | null;
  torsoLength: number | null;
  /** Hip-centered, divided by legLength - comparable across body sizes and camera distances. */
  norm: (Point | null)[];
}

export interface Bilateral {
  left: number | null;
  right: number | null;
}

export interface JointMeasure extends Bilateral {
  /** The value exercises should use for this view (degrees), or null if not measurable. */
  primary: number | null;
  /** How `primary` was measured. */
  source: '2d' | '3d' | null;
}

export interface Features {
  view: View;
  /** Side facing the camera (meaningful in side view). */
  nearSide: BodySide | null;
  /** |shoulder x-spread| / torso length - the view classifier input. */
  shoulderSpread: number | null;
  /** Interior angles, 180° = straight. */
  knee: JointMeasure;
  hip: JointMeasure;
  elbow: JointMeasure;
  /** Trunk (hip→shoulder) angle from vertical, degrees. */
  trunkLean: number | null;
  /** Shin (ankle→knee) angle from vertical, degrees (2D). */
  shin: Bilateral;
}

export interface EngineFrame {
  body: BodyFrame;
  features: Features;
  /** The tracked body jumped further than a person can move in one frame: probably a different person. */
  identityChanged: boolean;
}
