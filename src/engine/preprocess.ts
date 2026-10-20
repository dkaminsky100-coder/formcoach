import type { LandmarkLike, Point } from './types';

export const VALID_VISIBILITY = 0.5;
export const PRESENT_VISIBILITY = 0.2;
/** How far outside the frame (as a fraction) a landmark may be and still count as valid. */
const FRAME_MARGIN = 0.02;

/**
 * Normalized → pixel coordinates. Geometry must be done in pixels: on a 16:9 frame the
 * normalized x and y axes have different scales, so normalized angles would be wrong.
 * MediaPipe's image z uses roughly the same scale as x.
 */
export function toPixel(lm: LandmarkLike, width: number, height: number): Point {
  return { x: lm.x * width, y: lm.y * height, z: lm.z * width };
}

export function inFrame(lm: LandmarkLike): boolean {
  return lm.x >= -FRAME_MARGIN && lm.x <= 1 + FRAME_MARGIN && lm.y >= -FRAME_MARGIN && lm.y <= 1 + FRAME_MARGIN;
}

export function isValid(lm: LandmarkLike): boolean {
  return (lm.visibility ?? 0) >= VALID_VISIBILITY && inFrame(lm);
}

export function isPresent(lm: LandmarkLike): boolean {
  return (lm.visibility ?? 0) >= PRESENT_VISIBILITY;
}
