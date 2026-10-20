import type { ExerciseId } from '../engine/exercises/ExerciseModel';
import type { LandmarkLike, RawPose } from '../engine/types';
import { LANDMARK_COUNT } from './landmarks';

/**
 * A landmark recording: numbers only, no video. Used to replay a set through the engine,
 * to debug, and as test fixtures.
 */
export interface Recording {
  version: 1;
  createdAt: string;
  exercise?: ExerciseId;
  width: number;
  height: number;
  frames: RecordedFrame[];
}

export interface RecordedFrame {
  /** ms since the start of the recording. */
  t: number;
  /** 33 × (x, y, z, visibility), or null when no person was detected. */
  image: number[] | null;
  /** 33 × (x, y, z), or empty. */
  world: number[];
}

const round = (v: number) => Math.round(v * 1e5) / 1e5;

export function encodeFrame(pose: RawPose | null, t: number): RecordedFrame {
  if (!pose) return { t: Math.round(t), image: null, world: [] };
  return {
    t: Math.round(t),
    image: pose.image.flatMap((p) => [round(p.x), round(p.y), round(p.z), round(p.visibility ?? 0)]),
    world: pose.world.length === LANDMARK_COUNT ? pose.world.flatMap((p) => [round(p.x), round(p.y), round(p.z)]) : [],
  };
}

export function decodeFrame(f: RecordedFrame, width: number, height: number): RawPose | null {
  if (!f.image) return null;
  const image: LandmarkLike[] = [];
  for (let i = 0; i < f.image.length; i += 4) {
    image.push({ x: f.image[i], y: f.image[i + 1], z: f.image[i + 2], visibility: f.image[i + 3] });
  }
  const world: LandmarkLike[] = [];
  for (let i = 0; i < f.world.length; i += 3) {
    world.push({ x: f.world[i], y: f.world[i + 1], z: f.world[i + 2], visibility: image[i / 3]?.visibility });
  }
  return { t: f.t, image, world, width, height };
}

/** Validates parsed JSON. Throws an Error with a user-readable message. */
export function parseRecording(data: unknown): Recording {
  const r = data as Partial<Recording> | null;
  if (!r || typeof r !== 'object' || r.version !== 1 || !Array.isArray(r.frames)) {
    throw new Error('This file is not a FormCoach landmark recording.');
  }
  if (!(typeof r.width === 'number' && r.width > 0 && typeof r.height === 'number' && r.height > 0)) {
    throw new Error('The recording is missing its frame size.');
  }
  for (const f of r.frames) {
    const ok =
      typeof f?.t === 'number' &&
      (f.image === null || (Array.isArray(f.image) && f.image.length === LANDMARK_COUNT * 4)) &&
      Array.isArray(f.world) &&
      (f.world.length === 0 || f.world.length === LANDMARK_COUNT * 3);
    if (!ok) throw new Error('The recording is damaged (a frame has the wrong shape).');
  }
  if (r.frames.length === 0) throw new Error('The recording has no frames.');
  return r as Recording;
}

/** Collects frames while recording is on. */
export class Recorder {
  private rec: Recording | null = null;
  private t0 = 0;

  get active(): boolean {
    return this.rec !== null;
  }

  get frameCount(): number {
    return this.rec?.frames.length ?? 0;
  }

  start(width: number, height: number, exercise?: ExerciseId): void {
    this.rec = { version: 1, createdAt: new Date().toISOString(), exercise, width, height, frames: [] };
    this.t0 = -1;
  }

  add(pose: RawPose | null, t: number): void {
    if (!this.rec) return;
    if (this.t0 < 0) this.t0 = t;
    this.rec.frames.push(encodeFrame(pose, t - this.t0));
  }

  stop(): Recording | null {
    const r = this.rec;
    this.rec = null;
    return r && r.frames.length > 0 ? r : null;
  }
}
