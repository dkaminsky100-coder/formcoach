import type { Point } from '../types';

const RAD_TO_DEG = 180 / Math.PI;

export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

export const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

export const dist2D = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Interior angle ∠ABC in degrees (180 = straight). Uses atan2(|u×v|, u·v), which stays
 * accurate near 0° and 180° where acos(u·v / |u||v|) loses precision.
 */
export function angle3D(a: Point, b: Point, c: Point): number {
  const u = sub(a, b);
  const v = sub(c, b);
  const cx = u.y * v.z - u.z * v.y;
  const cy = u.z * v.x - u.x * v.z;
  const cz = u.x * v.y - u.y * v.x;
  return Math.atan2(Math.hypot(cx, cy, cz), u.x * v.x + u.y * v.y + u.z * v.z) * RAD_TO_DEG;
}

/** Interior angle ∠ABC in the image plane (z ignored). */
export function angle2D(a: Point, b: Point, c: Point): number {
  const ux = a.x - b.x, uy = a.y - b.y;
  const vx = c.x - b.x, vy = c.y - b.y;
  return Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * RAD_TO_DEG;
}

/** Angle of segment from→to away from the vertical axis, 0-90° (2D, either direction). */
export function inclination2D(from: Point, to: Point): number {
  return Math.atan2(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) * RAD_TO_DEG;
}

/** Angle of segment from→to away from the y axis in 3D, 0-90°. */
export function inclination3D(from: Point, to: Point): number {
  const d = sub(to, from);
  return Math.atan2(Math.hypot(d.x, d.z), Math.abs(d.y)) * RAD_TO_DEG;
}

/** Signed perpendicular distance of p from the line a→b (2D). Positive = left of a→b in image coordinates. */
export function lineOffset2D(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len === 0 ? 0 : ((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}
