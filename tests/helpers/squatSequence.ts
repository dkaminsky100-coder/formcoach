import type { RawPose } from '../../src/engine/types';
import { synthPose, type SynthOptions } from './synthPose';

/** Form faults a simulated rep performs; each scales from 0 standing to full at the bottom. */
export interface RepFaults {
  kneeInM?: number;
  heelLiftM?: number;
  hipShiftM?: number;
  /** Extra trunk lean beyond the balanced default (degrees). */
  extraLeanDeg?: number;
}

export interface RepSpec {
  /** Knee angle at the bottom. */
  bottomKnee: number;
  downS?: number;
  pauseS?: number;
  upS?: number;
  /** Standing time after the rep. */
  restS?: number;
  faults?: RepFaults;
}

export interface SequenceOptions extends Omit<SynthOptions, 'kneeDeg' | 't'> {
  fps?: number;
  standKnee?: number;
  /** Standing time before the first rep (lets the engine settle). */
  leadInS?: number;
  /** ± random knee-angle noise in degrees (deterministic). */
  jitterDeg?: number;
  /** Time ranges (ms) where the person is not detected. */
  dropouts?: Array<[number, number]>;
  /** Keep the torso near-vertical (lunge) instead of the squat's balanced lean. */
  uprightTorso?: boolean;
}

export interface SequenceFrame {
  t: number;
  pose: RawPose | null;
  knee: number;
}

interface Key {
  t: number;
  knee: number;
  /** Rep this key belongs to (the segment ending at it). */
  rep: number;
}

/** Knee-angle timeline for a set of squats, sampled into synthetic poses. */
export function squatSequence(reps: RepSpec[], o: SequenceOptions = { view: 'side' }): SequenceFrame[] {
  const fps = o.fps ?? 30;
  const stand = o.standKnee ?? 175;
  const keys: Key[] = [{ t: 0, knee: stand, rep: -1 }];
  let t = o.leadInS ?? 2;
  keys.push({ t, knee: stand, rep: -1 });
  reps.forEach((r, i) => {
    t += r.downS ?? 1.2;
    keys.push({ t, knee: r.bottomKnee, rep: i });
    t += r.pauseS ?? 0.2;
    keys.push({ t, knee: r.bottomKnee, rep: i });
    t += r.upS ?? 1;
    keys.push({ t, knee: stand, rep: i });
    t += r.restS ?? 1;
    keys.push({ t, knee: stand, rep: -1 });
  });

  // Cosine easing between keyframes, like a real controlled movement.
  const at = (s: number): { knee: number; rep: number } => {
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1], b = keys[i];
      if (s <= b.t) {
        const u = b.t === a.t ? 1 : (s - a.t) / (b.t - a.t);
        return { knee: a.knee + ((b.knee - a.knee) * (1 - Math.cos(Math.PI * u))) / 2, rep: b.rep };
      }
    }
    return { knee: keys[keys.length - 1].knee, rep: -1 };
  };

  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;

  const frames: SequenceFrame[] = [];
  const total = t + 0.5;
  for (let i = 0; i * (1 / fps) <= total; i++) {
    const ms = (i * 1000) / fps;
    const { knee: clean, rep } = at(i / fps);
    const spec = rep >= 0 ? reps[rep] : undefined;
    const depth = spec ? Math.max(0, (stand - clean) / (stand - spec.bottomKnee)) : 0;
    const f = spec?.faults ?? {};
    const knee = Math.min(179, clean + (o.jitterDeg ? rand() * 2 * o.jitterDeg : 0));
    const dropped = o.dropouts?.some(([a, b]) => ms >= a && ms < b);
    frames.push({
      t: ms,
      knee,
      pose: dropped
        ? null
        : synthPose({
            ...o,
            kneeDeg: knee,
            t: ms,
            kneeInM: (f.kneeInM ?? 0) * depth,
            heelLiftM: (f.heelLiftM ?? 0) * depth,
            hipShiftM: (f.hipShiftM ?? 0) * depth,
            trunkLeanDeg: (o.uprightTorso ? 5 : (180 - knee) / 2) + (f.extraLeanDeg ?? 0) * depth,
          }),
    });
  }
  return frames;
}
